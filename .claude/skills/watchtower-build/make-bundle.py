#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 상황실 로직을 Safari MCP evaluate_javascript 로 주입하기 위한 번들 생성기.
# 확장 API(browser.i18n / storage / runtime) shim + wt-core.js + adskip.js + room.js + room.css 를 한 덩어리로 출력한다.
import json, re, sys, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
R = os.path.join(ROOT, "Shared (Extension)", "Resources")
read = lambda f: open(os.path.join(R, f), encoding="utf-8").read()
ko = json.load(open(os.path.join(R, "_locales", "ko", "messages.json"), encoding="utf-8"))
msgs = {k: v["message"] for k, v in ko.items()}
css = re.sub(r"/\*.*?\*/", "", read("room.css"), flags=re.S); css = re.sub(r"\n\s*\n", "\n", css); css = re.sub(r"\n\s+", "\n", css)
strip = lambda s: re.sub(r"\n\s*\n", "\n", re.sub(r"^\s*//.*$", "", s, flags=re.M))
core, adskip, room = strip(read("wt-core.js")), strip(read("adskip.js")), strip(read("room.js"))
room = room.replace("    main();\n})();", "    window.__wt = { state, tiles, render, addChannel, removeChannel, swapChannels, enterFocus, exitFocus, checkPlayback, retryTile, fitTiles };\n    main();\n})();")
# 초기 상태 — 필요에 맞게 바꾼다
store = {
    "roomChannels": [{"id": "7ce8032370ac5121dcabce7bad375ced", "name": "풍월량"}, {"id": "64d76089fba26b180d9c9e48a32600d9", "name": "텐코 시부키"}],
    "roomSound": [], "roomLayout": {"cols": "auto", "fit": False}, "roomChatSide": "right",
}
shim = f"""window.__wtStore = window.__wtStore || {json.dumps(store, ensure_ascii=False)};
const __msgs = {json.dumps(msgs, ensure_ascii=False)};
window.browser = {{ i18n: {{ getMessage: (k) => __msgs[k] || "" }}, storage: {{ local: {{ get: (keys) => Promise.resolve(Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k => [k, window.__wtStore[k]]))), set: (obj) => {{ Object.assign(window.__wtStore, obj); return Promise.resolve(); }} }} }}, runtime: {{ onMessage: {{ addListener: () => {{}} }} }} }};
window.__wtErrors = []; window.addEventListener("error", e => window.__wtErrors.push(String(e.message))); window.addEventListener("unhandledrejection", e => window.__wtErrors.push("rej:" + String(e.reason)));
const __style = document.createElement("style"); __style.textContent = {json.dumps(css, ensure_ascii=False)};
"""
sys.stdout.write(shim + core + "\n" + adskip + "\n" + room + "\ndocument.head.appendChild(__style);\nreturn 'injected: ' + document.title;\n")
