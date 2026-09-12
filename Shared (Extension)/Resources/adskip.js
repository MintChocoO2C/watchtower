// Watchtower — 치지직 광고 자동 건너뛰기 (격리 세계)
// 역할: 치지직 플레이어가 광고 중에 띄우는 SKIP 버튼(button.btn_skip)이 누를 수 있게 되는 순간
//       (hide 클래스가 벗겨지는 순간) 대신 눌러 준다. 광고를 차단하거나 빨리 돌리지는 않는다 —
//       플랫폼이 허용한 '건너뛰기' 를 사람 대신 누르는 것뿐이다.
//
// 구조: 문서 하나당 MutationObserver 하나. 일반 치지직 탭에서는 자기 문서를 감시하고,
//       상황실(room.js)은 타일 iframe 이 뜰 때마다 WT.adSkip.watch(contentDocument) 로 등록한다.
//       (content script 는 최상위 프레임에서만 돌기 때문에 상황실 타일은 부모가 대신 붙여 준다)
// 켜고 끄기: 설정 chzzkAdSkipEnabled (기본 켜짐). 꺼지면 감시는 유지하되 누르지 않는다.

(() => {
    "use strict";

    const WT = window.WT;
    const KEY = "chzzkAdSkipEnabled";
    const HOST_RE = /(^|\.)chzzk\.naver\.com$/;
    const SKIP_SELECTOR = "button.btn_skip";
    const RECLICK_MS = 1_500;   // 같은 버튼을 다시 누르기까지 최소 간격 (첫 클릭이 씹혔을 때만 재시도)

    let enabled = true;
    const watched = new Map();          // Document -> { observer, timer }
    const lastClick = new WeakMap();    // button -> timestamp

    // 버튼이 실제로 보이는가 — hide 클래스는 물론 display:none 도 걸러낸다
    function clickable(btn) {
        if (btn.classList.contains("hide") || btn.disabled) return false;
        if (!btn.getClientRects().length) return false;
        return getComputedStyle(btn).visibility !== "hidden";
    }

    function tryClick(doc) {
        if (!enabled) return;
        let btns;
        try { btns = doc.querySelectorAll(SKIP_SELECTOR); } catch { return; }
        const now = Date.now();
        for (const btn of btns) {
            if (!clickable(btn)) continue;
            if (now - (lastClick.get(btn) || 0) < RECLICK_MS) continue;
            lastClick.set(btn, now);
            btn.click();
            WT.log("adskip", "SKIP 버튼 클릭", doc.location?.pathname);
        }
    }

    // 변화가 몰려올 때 한 번만 검사하도록 지연
    function schedule(doc) {
        const w = watched.get(doc);
        if (!w || w.timer) return;
        w.timer = setTimeout(() => { w.timer = null; tryClick(doc); }, 50);
    }

    // 문서 감시 시작. 같은 문서를 두 번 등록해도 하나만 남는다. 해제 함수를 돌려준다.
    function watch(doc) {
        if (!doc || watched.has(doc)) return () => unwatch(doc);
        const root = doc.documentElement;
        if (!root) return () => {};
        const observer = new MutationObserver(() => schedule(doc));
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        watched.set(doc, { observer, timer: null });
        schedule(doc);
        WT.log("adskip", "감시 시작", doc.location?.pathname);
        return () => unwatch(doc);
    }

    function unwatch(doc) {
        const w = watched.get(doc);
        if (!w) return;
        w.observer.disconnect();
        clearTimeout(w.timer);
        watched.delete(doc);
    }

    WT.adSkip = { watch, unwatch };

    // --- 설정 로드 + 변경 감지 ---
    function apply(on) {
        enabled = on;
        if (on) for (const doc of watched.keys()) schedule(doc);
    }
    WT.watch([KEY], (c) => { if (c[KEY]) apply(c[KEY].newValue ?? true); });
    WT.load([KEY]).then(r => apply(r[KEY] ?? true)).catch(() => {});

    // 일반 치지직 페이지면 자기 문서를 바로 감시. 상황실(/wt-room)은 타일마다 room.js 가 등록한다.
    if (HOST_RE.test(location.hostname) && !location.pathname.startsWith("/wt-room")) {
        watch(document);
    }
})();
