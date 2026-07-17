#!/usr/bin/env python3
"""GanttChart のビルドスクリプト。

`src/` 配下のファイルを連結して、単一の自己完結した `dist/index.html` を生成する。
Python 3 標準ライブラリ(pathlib)のみを使う — 依存関係のインストールは不要。

置き換えるプレースホルダー(src/index.html 内):
  <!-- BUILD:STYLES --> → src/styles.css を <style> にインライン化
  <!-- BUILD:VENDOR --> → VENDOR_FILES を1つずつ <script> にインライン化(現状は空)
  <!-- BUILD:APP -->    → APP_FILES を1つの <script> に連結

APP_FILES の順序は「依存関係の順序」であり、glob順ではない。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"

# 依存の少ないものから先に。main.js は最後(DOMContentLoaded で全体を配線するため)。
APP_FILES = [
    "app/util.js",
    "app/holidays.js",
    "app/db.js",
    "app/state.js",
    "app/ui.js",
    "app/projects.js",
    "app/schedules.js",
    "app/dependencies.js",
    "app/milestones.js",
    "app/gantt.js",
    "app/assist.js",
    "app/exportimport.js",
    "app/history.js",
    "app/main.js",
]

# CDN からは読み込まない。将来ベンダリングするライブラリをここに列挙する。
VENDOR_FILES = []


def read(rel):
    return (SRC / rel).read_text(encoding="utf-8")


def build():
    html = read("index.html")

    styles = read("styles.css")
    html = html.replace("<!-- BUILD:STYLES -->", f"<style>\n{styles}\n</style>")

    vendor_blocks = []
    for rel in VENDOR_FILES:
        vendor_blocks.append(f"<script>\n{read(rel)}\n</script>")
    html = html.replace("<!-- BUILD:VENDOR -->", "\n".join(vendor_blocks))

    app_parts = []
    for rel in APP_FILES:
        app_parts.append(f"// ===== {rel} =====\n{read(rel)}")
    app = "\n\n".join(app_parts)
    html = html.replace("<!-- BUILD:APP -->", f"<script>\n{app}\n</script>")

    DIST.mkdir(exist_ok=True)
    out = DIST / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"built {out}  ({len(html):,} bytes)")


if __name__ == "__main__":
    build()
