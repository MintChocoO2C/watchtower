// Watchtower Vimium — 키보드 네비게이션 (content script, isolated world)

(function () {
    "use strict";

    // === 모드 ===
    const Mode = { NORMAL: "NORMAL", INSERT: "INSERT", HINT: "HINT" };
    let currentMode = Mode.NORMAL;
    let enabled = false;

    // === 키 시퀀스 버퍼 ===
    let keyBuffer = "";
    let keyTimer = null;
    let KEY_TIMEOUT = 1000;            // popup에서 변경 가능

    // === 숫자 prefix ===
    let countBuffer = "";

    // === HUD ===
    let hudEl = null;

    function createHUD() {
        if (hudEl) return;
        hudEl = document.createElement("div");
        hudEl.id = "wt-vimium-hud";
        hudEl.style.cssText = [
            "position: fixed",
            "bottom: 8px",
            "right: 8px",
            "padding: 4px 10px",
            "font: 12px/1.4 'SF Mono', Menlo, monospace",
            "color: #fff",
            "background: rgba(0, 0, 0, 0.7)",
            "border-radius: 4px",
            "z-index: 2147483647",
            "pointer-events: none",
            "transition: opacity 0.15s",
            "opacity: 0"
        ].join(";");
        document.documentElement.appendChild(hudEl);
    }

    function updateHUD() {
        if (!hudEl) createHUD();
        if (!enabled) {
            hudEl.style.opacity = "0";
            return;
        }

        let text = "";
        if (currentMode === Mode.INSERT) {
            text = "-- INSERT --";
        } else if (currentMode === Mode.HINT) {
            const actionLabel = hintAction === "newTab" ? "F" : hintAction === "copy" ? "yF" : "f";
            text = `-- HINT (${actionLabel}) --` + (typedPrefix ? ` ${typedPrefix.toUpperCase()}` : "");
        } else {
            // Normal 모드: 입력 중인 시퀀스 표시
            const prefix = countBuffer + keyBuffer;
            text = prefix || "";
        }

        if (text) {
            hudEl.textContent = text;
            hudEl.style.opacity = "1";
        } else {
            hudEl.style.opacity = "0";
        }
    }

    // === 모드 전환 ===
    function setMode(mode) {
        currentMode = mode;
        updateHUD();
    }

    // === 입력 필드 감지 ===
    function isEditableElement(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === "INPUT") {
            const type = (el.type || "").toLowerCase();
            // 텍스트 입력 가능한 input 타입만
            return !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(type);
        }
        if (tag === "TEXTAREA" || tag === "SELECT") return true;
        if (el.isContentEditable) return true;
        // Shadow DOM 내부의 contentEditable
        if (el.getAttribute?.("role") === "textbox") return true;
        return false;
    }

    // === 키 정규화 (IME 우회) ===
    // 한글 IME 등이 활성화된 상태에서도 e.code(물리 키 위치)로 매핑.
    // Escape/Backspace 같은 특수키는 e.key 그대로 (IME 무관).
    const SHIFT_DIGIT_MAP = { "1":"!", "2":"@", "3":"#", "4":"$", "5":"%", "6":"^", "7":"&", "8":"*", "9":"(", "0":")" };
    function normalizeKey(e) {
        const code = e.code;
        if (/^Key[A-Z]$/.test(code)) {
            const letter = code.slice(3).toLowerCase();
            return e.shiftKey ? letter.toUpperCase() : letter;
        }
        if (/^Digit[0-9]$/.test(code)) {
            const digit = code.slice(5);
            if (e.shiftKey) return SHIFT_DIGIT_MAP[digit] || digit;
            return digit;
        }
        return e.key;
    }

    // === 키 버퍼 리셋 ===
    function resetKeyState() {
        keyBuffer = "";
        countBuffer = "";
        clearTimeout(keyTimer);
        keyTimer = null;
        updateHUD();
    }

    // === 명령 매핑 ===
    const commands = {};

    function registerCommand(key, handler) {
        commands[key] = handler;
    }

    // === Phase 2: 스크롤 / 네비게이션 / 히스토리 명령 ===
    let SCROLL_STEP = 60;              // popup에서 변경 가능
    let SCROLL_BEHAVIOR = "smooth";    // "smooth" | "auto", popup에서 변경 가능

    function scrollBy(dx, dy) {
        window.scrollBy({ left: dx, top: dy, behavior: SCROLL_BEHAVIOR });
    }

    // 기본 스크롤
    registerCommand("j", (count) => scrollBy(0,  SCROLL_STEP * count));
    registerCommand("k", (count) => scrollBy(0, -SCROLL_STEP * count));
    registerCommand("h", (count) => scrollBy(-SCROLL_STEP * count, 0));
    registerCommand("l", (count) => scrollBy( SCROLL_STEP * count, 0));

    // 반 페이지
    registerCommand("d", (count) => scrollBy(0,  window.innerHeight / 2 * count));
    registerCommand("u", (count) => scrollBy(0, -window.innerHeight / 2 * count));

    // 페이지 끝점
    registerCommand("gg", () => window.scrollTo({ top: 0, behavior: SCROLL_BEHAVIOR }));
    registerCommand("G",  () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: SCROLL_BEHAVIOR }));

    // 좌우 끝점
    registerCommand("0", () => window.scrollTo({ left: 0, behavior: SCROLL_BEHAVIOR }));
    registerCommand("$", () => window.scrollTo({ left: document.documentElement.scrollWidth, behavior: SCROLL_BEHAVIOR }));

    // 히스토리
    registerCommand("H", () => history.back());
    registerCommand("L", () => history.forward());

    // 리로드
    registerCommand("r", () => location.reload());

    // === Phase 5: 탭 조작 (background.js로 라우팅) ===
    function sendTabOp(op) {
        browser.runtime.sendMessage({ action: "vimium:tabs", op }).catch(() => {});
    }
    registerCommand("J",  () => sendTabOp("prev"));
    registerCommand("K",  () => sendTabOp("next"));
    registerCommand("t",  () => sendTabOp("new"));
    registerCommand("x",  () => sendTabOp("close"));
    registerCommand("X",  () => sendTabOp("restore"));
    registerCommand("gt", () => sendTabOp("next"));
    registerCommand("gT", () => sendTabOp("prev"));

    // === Phase 3: 링크 힌트 ===
    const HINT_ALPHABET = "sadfjklewcmpgh";
    const CLICKABLE_SELECTOR = [
        "a[href]",
        "button",
        "input:not([type=hidden]):not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[role=button]",
        "[role=link]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=tab]",
        "[role=menuitem]",
        "[onclick]",
        "[tabindex]:not([tabindex='-1'])",
        "summary"
    ].join(",");

    let hintAction = null;       // "click" | "newTab" | "copy"
    let hintEntries = [];        // [{ el, label, hintEl }]
    let typedPrefix = "";
    let hintContainer = null;

    function isHintCandidateVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        if (r.bottom < 0 || r.right < 0) return false;
        if (r.top > window.innerHeight || r.left > window.innerWidth) return false;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        return true;
    }

    function collectClickable(root) {
        const results = [];
        if (!root || !root.querySelectorAll) return results;
        try {
            root.querySelectorAll(CLICKABLE_SELECTOR).forEach(el => {
                if (isHintCandidateVisible(el)) results.push(el);
            });
        } catch {}
        // Shadow DOM 재귀
        try {
            root.querySelectorAll("*").forEach(el => {
                if (el.shadowRoot) {
                    results.push(...collectClickable(el.shadowRoot));
                }
            });
        } catch {}
        return results;
    }

    // 라벨 생성: count <= A 면 1글자, 아니면 1글자 + 2글자 혼합 (1글자가 2글자의 prefix가 되지 않도록)
    function generateLabels(count) {
        const A = HINT_ALPHABET.length;
        if (count === 0) return [];
        if (count <= A) return HINT_ALPHABET.slice(0, count).split("");

        // X (1글자) + Y * A (2글자) >= count, X + Y = A
        // → Y >= (count - A) / (A - 1)
        const Y = Math.min(A, Math.ceil((count - A) / (A - 1)));
        const X = A - Y;
        const labels = [];
        for (let i = 0; i < X; i++) labels.push(HINT_ALPHABET[i]);
        for (let i = 0; i < Y && labels.length < count; i++) {
            const prefix = HINT_ALPHABET[X + i];
            for (let j = 0; j < A && labels.length < count; j++) {
                labels.push(prefix + HINT_ALPHABET[j]);
            }
        }
        return labels.slice(0, count);
    }

    function renderHints(elements, labels) {
        if (hintContainer) hintContainer.remove();
        hintContainer = document.createElement("div");
        hintContainer.id = "wt-vimium-hints";
        hintContainer.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none";
        document.documentElement.appendChild(hintContainer);

        const entries = [];
        elements.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            const label = labels[i];
            const hintEl = document.createElement("div");
            hintEl.style.cssText = [
                "position:fixed",
                `top:${Math.max(0, r.top)}px`,
                `left:${Math.max(0, r.left)}px`,
                "background:#ffd76e",
                "color:#302505",
                "font:bold 11px/1.2 'SF Mono',Menlo,monospace",
                "padding:1px 4px",
                "border:1px solid #c89800",
                "border-radius:3px",
                "box-shadow:0 1px 3px rgba(0,0,0,0.3)",
                "z-index:2147483647",
                "pointer-events:none",
                "white-space:nowrap"
            ].join(";");
            hintEl.textContent = label.toUpperCase();
            hintContainer.appendChild(hintEl);
            entries.push({ el, label, hintEl });
        });
        return entries;
    }

    function enterHintMode(action) {
        const elements = collectClickable(document);
        if (elements.length === 0) return;
        const labels = generateLabels(elements.length);
        hintEntries = renderHints(elements, labels);
        hintAction = action;
        typedPrefix = "";
        setMode(Mode.HINT);
    }

    function exitHintMode() {
        if (hintContainer) {
            hintContainer.remove();
            hintContainer = null;
        }
        hintEntries = [];
        typedPrefix = "";
        hintAction = null;
        setMode(Mode.NORMAL);
    }

    function executeHintAction(entry) {
        const el = entry.el;
        if (hintAction === "click") {
            el.click();
        } else if (hintAction === "newTab") {
            const href = el.href;
            if (href) {
                browser.runtime.sendMessage({ action: "vimium:openTab", url: href }).catch(() => {});
            } else {
                el.click();
            }
        } else if (hintAction === "copy") {
            const href = el.href;
            if (href) {
                navigator.clipboard.writeText(href).catch(() => {});
            }
        }
    }

    function updateHintDisplay() {
        const matching = hintEntries.filter(h => h.label.startsWith(typedPrefix));
        if (matching.length === 0) {
            exitHintMode();
            return;
        }
        if (matching.length === 1 && matching[0].label === typedPrefix) {
            executeHintAction(matching[0]);
            exitHintMode();
            return;
        }
        // 매칭/비매칭 표시 갱신
        hintEntries.forEach(h => {
            if (h.label.startsWith(typedPrefix)) {
                h.hintEl.style.display = "";
                const matched = typedPrefix.toUpperCase();
                const rest = h.label.slice(typedPrefix.length).toUpperCase();
                h.hintEl.innerHTML = `<span style="opacity:0.4">${matched}</span>${rest}`;
            } else {
                h.hintEl.style.display = "none";
            }
        });
    }

    function onHintKey(e) {
        const key = normalizeKey(e);

        if (key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            exitHintMode();
            return;
        }

        if (key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            if (typedPrefix.length > 0) {
                typedPrefix = typedPrefix.slice(0, -1);
                hintEntries.forEach(h => {
                    h.hintEl.style.display = "";
                    h.hintEl.textContent = h.label.toUpperCase();
                });
                if (typedPrefix) updateHintDisplay();
                updateHUD();
            }
            return;
        }

        const lowerKey = key.toLowerCase();
        if (key.length !== 1 || !HINT_ALPHABET.includes(lowerKey)) {
            // 알파벳 외 키 → 가로채고 무시
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        typedPrefix += lowerKey;
        updateHUD();
        updateHintDisplay();
    }

    // 명령 등록: f (현재 탭) / F (새 탭) / yf (URL 복사)
    registerCommand("f",  () => enterHintMode("click"));
    registerCommand("F",  () => enterHintMode("newTab"));
    registerCommand("yf", () => enterHintMode("copy"));

    // === 키 시퀀스 매칭 ===
    function hasPartialMatch(seq) {
        return Object.keys(commands).some(k => k.startsWith(seq) && k !== seq);
    }

    function tryExecute() {
        const key = keyBuffer;
        const count = parseInt(countBuffer, 10) || 1;

        if (commands[key]) {
            commands[key](count);
            resetKeyState();
            return true;
        }

        // 부분 매칭이 있으면 대기
        if (hasPartialMatch(key)) {
            clearTimeout(keyTimer);
            keyTimer = setTimeout(resetKeyState, KEY_TIMEOUT);
            updateHUD();
            return true;
        }

        // 매칭 없음
        resetKeyState();
        return false;
    }

    // === 메인 키 핸들러 ===
    // 정책: 매핑된 키(전체/부분 매치)만 가로채고, 나머지는 페이지로 통과시킴.
    // 시퀀스가 깨지면 이전 버퍼 버리고 새 키 단독으로 재시도 (예: gj → j 실행).
    function onKeyDown(e) {
        if (!enabled) return;

        const key = normalizeKey(e);

        // INSERT 모드: Esc만 처리
        if (currentMode === Mode.INSERT) {
            if (key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (document.activeElement && isEditableElement(document.activeElement)) {
                    document.activeElement.blur();
                }
                setMode(Mode.NORMAL);
                resetKeyState();
            }
            return;
        }

        // HINT 모드: 라벨 매칭 핸들러로 위임
        if (currentMode === Mode.HINT) {
            onHintKey(e);
            return;
        }

        // NORMAL 모드

        // 수정 키 무시 (Shift 제외)
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Esc: 버퍼가 있을 때만 가로채서 리셋
        if (key === "Escape") {
            if (countBuffer || keyBuffer) {
                e.preventDefault();
                e.stopPropagation();
                resetKeyState();
            }
            return;
        }

        // 숫자 prefix
        if (/^[0-9]$/.test(key) && keyBuffer === "") {
            if (key === "0" && countBuffer === "") {
                // 0은 countBuffer가 비어 있을 땐 명령으로 처리 (등록되어 있을 경우)
                if (!commands["0"]) return;
                // commands["0"] 등록되어 있음 → 아래 명령 매칭으로 fall through
            } else {
                countBuffer += key;
                updateHUD();
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }

        // 명령 매칭
        const newBuffer = keyBuffer + key;

        if (commands[newBuffer] || hasPartialMatch(newBuffer)) {
            // 매핑된 키 → 가로챔
            keyBuffer = newBuffer;
            e.preventDefault();
            e.stopPropagation();
            tryExecute();
        } else if (keyBuffer && (commands[key] || hasPartialMatch(key))) {
            // 시퀀스 깨짐, 새 키 단독은 명령 → 이전 버퍼 버리고 재시도
            keyBuffer = key;
            e.preventDefault();
            e.stopPropagation();
            tryExecute();
        } else {
            // 매핑되지 않은 키 → 페이지로 통과
            if (keyBuffer || countBuffer) {
                resetKeyState();
            }
        }
    }

    // === 포커스 이벤트로 모드 자동 전환 ===
    function onFocusIn(e) {
        if (!enabled) return;
        if (isEditableElement(e.target)) {
            setMode(Mode.INSERT);
        }
    }

    function onFocusOut(e) {
        if (!enabled) return;
        if (isEditableElement(e.target)) {
            setMode(Mode.NORMAL);
            resetKeyState();
        }
    }

    // === 활성화/비활성화 ===
    function activate() {
        enabled = true;
        createHUD();
        // 현재 포커스된 요소가 편집 가능하면 INSERT
        if (isEditableElement(document.activeElement)) {
            setMode(Mode.INSERT);
        } else {
            setMode(Mode.NORMAL);
        }
    }

    function deactivate() {
        if (currentMode === Mode.HINT) exitHintMode();
        enabled = false;
        resetKeyState();
        setMode(Mode.NORMAL);
        if (hudEl) hudEl.style.opacity = "0";
    }

    // === 이벤트 등록 (항상 리스닝, enabled 체크는 핸들러 내부에서) ===
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);

    // === 설정 적용 헬퍼 ===
    function applyScrollStep(v)     { if (typeof v === "number" && v > 0) SCROLL_STEP = v; }
    function applyScrollBehavior(v) { if (v === "smooth" || v === "auto") SCROLL_BEHAVIOR = v; }
    function applyKeyTimeout(v)     { if (typeof v === "number" && v >= 100) KEY_TIMEOUT = v; }

    // === storage에서 설정 로드 ===
    browser.storage.local.get([
        "vimiumEnabled",
        "vimiumScrollStep",
        "vimiumScrollBehavior",
        "vimiumKeyTimeout"
    ]).then(result => {
        applyScrollStep(result.vimiumScrollStep);
        applyScrollBehavior(result.vimiumScrollBehavior);
        applyKeyTimeout(result.vimiumKeyTimeout);
        if (result.vimiumEnabled) activate();
    }).catch(() => {});

    // === storage 변경 수신 (background.js relay) ===
    browser.runtime.onMessage.addListener((request) => {
        if (request.action !== "storageChanged" || !request.changes) return;
        const c = request.changes;
        if (c.vimiumEnabled) {
            if (c.vimiumEnabled.newValue) activate();
            else deactivate();
        }
        if (c.vimiumScrollStep)     applyScrollStep(c.vimiumScrollStep.newValue);
        if (c.vimiumScrollBehavior) applyScrollBehavior(c.vimiumScrollBehavior.newValue);
        if (c.vimiumKeyTimeout)     applyKeyTimeout(c.vimiumKeyTimeout.newValue);
    });

    // === 외부 API (Phase 2+에서 사용) ===
    window.__wtVimium = { registerCommand, Mode, resetKeyState };

})();
