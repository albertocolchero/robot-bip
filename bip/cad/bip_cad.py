"""
BIP - robot de escritorio con M5Stack CoreS3 Lite.
Genera las piezas imprimibles (STL) a partir de medidas. Todas las cotas en mm.

Uso:  python bip_cad.py            -> escribe ../stl/*.stl y ../build/viewer_data.json
Requiere: pip install manifold3d numpy

Si al recibir el CoreS3 tus medidas no coinciden, cambia los numeros de
"MEDIDAS DEL APARATO" y "HOLGURAS" y vuelve a ejecutar.
"""
import base64
import json
import math
import os
import struct

import numpy as np
from manifold3d import CrossSection, JoinType, Manifold

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_STL = os.path.join(HERE, "..", "stl")
OUT_BUILD = os.path.join(HERE, "..", "build")

SEG = 64  # segmentos por circulo (suavidad)

# ---------------------------------------------------------------- MEDIDAS DEL APARATO
DEV = 54.0      # CoreS3 Lite: ancho y alto (cuadrado)
DEV_T = 16.5    # CoreS3 Lite: grosor con su tapa magnetica

# ---------------------------------------------------------------- HOLGURAS
CLR = 0.35      # holgura alrededor del aparato (por lado)
PEG_CLR = 0.2   # holgura de las espigas (cuello, antenas) por radio

# ---------------------------------------------------------------- CABEZA
CAV = DEV + 2 * CLR          # hueco interior
WS, WT, WB = 4.2, 7.0, 12.0  # paredes: lados, arriba, abajo (abajo va el cuello)
W = CAV + 2 * WS             # ancho exterior
H = CAV + WT + WB            # alto exterior
YOFF = (WT - WB) / 2         # centro del perfil exterior respecto al aparato
R = 13.0                     # radio de las esquinas vistas de frente
FRONT_T = 2.0                # grosor del marco frontal
PLUG_D = 3.0                 # cuanto entra la tapa trasera en la cabeza
CAV_D = DEV_T + 0.4 + PLUG_D
D_HEAD = FRONT_T + CAV_D     # fondo de la cabeza (sin tapa)
CH_F = 2.5                   # chaflan del borde frontal
CAP_T = 2.6                  # grosor de la tapa trasera
CH_B = 2.0                   # chaflan del borde trasero
TILT = 10.0                  # la cabeza mira 10 grados hacia arriba

WIN_IN = 49.0                # ventana frontal (lado interior)
WIN_OUT = 52.4               # ventana frontal (lado exterior, achaflanada)

SLOT_L, SLOT_W = 44.0, 11.0  # ranuras laterales (USB-C, boton, puerto A)

PEG_R = 6.1                  # radio de las espigas del cuello
SOCK_R = PEG_R + PEG_CLR
SOCK_DEPTH = 9.0
ZS = 11.0                    # posicion del encaje del cuello (fondo)

ANT_X, ANT_Z = 17.0, 10.5
ANT_LEAN = 15.0
ANT_R = 1.8
ANT_HOLE_R = ANT_R + 0.08
ANT_HOLE_D = 5.5

# ---------------------------------------------------------------- CUELLO Y BASE
NECK_R = 10.0
NECK_H = 14.0
B_R0, B_R1, B_H = 44.0, 30.0, 30.0   # base: radio abajo, radio arriba, alto
B_WALL, B_TOP = 2.4, 3.2

# Servo SG90 (fase opcional)
SG_L, SG_W = 22.8, 12.2
SG_SHAFT_OFF = 5.4   # el eje del SG90 no esta en el centro del cuerpo
SG_HOLES = 27.8      # distancia entre agujeros de las orejetas
SERVO_LIFT = 8.5     # cuanto queda el cuello por encima de la base con servo


# ================================================================= utilidades
def rrect(w, h, r, cx=0.0, cy=0.0):
    r = max(0.01, min(r, w / 2 - 0.01, h / 2 - 0.01))
    cs = CrossSection.square((w - 2 * r, h - 2 * r), True).offset(r, JoinType.Round, 2.0, SEG)
    return cs.translate((cx, cy))


def slab(cs, z, t=0.01):
    return Manifold.extrude(cs, t).translate((0, 0, z))


def chamfered_prism(profile, z0, z1, ch0=0.0, ch1=0.0):
    """Prisma desde z0 a z1 con chaflan opcional abajo (ch0) y arriba (ch1)."""
    parts = []
    if ch0 > 0:
        parts += [slab(profile(ch0), z0), slab(profile(0), z0 + ch0)]
    else:
        parts.append(slab(profile(0), z0))
    if ch1 > 0:
        parts += [slab(profile(0), z1 - ch1 - 0.01), slab(profile(ch1), z1 - 0.01)]
    else:
        parts.append(slab(profile(0), z1 - 0.01))
    return Manifold.batch_hull(parts)


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def affine(rot, trans=(0, 0, 0)):
    m = np.zeros((3, 4))
    m[:, :3] = rot
    m[:, 3] = trans
    return m


def frame_from_z(v):
    """Rotacion que lleva el eje Z al vector v."""
    v = np.asarray(v, float)
    v = v / np.linalg.norm(v)
    z = np.array([0, 0, 1.0])
    c = float(np.dot(z, v))
    if c > 0.999999:
        return np.eye(3)
    if c < -0.999999:
        return rot_x(180)
    axis = np.cross(z, v)
    s = np.linalg.norm(axis)
    axis = axis / s
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    ang = math.atan2(s, c)
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def rod(p, v, length, r, r2=None):
    """Cilindro que empieza en p y avanza 'length' en la direccion v."""
    cyl = Manifold.cylinder(length, r, r if r2 is None else r2, SEG)
    return cyl.transform(affine(frame_from_z(v), p))


def stadium_x(yc, zc, length, width, x0, x1):
    """Ranura alargada (a lo largo de Y) que atraviesa en X de x0 a x1."""
    rr = width / 2
    a = rod((x0, yc - length / 2 + rr, zc), (1, 0, 0), x1 - x0, rr)
    b = rod((x0, yc + length / 2 - rr, zc), (1, 0, 0), x1 - x0, rr)
    return Manifold.batch_hull([a, b])


# ================================================================= piezas
UP_LOCAL = np.array([0, math.cos(math.radians(TILT)), -math.sin(math.radians(TILT))])
Y_BOT = YOFF - H / 2
Y_TOP = YOFF + H / 2
E_LOCAL = np.array([0.0, Y_BOT, ZS])  # entrada del encaje del cuello


def head_profile(inset):
    return rrect(W - 2 * inset, H - 2 * inset, R - inset, 0, YOFF)


def make_head():
    body = chamfered_prism(head_profile, 0, D_HEAD, CH_F, 0)
    cav = Manifold.extrude(rrect(CAV, CAV, 1.0), D_HEAD + 1).translate((0, 0, FRONT_T))
    # ventana frontal achaflanada (interpolacion lineal entre los dos tamanos)
    k = (WIN_OUT - WIN_IN) / FRONT_T
    win = Manifold.batch_hull([
        slab(rrect(WIN_OUT + 0.5 * k, WIN_OUT + 0.5 * k, 6.5), -0.5),
        slab(rrect(WIN_IN - 0.5 * k, WIN_IN - 0.5 * k, 4.5), FRONT_T + 0.5),
    ])
    zc = FRONT_T + DEV_T / 2 + 0.2
    slots = stadium_x(0, zc, SLOT_L, SLOT_W, CAV / 2 - 1, W / 2 + 1) + \
        stadium_x(0, zc, SLOT_L, SLOT_W, -W / 2 - 1, -CAV / 2 + 1)
    # encaje del cuello con forma de gota (imprime sin soportes)
    apex_dir = np.array([0, math.sin(math.radians(TILT)), math.cos(math.radians(TILT))])
    start = E_LOCAL - 2 * UP_LOCAL
    sock = Manifold.batch_hull([
        rod(start, UP_LOCAL, SOCK_DEPTH + 2, SOCK_R),
        rod(start + apex_dir * SOCK_R * 1.35, UP_LOCAL, SOCK_DEPTH + 2, 0.05),
    ])
    # agujeros de antenas
    ants = []
    for sx in (-1, 1):
        axis = np.array([sx * math.sin(math.radians(ANT_LEAN)), math.cos(math.radians(ANT_LEAN)), 0])
        top = np.array([sx * ANT_X, Y_TOP, ANT_Z])
        ants.append(rod(top + axis * 2, -axis, ANT_HOLE_D + 2, ANT_HOLE_R))
    cut = Manifold.batch_boolean([cav, win, slots, sock] + ants, _op_add())
    return body - cut


def _op_add():
    from manifold3d import OpType
    return OpType.Add


def make_cap():
    plate = chamfered_prism(head_profile, D_HEAD, D_HEAD + CAP_T, 0, CH_B)
    ring_o = CAV - 2 * 0.15
    z0 = D_HEAD - (PLUG_D - 0.15)
    ring = Manifold.extrude(rrect(ring_o, ring_o, 0.8), D_HEAD - z0 + 0.01).translate((0, 0, z0))
    ring -= Manifold.extrude(rrect(ring_o - 3.6, ring_o - 3.6, 0.5), 10).translate((0, 0, z0 - 1))
    # nervios que aprietan al encajar (se aplastan un poco)
    ribs = []
    for (x, y) in [(ring_o / 2, -15), (ring_o / 2, 15), (-ring_o / 2, -15), (-ring_o / 2, 15),
                   (-15, ring_o / 2), (15, ring_o / 2), (-15, -ring_o / 2), (15, -ring_o / 2)]:
        ribs.append(Manifold.cylinder(D_HEAD - z0, 0.45, 0.45, 16).translate((x, y, z0)))
    cap = plate + ring + Manifold.batch_boolean(ribs, _op_add())
    # rejilla (sonido y ventilacion)
    vents = []
    for i, y in enumerate([-12, -6, 0, 6, 12]):
        L = 30 if i in (1, 2, 3) else 22
        a = Manifold.cylinder(CAP_T + 4, 1.3, 1.3, 24).translate((-L / 2 + 1.3, y, D_HEAD - 1))
        b = Manifold.cylinder(CAP_T + 4, 1.3, 1.3, 24).translate((L / 2 - 1.3, y, D_HEAD - 1))
        vents.append(Manifold.batch_hull([a, b]))
    # muesca para abrir con la una
    notch = Manifold.cylinder(1.4, 4.0, 4.0, SEG).translate((0, Y_BOT, D_HEAD - 0.01))
    return cap - Manifold.batch_boolean(vents + [notch], _op_add())


def make_antenna():
    """Orientacion de impresion: bola abajo (truncada), espiga arriba."""
    rb = 4.2
    ball = Manifold.sphere(rb, SEG).translate((0, 0, 0.5 * rb))
    ball = ball.trim_by_plane((0, 0, 1), 0.0)
    z_ball_top = 1.5 * rb
    shaft = Manifold.cylinder(z_ball_top + 16 - 0.5 * rb, ANT_R, ANT_R, 32).translate((0, 0, 0.5 * rb))
    zc = z_ball_top + 16
    collar = Manifold.batch_hull([
        Manifold.cylinder(0.01, ANT_R, ANT_R, 32).translate((0, 0, zc - 1.0)),
        Manifold.cylinder(1.0, 2.8, 2.8, 32).translate((0, 0, zc)),
    ])
    peg = Manifold.cylinder(ANT_HOLE_D - 0.5, ANT_R, ANT_R, 32).translate((0, 0, zc + 1.0))
    return ball + shaft + collar + peg, zc + 1.0  # devuelve tambien donde empieza la espiga


def neck_top_trim(m):
    """Corta la parte de arriba del cuello con la misma inclinacion que la cabeza."""
    t = math.radians(TILT)
    n = np.array([0, math.sin(t), -math.cos(t)])  # normal hacia abajo-delante
    top = np.array([0, 0, NECK_H])
    return m.trim_by_plane(tuple(n), float(np.dot(n, top)))


def make_neck_fixed():
    """Coordenadas: z=0 es la cara de arriba de la base."""
    body = Manifold.batch_hull([
        Manifold.cylinder(0.01, PEG_R, PEG_R, SEG),
        Manifold.cylinder(0.01, NECK_R, NECK_R, SEG).translate((0, 0, NECK_R - PEG_R)),
        Manifold.cylinder(0.01, NECK_R, NECK_R, SEG).translate((0, 0, NECK_H + 3)),
    ])
    body = neck_top_trim(body)
    top_peg = Manifold.cylinder(SOCK_DEPTH - 0.5 + 2, PEG_R, PEG_R, SEG).translate((0, 0, NECK_H - 2))
    bot_peg = Manifold.cylinder(7.0, PEG_R, PEG_R, SEG).translate((0, 0, -7.0))
    return body + top_peg + bot_peg


def make_neck_servo():
    """Version para servo SG90. z=0 es la cara de abajo de la brida."""
    flange = Manifold.cylinder(3.0, 15.0, 15.0, SEG)
    cone = Manifold.batch_hull([
        Manifold.cylinder(0.01, 15.0, 15.0, SEG).translate((0, 0, 3.0)),
        Manifold.cylinder(0.01, NECK_R, NECK_R, SEG).translate((0, 0, 3.0 + 5.0)),
        Manifold.cylinder(0.01, NECK_R, NECK_R, SEG).translate((0, 0, NECK_H + 3)),
    ])
    body = neck_top_trim(flange + cone)
    top_peg = Manifold.cylinder(SOCK_DEPTH - 0.5 + 2, PEG_R, PEG_R, SEG).translate((0, 0, NECK_H - 2))
    horn = Manifold.cube((34, 5.9, 2.2)).translate((-17, -2.95, -0.01))
    hub = Manifold.cylinder(2.2, 3.9, 3.9, SEG).translate((0, 0, -0.01))
    return body + top_peg - horn - hub


def base_shell():
    t = math.atan((B_R0 - B_R1) / B_H)
    wh = B_WALL / math.cos(t)

    def r_out(z):
        return B_R0 - (B_R0 - B_R1) * z / B_H

    outer = Manifold.batch_hull([
        Manifold.cylinder(B_H - 2.0, B_R0, r_out(B_H - 2.0), 128),
        Manifold.cylinder(0.01, r_out(B_H) - 2.0, r_out(B_H) - 2.0, 128).translate((0, 0, B_H - 0.01)),
    ])
    zi = B_H - B_TOP
    inner = Manifold.cylinder(zi + 1, r_out(-1) - wh, r_out(zi) - wh, 128).translate((0, 0, -1))
    shell = outer - inner
    # canal decorativo
    groove = Manifold.cylinder(1.6, r_out(9) + 2, r_out(10.6) + 2, 128).translate((0, 0, 9)) - \
        Manifold.cylinder(1.6, r_out(9) - 0.8, r_out(10.6) - 0.8, 128).translate((0, 0, 9))
    return shell - groove


def make_base_fixed():
    shell = base_shell()
    boss = Manifold.cylinder(8.0 + 0.5, 9.5, 9.5, SEG).translate((0, 0, B_H - B_TOP - 8.0))
    hole = Manifold.cylinder(30, SOCK_R, SOCK_R, SEG).translate((0, 0, B_H - B_TOP - 9.0))
    return (shell + boss) - hole


def make_base_servo():
    shell = base_shell()
    # cuerpo del servo: el eje queda en el centro de la base
    cut = Manifold.cube((SG_L + 0.4, SG_W + 0.4, 20), True).translate((SG_SHAFT_OFF, 0, B_H))
    pilots = [Manifold.cylinder(10, 0.9, 0.9, 16).translate((SG_SHAFT_OFF + sx * SG_HOLES / 2, 0, B_H - 6))
              for sx in (-1, 1)]
    cable = Manifold.cube((7, 3.5, 20), True).translate((0, -20, B_H))
    return shell - Manifold.batch_boolean([cut, cable] + pilots, _op_add())


def make_device_dummy():
    """Solo para el visor: un CoreS3 de mentira, en coordenadas de la cabeza."""
    d = Manifold.extrude(rrect(DEV, DEV, 4.0), DEV_T).translate((0, 0, FRONT_T + 0.02))
    return d


# ================================================================= montaje
def head_to_world():
    """Matriz 4x4 que coloca la cabeza encima del cuello."""
    Rl = rot_x(TILT) @ rot_x(90)
    e = Rl @ E_LOCAL
    target = np.array([0, 0, B_H + NECK_H])
    M = np.eye(4)
    M[:3, :3] = Rl
    M[:3, 3] = target - e
    return M


def apply4(m, M):
    return m.transform(affine(M[:3, :3], M[:3, 3]))


# ================================================================= exportar
def mesh_arrays(m):
    mesh = m.to_mesh()
    v = np.asarray(mesh.vert_properties, dtype=np.float32)[:, :3]
    f = np.asarray(mesh.tri_verts, dtype=np.uint32)
    return v, f


def write_stl(m, path, name):
    v, f = mesh_arrays(m)
    tri = v[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    n = (n / ln).astype(np.float32)
    with open(path, "wb") as fh:
        header = (name.encode("ascii", "ignore") + b" - BIP robot")[:80].ljust(80, b" ")
        fh.write(header)
        fh.write(struct.pack("<I", len(f)))
        data = np.zeros(len(f), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
        data["n"] = n
        data["v"] = tri
        fh.write(data.tobytes())


def to_print(m):
    """Apoya la pieza en z=0 y la centra en X/Y."""
    b = m.bounding_box()
    return m.translate((-(b[0] + b[3]) / 2, -(b[1] + b[4]) / 2, -b[2]))


def pack(m):
    v, f = mesh_arrays(m)
    idx = f.astype(np.uint16) if len(v) < 65535 else f
    return {
        "v": base64.b64encode(v.astype(np.float32).tobytes()).decode(),
        "i": base64.b64encode(idx.tobytes()).decode(),
        "i32": bool(len(v) >= 65535),
    }


def main():
    os.makedirs(OUT_STL, exist_ok=True)
    os.makedirs(OUT_BUILD, exist_ok=True)

    head = make_head()
    cap = make_cap()
    antenna, peg_start = make_antenna()
    neck = make_neck_fixed()
    neck_s = make_neck_servo()
    base = make_base_fixed()
    base_s = make_base_servo()

    # ---------- STL en orientacion de impresion
    flip = affine(rot_y(180))
    prints = {
        "1_cabeza.stl": head,                                # frente sobre la cama
        "2_tapa_trasera.stl": cap.transform(flip),           # cara exterior sobre la cama
        "3_antena_x2.stl": antenna,                          # bola abajo
        "4_cuello.stl": neck,                                # de pie
        "5_base.stl": base.transform(flip),                  # boca abajo
        "opcional_servo_base.stl": base_s.transform(flip),
        "opcional_servo_cuello.stl": neck_s,                 # brida abajo
    }
    report = []
    for fname, part in prints.items():
        p = to_print(part)
        write_stl(p, os.path.join(OUT_STL, fname), fname)
        b = p.bounding_box()
        vol = p.volume() / 1000.0  # cm3
        report.append((fname, b[3] - b[0], b[4] - b[1], b[5] - b[2], vol, p.genus(), p.num_tri()))

    # ---------- montaje para el visor (coordenadas del mundo, Z arriba, frente hacia +Y)
    M = head_to_world()
    parts = []

    def add(name, m, color, explode, kind="print"):
        parts.append({"name": name, "color": color, "explode": list(map(float, explode)),
                      "kind": kind, **pack(m)})

    back_dir = M[:3, :3] @ np.array([0, 0, 1.0])  # hacia atras de la cabeza
    up_dir = M[:3, :3] @ np.array([0, 1.0, 0])
    add("cabeza", apply4(head, M), "#e9ecef", up_dir * 22)
    add("tapa", apply4(cap, M), "#d9dde2", up_dir * 22 + back_dir * 34)
    add("cores3", apply4(make_device_dummy(), M), "#2a2d33", up_dir * 22 + back_dir * 17, "device")
    # antenas: la espiga entra en el agujero
    for sx in (-1, 1):
        axis_l = np.array([sx * math.sin(math.radians(ANT_LEAN)), math.cos(math.radians(ANT_LEAN)), 0])
        top_l = np.array([sx * ANT_X, Y_TOP, ANT_Z])
        # en coords de impresion la antena va hacia +Z con la bola abajo: la giramos 180
        a = antenna.transform(affine(rot_x(180)))           # bola arriba, espiga abajo
        a = a.translate((0, 0, peg_start))                   # collar sobre z=0, espiga hacia -Z
        a = a.transform(affine(frame_from_z(axis_l), top_l))
        add("antena", apply4(a, M), "#f2a03d", up_dir * 22 + M[:3, :3] @ axis_l * 16)
    neck_w = neck.translate((0, 0, B_H))
    add("cuello", neck_w, "#c9ced6", (0, 0, 10))
    add("base", base, "#e9ecef", (0, 0, 0))

    # pantalla: cuatro esquinas en el mundo (se pinta la cara encima)
    sw, sh, sy = 40.8, 30.6, 6.0   # tamano visible de la pantalla y posicion aproximada
    zf = FRONT_T - 0.05
    corners_l = [(-sw / 2, sy - sh / 2, zf), (sw / 2, sy - sh / 2, zf),
                 (sw / 2, sy + sh / 2, zf), (-sw / 2, sy + sh / 2, zf)]
    corners = [(M[:3, :3] @ np.array(c) + M[:3, 3]).tolist() for c in corners_l]
    cam = (M[:3, :3] @ np.array([0, -19.5, zf]) + M[:3, 3]).tolist()
    data = {
        "parts": parts,
        "screen": {"corners": corners, "explode": (up_dir * 22 + back_dir * 17).tolist()},
        "camera": {"pos": cam, "normal": (M[:3, :3] @ np.array([0, 0, -1.0])).tolist()},
        "dims": {"W": W, "H": H, "D": D_HEAD + CAP_T, "total_h": float(B_H + NECK_H + H)},
    }
    with open(os.path.join(OUT_BUILD, "viewer_data.json"), "w") as fh:
        json.dump(data, fh)

    print(f"Cabeza: {W:.1f} x {H:.1f} x {D_HEAD + CAP_T:.1f} mm")
    print(f"{'pieza':28s} {'X':>6s} {'Y':>6s} {'Z':>6s} {'cm3':>6s} genus tris")
    for r in report:
        print(f"{r[0]:28s} {r[1]:6.1f} {r[2]:6.1f} {r[3]:6.1f} {r[4]:6.1f} {r[5]:5d} {r[6]}")
    # altura total montado
    allb = [apply4(head, M).bounding_box(), base.bounding_box()]
    print("Altura total montado (sin antenas): %.1f mm" % allb[0][5])


if __name__ == "__main__":
    main()
