// Watchtower — 눌러서 빨리 감기 (격리 세계)
// 역할: 영상을 좌클릭으로 길게 누르면 2배속, 떼면 원래 속도로 복원.
//       범용 <video> 대상(치지직 VOD·YouTube 등) — 페이지 플레이어 내부에
//       의존하지 않고 video.playbackRate를 직접 제어한다.
//       cheese-knife(MIT)의 press-to-fast-forward 아이디어를 참고해 범용화.
//       참고: https://github.com/jebibot/cheese-knife

(() => {
    "use strict";

    const WT = window.WT;

    const HOLD_MS = 500;        // 이 시간 이상 눌러야 빨리감기 시작 (짧은 클릭=재생/일시정지 보존)
    const MOVE_TOLERANCE = 10;  // 이만큼 움직이면 드래그(탐색)로 보고 취소(px)
    const SPEED = 2;
    const IND_ID = "wt-ff-indicator";

    let enabled = false;
    let pressTimer = null;
    let ffActive = false;
    let video = null;
    let originalRate = 1;
    let wasPaused = false;
    let startX = 0, startY = 0;

    // 좌표 위에 있는(보이는) video 찾기 — YouTube처럼 오버레이가 영상 위에 덮인 경우 대응
    function videoAtPoint(x, y) {
        for (const v of document.querySelectorAll("video")) {
            const r = v.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return v;
            }
        }
        return null;
    }

    function onMouseDown(e) {
        if (e.button !== 0) return;          // 좌클릭만
        const v = videoAtPoint(e.clientX, e.clientY);
        if (!v) return;
        startX = e.clientX;
        startY = e.clientY;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => startFF(v), HOLD_MS);
        document.addEventListener("mousemove", onMouseMove, true);
        document.addEventListener("mouseup", onMouseUp, true);
    }

    function onMouseMove(e) {
        if (ffActive) return;                // 빨리감기 중엔 약간의 이동 허용
        if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE ||
            Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
            clearTimeout(pressTimer);        // 드래그(탐색 등) → 빨리감기 취소
            detachMoveUp();
        }
    }

    function onMouseUp() {
        clearTimeout(pressTimer);
        detachMoveUp();
        if (ffActive) stopFF();
    }

    function detachMoveUp() {
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("mouseup", onMouseUp, true);
    }

    function startFF(v) {
        ffActive = true;
        video = v;
        originalRate = v.playbackRate;
        try { v.playbackRate = SPEED; } catch {}
        wasPaused = v.paused;
        if (wasPaused) v.play().catch(() => {});
        showIndicator(v);
        WT.log("speed", "빨리감기 시작", SPEED + "x");
    }

    function stopFF() {
        try { if (video) video.playbackRate = originalRate; } catch {}
        if (video && wasPaused) video.pause();
        hideIndicator();
        ffActive = false;
        video = null;
        suppressNextClick();   // 빨리감기 후의 click이 재생/일시정지를 토글하지 않게
    }

    // 빨리감기 종료 직후 발생하는 click 1회를 삼킨다 (play/pause 오작동 방지)
    function suppressNextClick() {
        const swallow = (e) => {
            e.preventDefault();
            e.stopPropagation();
            cleanup();
        };
        const cleanup = () => document.removeEventListener("click", swallow, true);
        document.addEventListener("click", swallow, true);
        setTimeout(cleanup, 400);  // click이 안 오면 정리
    }

    function showIndicator(v) {
        hideIndicator();
        const el = document.createElement("div");
        el.id = IND_ID;
        el.textContent = SPEED + "×";  // 2×
        el.style.cssText =
            "position:fixed;z-index:2147483647;pointer-events:none;" +
            "padding:6px 12px;border-radius:8px;background:rgba(0,0,0,.75);" +
            "color:#fff;font:700 15px/1 -apple-system,BlinkMacSystemFont,sans-serif;" +
            "transform:translateX(-50%);";
        // 전체화면 중에는 전체화면 요소 안에 넣어야 보인다
        const parent = document.fullscreenElement || document.body || document.documentElement;
        parent.appendChild(el);
        const r = v.getBoundingClientRect();
        el.style.left = (r.left + r.width / 2) + "px";
        el.style.top = (r.top + 16) + "px";
    }

    function hideIndicator() {
        document.getElementById(IND_ID)?.remove();
    }

    function bind() {
        document.addEventListener("mousedown", onMouseDown, true);
    }

    function unbind() {
        document.removeEventListener("mousedown", onMouseDown, true);
        clearTimeout(pressTimer);
        detachMoveUp();
        if (ffActive) stopFF();
        hideIndicator();
    }

    function apply(on) {
        if (on === enabled) return;
        enabled = on;
        on ? bind() : unbind();
    }

    // --- 설정 로드 + 변경 감지 (공용 기반 WT) ---
    WT.watch(["pressFastForwardEnabled"], (c) => {
        if (c.pressFastForwardEnabled) apply(c.pressFastForwardEnabled.newValue ?? false);
    });
    WT.load(["pressFastForwardEnabled"])
        .then(r => apply(r.pressFastForwardEnabled ?? false))
        .catch(() => {});
})();
