// Watchtower — 마우스 제스처 (격리된 세계)
// 역할: 휠(가운데) 버튼을 누른 채 방향 제스처로 핵심 네비게이션을 실행.
//       물리 마우스 전제. content script만으로 완결 (background/추가 권한 불필요).
//       휠 버튼은 우클릭 메뉴를 띄우지 않으므로 Safari의 contextmenu 충돌이 없고,
//       우클릭 메뉴·프레임 캡처가 그대로 유지된다. 움직임이 있을 때만 휠클릭의
//       기본 동작(링크 새 탭 열기)을 막고, 단순 휠클릭은 그대로 통과시킨다.

(() => {
    "use strict";

    const MIN_SEGMENT = 30;          // 방향 토큰 1개로 인정할 최소 이동(px)
    const HUD_ID = "wt-gesture-hud";
    const ARROW = { L: "←", R: "→", U: "↑", D: "↓" };

    let enabled = false;
    let debug = false;
    let tracking = false;
    let lastX = 0, lastY = 0;
    let sequence = [];               // ["L","R","U","D"] 방향 토큰 누적
    let gesturePerformed = false;    // 움직임 발생 → 휠클릭 기본동작 억제 플래그

    // 궤적(trail) 그리기용 캔버스
    const TRAIL_ID = "wt-gesture-trail";
    let canvas = null, ctx = null, drawLastX = 0, drawLastY = 0;

    const log = (...a) => { if (debug) console.log("[WT][gesture]", ...a); };

    // 제스처(방향 토큰 연결) → 동작
    const ACTIONS = {
        "L":  { msg: "gestureBack",     run: () => history.back() },
        "R":  { msg: "gestureForward",  run: () => history.forward() },
        "U":  { msg: "gestureTop",      run: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
        "D":  { msg: "gestureBottom",   run: () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }) },
        "DU": { msg: "gestureReload",   run: () => location.reload() },
    };

    function onMouseDown(e) {
        if (e.button !== 1) return;  // 휠(가운데) 버튼만
        tracking = true;
        gesturePerformed = false;
        sequence = [];
        lastX = e.clientX;
        lastY = e.clientY;
        startTrail(e.clientX, e.clientY);
    }

    function onMouseMove(e) {
        if (!tracking) return;
        addTrailPoint(e.clientX, e.clientY);   // 매 이동마다 궤적 그리기

        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const adx = Math.abs(dx), ady = Math.abs(dy);
        if (Math.max(adx, ady) < MIN_SEGMENT) return;

        const dir = adx > ady ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
        lastX = e.clientX;
        lastY = e.clientY;

        if (sequence[sequence.length - 1] !== dir) {
            sequence.push(dir);
            gesturePerformed = true;   // 휠클릭 기본동작 억제 예약
            showHud(false);            // 실시간 화살표 미리보기
        }
    }

    function onMouseUp(e) {
        if (!tracking) return;
        tracking = false;
        endTrail();
        if (!gesturePerformed) { removeHud(); return; }  // 단순 휠클릭 → 동작 없음 (새 탭 열기 등 통과)

        const key = sequence.join("");
        const action = ACTIONS[key];
        log("제스처:", key || "(없음)", action ? "→ " + action.msg : "(매핑 없음)");
        showHud(true);                  // 최종 화살표 + 동작명 표시
        fadeHud();                      // 잠시 유지 후 사라짐
        if (action) {
            try { action.run(); } catch (err) { log("실행 오류:", err?.message); }
        }
    }

    // 제스처가 수행된 경우에만 휠클릭 기본 동작(링크 새 탭 열기)을 막는다.
    // 단순 휠클릭(움직임 없음)은 그대로 통과시켜 새 탭 열기를 유지한다.
    function onAuxClick(e) {
        if (e.button === 1 && gesturePerformed) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function t(key) {
        try { return browser.i18n.getMessage(key) || key; }
        catch { return key; }
    }

    // --- 궤적(붓 같은 발광 스트로크) ---
    function startTrail(x, y) {
        removeCanvas();
        canvas = document.createElement("canvas");
        canvas.id = TRAIL_ID;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.cssText =
            "position:fixed;left:0;top:0;width:100vw;height:100vh;" +
            "z-index:2147483647;pointer-events:none;transition:opacity .25s;opacity:1;";
        (document.body || document.documentElement).appendChild(canvas);
        ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(74,158,255,0.95)";
        ctx.shadowColor = "rgba(74,158,255,0.85)";
        ctx.shadowBlur = 10;
        drawLastX = x;
        drawLastY = y;
    }

    function addTrailPoint(x, y) {
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(drawLastX, drawLastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        drawLastX = x;
        drawLastY = y;
    }

    function endTrail() {
        if (!canvas) return;
        const c = canvas;
        canvas = null;
        ctx = null;
        c.style.opacity = "0";
        setTimeout(() => c.remove(), 280);
    }

    function removeCanvas() {
        document.getElementById(TRAIL_ID)?.remove();
        canvas = null;
        ctx = null;
    }

    // --- 피드백 HUD: 화살표(진행 중) + 동작명(완료 시) ---
    function ensureHud() {
        let el = document.getElementById(HUD_ID);
        if (!el) {
            el = document.createElement("div");
            el.id = HUD_ID;
            el.style.cssText =
                "position:fixed;left:50%;bottom:14%;transform:translateX(-50%);" +
                "z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:6px;" +
                "padding:14px 22px;border-radius:16px;background:rgba(20,20,22,.86);color:#fff;" +
                "pointer-events:none;transition:opacity .2s;opacity:0;" +
                "font-family:-apple-system,BlinkMacSystemFont,sans-serif;" +
                "box-shadow:0 6px 24px rgba(0,0,0,.4);";
            const arrows = document.createElement("div");
            arrows.dataset.role = "arrows";
            arrows.style.cssText = "font-size:34px;line-height:1;letter-spacing:8px;font-weight:700;";
            const label = document.createElement("div");
            label.dataset.role = "label";
            label.style.cssText = "font-size:14px;font-weight:600;opacity:.9;min-height:17px;";
            el.append(arrows, label);
            (document.body || document.documentElement).appendChild(el);
        }
        return el;
    }

    // final=false: 진행 중(화살표만) / final=true: 완료(화살표 + 동작명)
    function showHud(final) {
        const el = ensureHud();
        clearTimeout(el._wtTimer);
        const arrowStr = sequence.map(d => ARROW[d] || "").join("");
        const action = ACTIONS[sequence.join("")];
        el.querySelector('[data-role="arrows"]').textContent = arrowStr || "·";
        // 진행 중에도 매핑되면 동작명 미리보기, 완료 시엔 확정 표시
        el.querySelector('[data-role="label"]').textContent = action ? t(action.msg) : (final ? "—" : "");
        el.style.opacity = "1";
    }

    function fadeHud() {
        const el = document.getElementById(HUD_ID);
        if (!el) return;
        clearTimeout(el._wtTimer);
        el._wtTimer = setTimeout(() => {
            el.style.opacity = "0";
            setTimeout(() => el.remove(), 250);
        }, 750);
    }

    function removeHud() {
        const el = document.getElementById(HUD_ID);
        if (el) { clearTimeout(el._wtTimer); el.remove(); }
    }

    function bind() {
        document.addEventListener("mousedown", onMouseDown, true);
        document.addEventListener("mousemove", onMouseMove, true);
        document.addEventListener("mouseup", onMouseUp, true);
        document.addEventListener("auxclick", onAuxClick, true);
    }

    function unbind() {
        document.removeEventListener("mousedown", onMouseDown, true);
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("mouseup", onMouseUp, true);
        document.removeEventListener("auxclick", onAuxClick, true);
        removeHud();
        removeCanvas();
        tracking = false;
        gesturePerformed = false;
    }

    function apply(on) {
        if (on === enabled) return;
        enabled = on;
        on ? bind() : unbind();
    }

    // --- 설정 로드 + 변경 감지 (vimium.js와 동일한 자족 패턴) ---
    function loadSettings() {
        browser.storage.local.get(["mouseGestureEnabled", "debugEnabled"]).then((r) => {
            debug = r.debugEnabled ?? false;
            apply(r.mouseGestureEnabled ?? false);
        }).catch(() => {});
    }

    browser.runtime.onMessage.addListener((request) => {
        if (request.action !== "storageChanged") return;
        const c = request.changes || {};
        if (c.debugEnabled) debug = c.debugEnabled.newValue ?? false;
        if (c.mouseGestureEnabled) apply(c.mouseGestureEnabled.newValue ?? false);
    });

    loadSettings();
})();
