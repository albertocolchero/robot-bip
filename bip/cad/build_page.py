"""Mete los datos del modelo 3D dentro de la guía: page/guia_src.html -> guia.html"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")

with open(os.path.join(ROOT, "page", "guia_src.html"), encoding="utf-8") as fh:
    src = fh.read()
with open(os.path.join(ROOT, "build", "viewer_data.json"), encoding="utf-8") as fh:
    data = fh.read()

marker = "/*__VIEWER_DATA__*/null"
assert marker in src, "no encuentro el hueco para los datos"
out = src.replace(marker, data)
with open(os.path.join(ROOT, "guia.html"), "w", encoding="utf-8") as fh:
    fh.write(out)
print("guia.html:", round(len(out.encode("utf-8")) / 1024), "KB")
