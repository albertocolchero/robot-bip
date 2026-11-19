"""
BIP v2 - el cuerpo es un iPhone 14 en horizontal (pantalla = cara).
Genera las piezas imprimibles (STL) a partir de medidas. Todas las cotas en mm.

Uso:  python bip_iphone_cad.py   -> ../stl/*.stl y ../build/viewer_data.json
Requiere: pip install manifold3d numpy  (usa las utilidades de bip_cad.py)

Vista de frente, el iPhone va girado a la derecha:
  - conector Lightning a la IZQUIERDA (sale el cable)
  - muesca con la camara frontal a la DERECHA
  - volumen y silencio ARRIBA, boton lateral ABAJO
  - camara trasera detras, abajo a la derecha
Ojo: en coordenadas de la pieza, la DERECHA de quien mira es -X.
"""
import json
import math
import os

import numpy as np
from manifold3d import Manifold

from bip_cad import (SEG, _op_add, affine, apply4, chamfered_prism, frame_from_z, pack,
                     rod, rot_x, rot_y, rrect, slab, to_print, write_stl)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_STL = os.path.join(HERE, "..", "stl")
OUT_BUILD = os.path.join(HERE, "..", "build")

# ---------------------------------------------------------------- iPhone 14 (ficha de Apple)
PH_L, PH_H, PH_T = 146.7, 71.5, 7.8
PH_R = 9.0                    # radio de las esquinas del telefono (aprox.)
SCR_W, SCR_H = 139.8, 64.6    # zona de pantalla 2532 x 1170 px a 460 ppp

# ---------------------------------------------------------------- holguras
CLR = 0.5          # alrededor del telefono
PEG_CLR = 0.2

# ---------------------------------------------------------------- cabeza
CAV_L, CAV_H = PH_L + 2 * CLR, PH_H + 2 * CLR
WE, WT, WB = 6.0, 7.0, 14.0           # paredes: extremos, arriba, abajo
W = CAV_L + 2 * WE
H = CAV_H + WT + WB
YOFF = (WT - WB) / 2
R = 16.0
FRONT_T = 2.0
D_HEAD = 24.0                          # fondo de la cabeza (deja hueco detras del movil)
PH_BACK = FRONT_T + PH_T + 0.5         # donde acaba el telefono por detras
CH_F, CH_B = 2.5, 2.5
CAP_T = 2.4
TILT = 10.0

WIN_IN_L, WIN_IN_H = SCR_W + 1.2, SCR_H + 1.4   # ventana: no tapa pixeles
WIN_CH = 1.8                                      # chaflan de la ventana

PEG_R = 7.5
SOCK_R = PEG_R + PEG_CLR
SOCK_DEPTH = 10.0
ZS = D_HEAD / 2

ANT_X = W / 2 - 14
ANT_Z = 6.0
ANT_LEAN = 15.0
ANT_R, ANT_HOLE_R, ANT_HOLE_D = 1.8, 1.88, 5.5

# ---------------------------------------------------------------- cuello y base
NECK_R, NECK_H = 13.0, 18.0
B_L, B_D, B_H = 168.0, 96.0, 42.0      # base: largo, fondo, alto
B_R, B_WALL, B_TOP, B_FLOOR = 18.0, 2.6, 3.0, 2.4
BOSS_R, BOSS_H = 12.0, 12.0


# =============================================================== utilidades
def x_from_right(d):
    """Coordenada X local a 'd' mm del extremo derecho del hueco (visto de frente)."""
    return -CAV_L / 2 + d


def head_profile(inset):
    return rrect(W - 2 * inset, H - 2 * inset, R - inset, 0, YOFF)


def slot_y(x0, x1, zc, width, y0, y1):
    """Ranura alargada en X que atraviesa una pared horizontal (de y0 a y1)."""
    rr = width / 2
    a = rod((x0 + rr, y0, zc), (0, 1, 0), y1 - y0, rr)
    b = rod((x1 - rr, y0, zc), (0, 1, 0), y1 - y0, rr)
    return Manifold.batch_hull([a, b])


def vent_y(x, z0, z1, width, y0, y1):
    """Rejilla vertical (alargada en Z) que atraviesa una pared horizontal."""
    rr = width / 2
    a = rod((x, y0, z0 + rr), (0, 1, 0), y1 - y0, rr)
    b = rod((x, y0, z1 - rr), (0, 1, 0), y1 - y0, rr)
    return Manifold.batch_hull([a, b])


UP_LOCAL = np.array([0, math.cos(math.radians(TILT)), -math.sin(math.radians(TILT))])
Y_BOT = YOFF - H / 2
Y_TOP = YOFF + H / 2
E_LOCAL = np.array([0.0, Y_BOT, ZS])


# =============================================================== piezas
def make_head():
    body = chamfered_prism(head_profile, 0, D_HEAD, CH_F, 0)
    cav = Manifold.extrude(rrect(CAV_L, CAV_H, 6.0), D_HEAD + 1).translate((0, 0, FRONT_T))
    k = 2 * WIN_CH / FRONT_T
    win = Manifold.batch_hull([
        slab(rrect(WIN_IN_L + 2 * WIN_CH + k * 0.5, WIN_IN_H + 2 * WIN_CH + k * 0.5, 9.5), -0.5),
        slab(rrect(WIN_IN_L - k * 0.5, WIN_IN_H - k * 0.5, 7.0), FRONT_T + 0.5),
    ])
    # muesca: deja libres el altavoz de llamada y los sensores de la camara frontal
    notch = Manifold.cube((6.0, 34.0, FRONT_T + 2), True).translate((-CAV_L / 2 + 2.2, 0, FRONT_T / 2))
    zc = FRONT_T + PH_T / 2 + 0.25
    y_top_in, y_bot_in = CAV_H / 2, -CAV_H / 2
    # botones: volumen y silencio arriba, boton lateral abajo (medidas desde el extremo derecho)
    vol = slot_y(x_from_right(14), x_from_right(72), zc, 6.0, y_top_in - 1, Y_TOP + 1)
    side = slot_y(x_from_right(28), x_from_right(62), zc, 6.0, Y_BOT - 1, y_bot_in + 1)
    # extremo izquierdo: conector Lightning, altavoz y microfonos
    port = Manifold.cube((WE + 2, 46.0, PH_T + 1.2), True).translate((CAV_L / 2 + WE / 2, 0, FRONT_T + PH_T / 2 + 0.25))
    # chimenea: el aire entra por abajo, pasa por detras del movil y sale por arriba
    vents = []
    for x in (-56, -48, -40, -32, -24, -16, 16, 24, 32, 40, 48, 56):
        vents.append(vent_y(x, PH_BACK + 2.0, D_HEAD - 1.5, 3.0, y_top_in - 1, Y_TOP + 1))
        vents.append(vent_y(x, PH_BACK + 2.0, D_HEAD - 1.5, 3.0, Y_BOT - 1, y_bot_in + 1))
    apex_dir = np.array([0, math.sin(math.radians(TILT)), math.cos(math.radians(TILT))])
    start = E_LOCAL - 2 * UP_LOCAL
    sock = Manifold.batch_hull([
        rod(start, UP_LOCAL, SOCK_DEPTH + 2, SOCK_R),
        rod(start + apex_dir * SOCK_R * 1.35, UP_LOCAL, SOCK_DEPTH + 2, 0.05),
    ])
    ants = []
    for sx in (-1, 1):
        axis = np.array([sx * math.sin(math.radians(ANT_LEAN)), math.cos(math.radians(ANT_LEAN)), 0])
        top = np.array([sx * ANT_X, Y_TOP, ANT_Z])
        ants.append(rod(top + axis * 2, -axis, ANT_HOLE_D + 2, ANT_HOLE_R))
    cut = Manifold.batch_boolean([cav, win, notch, vol, side, port, sock] + vents + ants, _op_add())
    return body - cut


def make_cap():
    """Tapa trasera: placa con ventana grande y un marco que empuja el movil hacia delante."""
    plate = chamfered_prism(head_profile, D_HEAD, D_HEAD + CAP_T, 0, CH_B)
    ring_o_l, ring_o_h = CAV_L - 0.3, CAV_H - 0.3
    z0 = PH_BACK + 0.1
    hgt = D_HEAD - z0 + 0.01
    ring = Manifold.extrude(rrect(ring_o_l, ring_o_h, 5.8), hgt).translate((0, 0, z0))
    ring -= Manifold.extrude(rrect(ring_o_l - 4.4, ring_o_h - 4.4, 4.0), hgt + 2).translate((0, 0, z0 - 1))
    # hueco para la camara trasera (abajo a la derecha visto de frente = -X, -Y)
    ring -= Manifold.cube((48, 44, hgt + 2)).translate((-CAV_L / 2 - 2, -CAV_H / 2 - 2, z0 - 1))
    # huecos para que pase el aire de la chimenea (arriba y abajo)
    ring -= Manifold.cube((118, 6, hgt + 2), True).translate((0, ring_o_h / 2, z0 + hgt / 2))
    ring -= Manifold.cube((118, 6, hgt + 2), True).translate((0, -ring_o_h / 2, z0 + hgt / 2))
    ribs = []
    for (x, y) in [(ring_o_l / 2, -18), (ring_o_l / 2, 18), (-ring_o_l / 2, 18),
                   (-66, ring_o_h / 2), (66, ring_o_h / 2), (66, -ring_o_h / 2)]:
        ribs.append(Manifold.cylinder(6.0, 0.45, 0.45, 16).translate((x, y, D_HEAD - 6.0)))
    cap = plate + ring + Manifold.batch_boolean(ribs, _op_add())
    window = Manifold.extrude(rrect(112, 52, 12), 10).translate((0, 0, D_HEAD - 2))
    notch = Manifold.cylinder(1.4, 5.0, 5.0, SEG).translate((0, Y_BOT, D_HEAD - 0.01))
    return cap - window - notch


def make_antenna():
    rb = 4.6
    ball = Manifold.sphere(rb, SEG).translate((0, 0, 0.5 * rb)).trim_by_plane((0, 0, 1), 0.0)
    z_ball_top = 1.5 * rb
    rod_len = 20.0
    shaft = Manifold.cylinder(z_ball_top + rod_len - 0.5 * rb, ANT_R, ANT_R, 32).translate((0, 0, 0.5 * rb))
    zc = z_ball_top + rod_len
    collar = Manifold.batch_hull([
        Manifold.cylinder(0.01, ANT_R, ANT_R, 32).translate((0, 0, zc - 1.0)),
        Manifold.cylinder(1.0, 2.9, 2.9, 32).translate((0, 0, zc)),
    ])
    peg = Manifold.cylinder(ANT_HOLE_D - 0.5, ANT_R, ANT_R, 32).translate((0, 0, zc + 1.0))
    return ball + shaft + collar + peg, zc + 1.0


def neck_top_trim(m):
    t = math.radians(TILT)
    n = np.array([0, math.sin(t), -math.cos(t)])
    return m.trim_by_plane(tuple(n), float(np.dot(n, np.array([0, 0, NECK_H]))))


def make_neck():
    body = Manifold.batch_hull([
        Manifold.cylinder(0.01, PEG_R, PEG_R, SEG),
        Manifold.cylinder(0.01, NECK_R, NECK_R, SEG).translate((0, 0, NECK_R - PEG_R)),
        Manifold.cylinder(0.01, NECK_R, NECK_R, SEG).translate((0, 0, NECK_H + 4)),
    ])
    body = neck_top_trim(body)
    top_peg = Manifold.cylinder(SOCK_DEPTH - 0.5 + 2, PEG_R, PEG_R, SEG).translate((0, 0, NECK_H - 2))
    bot_peg = Manifold.cylinder(12.0, PEG_R, PEG_R, SEG).translate((0, 0, -12.0))
    return body + top_peg + bot_peg


def base_profile(inset):
    return rrect(B_L - 2 * inset, B_D - 2 * inset, B_R - inset)


def make_base():
    """Caja con hueco para una bateria externa. Se imprime boca abajo."""
    outer = chamfered_prism(base_profile, 0, B_H, 0, 4.0)
    inner = Manifold.extrude(base_profile(B_WALL), B_H - B_TOP + 1).translate((0, 0, -1))
    shell = outer - inner
    boss = Manifold.cylinder(BOSS_H + 0.5, BOSS_R, BOSS_R, SEG).translate((0, 0, B_H - B_TOP - BOSS_H))
    hole = Manifold.cylinder(40, SOCK_R, SOCK_R, SEG).translate((0, 0, B_H - B_TOP - BOSS_H - 1))
    # ranura trasera para los cables (la parte de atras es -Y en el mundo)
    cable = Manifold.batch_hull([
        rod((-20 + 8, -B_D / 2 - 1, 8 + B_FLOOR), (0, 1, 0), B_WALL + 2, 8),
        rod((20 - 8, -B_D / 2 - 1, 8 + B_FLOOR), (0, 1, 0), B_WALL + 2, 8),
        rod((-20 + 8, -B_D / 2 - 1, B_FLOOR - 4), (0, 1, 0), B_WALL + 2, 8),
        rod((20 - 8, -B_D / 2 - 1, B_FLOOR - 4), (0, 1, 0), B_WALL + 2, 8),
    ])
    # canal decorativo alrededor
    groove = Manifold.extrude(base_profile(-1), 1.6).translate((0, 0, 12)) - \
        Manifold.extrude(base_profile(0.8), 1.6).translate((0, 0, 12))
    return (shell + boss) - hole - cable - groove


def make_floor():
    """Suelo de la base: entra a presion por debajo y sujeta la bateria."""
    plate = chamfered_prism(base_profile, -B_FLOOR, 0, 0.8, 0)
    o = base_profile(B_WALL + 0.15)
    lip = Manifold.extrude(o, 5.0) - Manifold.extrude(base_profile(B_WALL + 2.0), 6).translate((0, 0, -0.5))
    ribs = []
    for (x, y) in [(-50, 1), (50, 1), (-50, -1), (50, -1)]:
        yy = y * (B_D / 2 - B_WALL - 0.15)
        ribs.append(Manifold.cylinder(5.0, 0.45, 0.45, 16).translate((x, yy, 0)))
    for x in (-1, 1):
        xx = x * (B_L / 2 - B_WALL - 0.15)
        ribs.append(Manifold.cylinder(5.0, 0.45, 0.45, 16).translate((xx, 0, 0)))
    floor = plate + lip + Manifold.batch_boolean(ribs, _op_add())
    # 4 huecos para tacos de goma de 10 mm
    feet = [Manifold.cylinder(1.0, 5.4, 5.4, SEG).translate((sx * (B_L / 2 - 20), sy * (B_D / 2 - 18), -B_FLOOR - 0.01))
            for sx in (-1, 1) for sy in (-1, 1)]
    return floor - Manifold.batch_boolean(feet, _op_add())


def make_phone_dummy():
    return Manifold.extrude(rrect(PH_L, PH_H, PH_R), PH_T).translate((0, 0, FRONT_T + 0.05))


def make_battery_dummy():
    return Manifold.extrude(rrect(138, 68, 6), 16).translate((0, 4, B_FLOOR * 0 + 0.2))


# =============================================================== montaje
def head_to_world():
    Rl = rot_x(TILT) @ rot_x(90)
    e = Rl @ E_LOCAL
    M = np.eye(4)
    M[:3, :3] = Rl
    M[:3, 3] = np.array([0, 0, B_H + NECK_H]) - e
    return M


def main():
    os.makedirs(OUT_STL, exist_ok=True)
    os.makedirs(OUT_BUILD, exist_ok=True)
    head, cap = make_head(), make_cap()
    antenna, peg_start = make_antenna()
    neck, base, floor = make_neck(), make_base(), make_floor()

    flip = affine(rot_y(180))
    prints = {
        "1_cabeza.stl": head,
        "2_tapa_trasera.stl": cap.transform(flip),
        "3_antena_x2.stl": antenna,
        "4_cuello.stl": neck,
        "5_base.stl": base.transform(flip),
        "6_suelo_base.stl": floor,
    }
    report = []
    for fname, part in prints.items():
        p = to_print(part)
        write_stl(p, os.path.join(OUT_STL, fname), fname)
        b = p.bounding_box()
        report.append((fname, b[3] - b[0], b[4] - b[1], b[5] - b[2], p.volume() / 1000.0, p.genus(), p.num_tri()))

    M = head_to_world()
    back_dir = M[:3, :3] @ np.array([0, 0, 1.0])
    up_dir = M[:3, :3] @ np.array([0, 1.0, 0])
    parts = []

    def add(name, m, color, explode, kind="print"):
        parts.append({"name": name, "color": color, "explode": list(map(float, explode)), "kind": kind, **pack(m)})

    add("cabeza", apply4(head, M), "#e9ecef", up_dir * 30)
    add("tapa", apply4(cap, M), "#d9dde2", up_dir * 30 + back_dir * 60)
    add("iphone", apply4(make_phone_dummy(), M), "#2a2d33", up_dir * 30 + back_dir * 30, "device")
    for sx in (-1, 1):
        axis_l = np.array([sx * math.sin(math.radians(ANT_LEAN)), math.cos(math.radians(ANT_LEAN)), 0])
        top_l = np.array([sx * ANT_X, Y_TOP, ANT_Z])
        a = antenna.transform(affine(rot_x(180))).translate((0, 0, peg_start))
        a = a.transform(affine(frame_from_z(axis_l), top_l))
        add("antena", apply4(a, M), "#f2a03d", up_dir * 30 + M[:3, :3] @ axis_l * 18)
    add("cuello", neck.translate((0, 0, B_H)), "#c9ced6", (0, 0, 14))
    add("base", base, "#e9ecef", (0, 0, 0))
    add("suelo", floor, "#d9dde2", (0, 0, -34))
    add("bateria", make_battery_dummy(), "#4a5260", (0, -70, -20), "device")

    zf = FRONT_T - 0.05
    sw, sh = SCR_W, SCR_H
    corners_l = [(-sw / 2, -sh / 2, zf), (sw / 2, -sh / 2, zf), (sw / 2, sh / 2, zf), (-sw / 2, sh / 2, zf)]
    corners = [(M[:3, :3] @ np.array(c) + M[:3, 3]).tolist() for c in corners_l]
    data = {
        "parts": parts,
        "screen": {"corners": corners, "explode": (up_dir * 30 + back_dir * 30).tolist()},
        "dims": {"W": W, "H": H, "D": D_HEAD + CAP_T},
    }
    with open(os.path.join(OUT_BUILD, "viewer_data.json"), "w") as fh:
        json.dump(data, fh)

    print(f"Cabeza: {W:.1f} x {H:.1f} x {D_HEAD + CAP_T:.1f} mm")
    print(f"{'pieza':24s} {'X':>6s} {'Y':>6s} {'Z':>6s} {'cm3':>6s} genus tris")
    for r in report:
        print(f"{r[0]:24s} {r[1]:6.1f} {r[2]:6.1f} {r[3]:6.1f} {r[4]:6.1f} {r[5]:5d} {r[6]}")
    hb = apply4(head, M).bounding_box()
    print("Altura total sin antenas: %.1f mm | huella de la base %.0f x %.0f mm" % (hb[5], B_L, B_D))


if __name__ == "__main__":
    main()
