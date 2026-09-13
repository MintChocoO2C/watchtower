// Watchtower — 상황실 (격리 세계, document_start)
// 역할: 치지직의 빈 경로(/wt-room)에서 페이지를 통째로 우리 UI로 바꾸고,
//       팔로우한 채널들의 라이브를 같은 출처 iframe(/live/<id>) 격자로 한 화면에 띄운다.
//
// 왜 치지직 도메인 안인가: 확장 내부 페이지에서 iframe으로 띄우면 Safari의
// 추적 방지(ITP)가 쿠키를 막아 로그인이 끊긴다. 같은 출처면 쿠키가 유지되고
// 부모에서 iframe 문서(플레이어)를 직접 제어할 수 있다. (2026-09-13 STP로 검증)
//
// 제약: 자동 재생은 음소거에서만 된다. 소리는 사용자 클릭(우리 버튼 또는 플레이어 자체 버튼)으로 켠다.
//       소리는 여러 채널에서 동시에 켜질 수 있다. 상태의 원천은 각 iframe 의 video.muted 이고,
//       우리는 volumechange 로 그것을 따라간다(플레이어에서 직접 음소거를 풀어도 반영).

(() => {
    "use strict";
    if (location.pathname !== "/wt-room") return;

    // 치지직 SPA 로딩을 여기서 끊는다 — 부모 문서에서는 치지직 JS가 돌 필요가 없다.
    window.stop();

    const WT = window.WT;
    const t = (key) => browser.i18n.getMessage(key) || key;
    const MAX_CHANNELS = 16;
    const STATUS_INTERVAL_MS = 60_000;
    const API = "https://api.chzzk.naver.com/service";

    // iframe 안(라이브 페이지)에서 플레이어만 남기는 CSS.
    // 훅: #live_player_layout (플레이어 컨테이너). 조상의 transform/position을 풀어야
    // fixed 배치가 iframe 뷰포트 기준이 된다.
    const PLAYER_ONLY_CSS = `
        #live_player_layout{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483000!important;background:#000}
        body>#root>*>*:not(:has(#live_player_layout)){visibility:hidden!important}
        html,body{overflow:hidden!important;background:#000!important}
        #root,#root *:has(#live_player_layout){transform:none!important;filter:none!important;contain:none!important;position:static!important;margin:0!important;padding:0!important}
    `;

    // 설정 서랍에 놓을 기존 토글들 (예전 팝업의 토글이 여기로 옮겨왔다)
    const SETTINGS = [
        { section: "sectionVideo", items: [
            { key: "autoPiPEnabled", label: "autoPipLabel", desc: "autoPipDesc" },
            { key: "pressFastForwardEnabled", label: "pressFastForwardLabel", desc: "pressFastForwardDesc" },
        ]},
        { section: "sectionChzzk", items: [
            { key: "chzzkAdSkipEnabled", label: "adSkipLabel", desc: "adSkipDesc", def: true },
        ]},
        { section: "sectionYouTube", items: [
            { key: "ytLogoMiniplayerEnabled", label: "ytMiniplayerLabel", desc: "ytMiniplayerDesc" },
            { key: "ytHideShortsEnabled", label: "hideShortsLabel", desc: "hideShortsDesc" },
        ]},
        { section: "sectionDeveloper", items: [
            { key: "debugEnabled", label: "debugLabel", desc: "debugDesc" },
        ]},
    ];

    // --- 상태 ---
    const state = {
        channels: [],   // [{ id, name, image }]  — 배열 순서가 곧 격자 순서
        sounds: new Set(), // 소리가 켜진 channelId 들 (여러 개 가능)
        status: {},     // channelId -> { open, title, viewers }
        errors: {},     // channelId -> { count, last }  재생 실패 자동 재시도 기록
        focus: null,    // 집중 보기 중인 channelId (그 타일만 크게, 나머지는 음소거)
        chatSide: "right", // 집중 보기 채팅 서랍 위치: "left" | "right"
        soundBackup: null, // 집중 보기 들어가기 전 소리 상태 (나올 때 복원)
        cols: "auto",   // "auto" | 1..4
        fit: false,     // true면 스크롤 없이 모든 타일이 한 화면에 들어오도록 크기를 줄인다
        leveler: { enabled: false, target: -24 }, // 소리 평준화(PoC): 켬/끔, 기준 음량(dBFS)
        levelProfiles: {}, // channelId -> { db, n, at }  채널별 평균 음량(저장). 다시 열 때 준비 과정 없이 바로 맞춘다
    };
    const tiles = new Map();  // channelId -> { root, iframe, styled }
    const COL_CHOICES = ["auto", 1, 2, 3, 4];
    const PLAYBACK_CHECK_MS = 5_000;   // 재생 실패 감시 주기
    const RETRY_DELAY_MS = 4_000;      // 실패 감지 후 자동 재시도까지 대기
    const RETRY_MAX = 3;               // 이 횟수를 넘으면 자동 재시도를 멈추고 수동 버튼만 남긴다
    const RETRY_WINDOW_MS = 10 * 60_000;

    const el = (tag, attrs = {}, children = []) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "class") n.className = v;
            else if (k === "text") n.textContent = v;
            else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
            else if (v != null) n.setAttribute(k, v);
        }
        for (const c of children) if (c) n.appendChild(c);
        return n;
    };

    // --- 문서 골격 ---
    function buildDocument() {
        // 주의: <html>.innerHTML = "" 은 HTML 프래그먼트 파서가 **빈 <head>/<body> 를 자동으로 만들어 둔다.**
        // 여기에 head/body 를 새로 만들어 붙이면 head·body 가 두 개씩 생기고, document.body 는
        // 앞쪽의 빈 body 를 가리킨다(그 body 에 스타일이 붙으면 진짜 내용이 화면 밖으로 밀려 검은 화면이 된다).
        // 그래서 파서가 만들어 준 head/body 를 그대로 채우고, 혹시 없으면 그때만 만든다.
        document.documentElement.innerHTML = "";
        document.documentElement.lang = navigator.language.startsWith("ko") ? "ko" : "en";
        let head = document.head;
        if (!head) { head = el("head"); document.documentElement.prepend(head); }
        head.replaceChildren(
            el("meta", { charset: "utf-8" }),
            el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
            el("title", { text: t("roomTitle") + " · Watchtower" }),
        );
        let body = document.body;
        if (!body) { body = el("body"); document.documentElement.appendChild(body); }
        body.replaceChildren();
        body.className = "wt-room";

        const bar = el("header", { class: "wt-bar", onpointerenter: keepChatDock }, [
            el("span", { class: "wt-title", text: t("roomTitle") }),
            // 집중 보기 배지: 방송이 하나뿐인 격자와 집중 보기가 똑같이 보이지 않게 상단 바에서 모드를 분명히 한다
            el("span", { class: "wt-mode", id: "wt-mode", hidden: "" }, [focusIcon(), el("span", { text: t("roomFocusMode") })]),
            el("span", { class: "wt-count", id: "wt-count" }),
            el("button", { class: "wt-btn wt-unfocus", type: "button", onclick: exitFocus, text: "← " + t("roomBackToGrid") }),
            el("span", { class: "wt-sp" }),
            buildLayoutControls(),
            el("button", { class: "wt-btn wt-primary", type: "button", onclick: openFollowPanel, text: "＋ " + t("roomAddFollow") }),
            el("button", { class: "wt-btn", type: "button", onclick: addByUrl, text: t("roomAddUrl") }),
            el("button", { class: "wt-btn wt-icon", type: "button", title: t("roomSettings"), "aria-label": t("roomSettings"), onclick: toggleSettings }, [gearIcon()]),
        ]);
        const scroll = el("main", { class: "wt-scroll" }, [
            el("div", { class: "wt-grid", id: "wt-grid" }),
            el("p", { class: "wt-empty", id: "wt-empty", text: t("roomEmpty") }),
        ]);
        // 종료된 방송 선반: 격자에서 빼서 여기 모아 두고, 다시 켜지면 격자로 돌아간다
        const shelf = el("footer", { class: "wt-shelf", id: "wt-shelf", hidden: "", onpointerenter: keepChatDock }, [
            el("span", { class: "wt-shelf-label", text: t("roomOfflineShelf") }),
            el("div", { class: "wt-shelf-list", id: "wt-shelf-list" }),
        ]);
        // 패널/서랍 바깥을 누르면 닫히게 하는 투명 배경
        const backdrop = el("div", { class: "wt-backdrop", id: "wt-backdrop", hidden: "", onclick: closeOverlays });
        // 채팅 서랍(집중 보기 전용): 치지직 팝업 채팅(/live/<id>/chat)을 담고, 가장자리에 숨어 있다가
        // 마우스를 가져가면 안쪽으로 나온다. 위치(좌/우)는 설정에서 바꾼다.
        const chat = el("div", { class: "wt-chatdock", id: "wt-chatdock", hidden: "", onpointerenter: openChatDock, onpointerleave: scheduleCloseChatDock }, [
            el("div", { class: "wt-chatdock-tab", title: t("roomChatTab") }, [chatIcon()]),
            el("iframe", { id: "wt-chat-frame", title: t("roomChatTab"), src: "about:blank" }),
        ]);
        const drawer = buildSettingsDrawer();
        const panel = el("div", { class: "wt-panel", id: "wt-follow", hidden: "" });
        // 집중 보기 진입/이동 안내 토스트: 채널명과 단축키를 잠깐 보여 주고 사라진다 (영상을 상시 가리지 않는다)
        const focusToast = el("div", { class: "wt-focus-toast", id: "wt-focus-toast", "aria-live": "polite" }, [
            el("span", { class: "wt-focus-toast-name", id: "wt-focus-toast-name" }),
            el("span", { class: "wt-focus-toast-hint", text: t("roomFocusToastHint") }),
        ]);
        body.append(bar, el("div", { class: "wt-body" }, [scroll, chat, focusToast]), shelf, backdrop, drawer, panel);
    }

    // 열 수(자동/1~4) + 화면에 맞춤 토글
    function buildLayoutControls() {
        const seg = el("div", { class: "wt-seg", role: "group", "aria-label": t("roomLayout") });
        for (const c of COL_CHOICES) {
            seg.appendChild(el("button", { class: "wt-seg-btn", type: "button", "data-cols": String(c),
                text: c === "auto" ? t("roomColsAuto") : String(c),
                onclick: () => { state.cols = c; saveState(); render(); } }));
        }
        const fit = el("button", { class: "wt-btn wt-fit", type: "button", id: "wt-fit", "aria-pressed": "false",
            text: t("roomFit"), onclick: () => { state.fit = !state.fit; saveState(); render(); } });
        return el("div", { class: "wt-layout" }, [seg, fit]);
    }


    function chatIcon() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "13"); svg.setAttribute("height", "13");
        svg.innerHTML = '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>';
        return svg;
    }
    // 채팅 서랍 규칙: 서랍(손잡이·채팅)에 마우스가 들어오면 열리고, 서랍 밖으로 나가면 닫힌다.
    // 예외: 상단 바·선반으로 나간 경우는 열린 채 둔다(짧은 유예 안에 그쪽 pointerenter 가 오면 취소).
    // 서랍 이탈은 부모 문서의 pointerleave 로 잡으므로 채팅 iframe → 영상 iframe 으로 바로 넘어가도 닫힌다.
    // 채팅 입력 중이면 CSS :focus-within 이 열어 둔다.
    let chatCloseTimer = null;
    function openChatDock() { clearTimeout(chatCloseTimer); document.getElementById("wt-chatdock")?.classList.add("open"); }
    function closeChatDock() { clearTimeout(chatCloseTimer); document.getElementById("wt-chatdock")?.classList.remove("open"); }
    function scheduleCloseChatDock() { clearTimeout(chatCloseTimer); chatCloseTimer = setTimeout(closeChatDock, 120); }
    function keepChatDock() { clearTimeout(chatCloseTimer); }
    function focusIcon() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "13"); svg.setAttribute("height", "13");
        svg.innerHTML = '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        return svg;
    }
    function gearIcon() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "15"); svg.setAttribute("height", "15");
        svg.innerHTML = '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.4" fill="none"/>';
        return svg;
    }

    // --- 설정 서랍 ---
    function buildSettingsDrawer() {
        const drawer = el("aside", { class: "wt-drawer", id: "wt-drawer", "aria-label": t("roomSettings") }, [
            el("h2", {}, [
                el("span", { text: t("roomSettings") }),
                el("button", { class: "wt-btn", type: "button", onclick: toggleSettings, text: t("roomClose") }),
            ]),
        ]);
        // 상황실 전용 설정: 채팅 서랍 위치
        drawer.appendChild(el("div", { class: "wt-set-head", text: t("roomTitle") }));
        const sideSeg = el("div", { class: "wt-seg", id: "wt-chat-side", role: "group", "aria-label": t("roomChatSide") });
        for (const side of ["left", "right"]) {
            sideSeg.appendChild(el("button", { class: "wt-seg-btn", type: "button", "data-side": side,
                text: t(side === "left" ? "roomChatLeft" : "roomChatRight"),
                onclick: () => { state.chatSide = side; browser.storage.local.set({ roomChatSide: side }).catch(() => {}); render(); } }));
        }
        drawer.appendChild(el("div", { class: "wt-set-row" }, [
            el("span", { class: "wt-set-text" }, [
                el("span", { class: "wt-set-label", text: t("roomChatSide") }),
                el("span", { class: "wt-set-desc", id: "wt-chat-side-desc", text: t("roomChatSideDesc") }),
            ]),
            sideSeg,
        ]));
        // 소리 평준화(PoC): 켬/끔 토글과 기준 음량 슬라이더. 값은 storage 에 두고 WT.watch 로 되돌아와 state 에 반영된다.
        const lvInput = el("input", { type: "checkbox", id: "wt-lv-on" });
        lvInput.addEventListener("change", () => {
            state.leveler.enabled = lvInput.checked;
            applyLevelerSetting();
            browser.storage.local.set({ roomLevelerEnabled: lvInput.checked }).catch(() => {});
        });
        drawer.appendChild(el("label", { class: "wt-set-row" }, [
            el("span", { class: "wt-set-text" }, [
                el("span", { class: "wt-set-label", text: t("roomLevelerLabel") }),
                el("span", { class: "wt-set-desc", text: t("roomLevelerDesc") }),
            ]),
            el("span", { class: "wt-toggle" }, [lvInput, el("span", { class: "wt-slider" })]),
        ]));
        const range = el("input", { type: "range", id: "wt-lv-target", min: String(LEVEL_TARGET_MIN), max: String(LEVEL_TARGET_MAX), step: "1" });
        range.addEventListener("input", () => { state.leveler.target = Number(range.value); renderLevelerSettings(); levelApplyAll(); });   // 끌면서 바로 반영
        range.addEventListener("change", () => browser.storage.local.set({ roomLevelerTarget: Number(range.value) }).catch(() => {}));
        drawer.appendChild(el("div", { class: "wt-set-row wt-set-stack" }, [
            el("span", { class: "wt-set-text" }, [
                el("span", { class: "wt-set-label", text: t("roomLevelerTarget") }),
                el("span", { class: "wt-set-desc", id: "wt-lv-target-desc", text: t("roomLevelerTargetDesc") }),
            ]),
            range,
        ]));
        for (const group of SETTINGS) {
            drawer.appendChild(el("div", { class: "wt-set-head", text: t(group.section) }));
            for (const item of group.items) {
                const input = el("input", { type: "checkbox", "data-key": item.key });
                input.addEventListener("change", () => browser.storage.local.set({ [item.key]: input.checked }));
                drawer.appendChild(el("label", { class: "wt-set-row" }, [
                    el("span", { class: "wt-set-text" }, [
                        el("span", { class: "wt-set-label", text: t(item.label) }),
                        el("span", { class: "wt-set-desc", text: t(item.desc) }),
                    ]),
                    el("span", { class: "wt-toggle" }, [input, el("span", { class: "wt-slider" })]),
                ]));
            }
        }
        return drawer;
    }

    function toggleSettings() {
        const drawer = document.getElementById("wt-drawer");
        const open = !drawer.classList.contains("open");
        closeOverlays();
        if (open) { drawer.classList.add("open"); document.getElementById("wt-backdrop").hidden = false; }
    }
    function closeOverlays() {
        document.getElementById("wt-drawer").classList.remove("open");
        document.getElementById("wt-follow").hidden = true;
        document.getElementById("wt-backdrop").hidden = true;
    }

    async function loadSettings() {
        const items = SETTINGS.flatMap(g => g.items);
        const keys = items.map(i => i.key);
        const def = Object.fromEntries(items.map(i => [i.key, i.def === true]));   // 저장된 값이 없을 때의 기본값
        const r = await WT.load(keys);
        for (const key of keys) {
            const input = document.querySelector(`input[data-key="${key}"]`);
            if (input) input.checked = r[key] ?? def[key];
        }
        WT.watch(keys, (c) => {
            for (const key of Object.keys(c)) {
                const input = document.querySelector(`input[data-key="${key}"]`);
                if (input) input.checked = c[key].newValue ?? def[key];
            }
        });
    }

    // --- 채널 목록 저장/복원 ---
    async function loadState() {
        const r = await WT.load(["roomChannels", "roomSound", "roomLayout", "roomChatSide", "roomLevelerEnabled", "roomLevelerTarget", "roomLevelerProfiles"]);
        // 프로파일은 측정 방식 버전(v)이 같은 것만 쓴다 (v2: K-가중 라우드니스. 그 전 RMS 값은 버린다)
        state.levelProfiles = Object.fromEntries(Object.entries(r.roomLevelerProfiles && typeof r.roomLevelerProfiles === "object" ? r.roomLevelerProfiles : {})
            .filter(([, v]) => v && v.v === LEVEL_PROFILE_VERSION));
        state.chatSide = r.roomChatSide === "left" ? "left" : "right";
        state.leveler.enabled = r.roomLevelerEnabled === true;
        state.leveler.target = clampTarget(r.roomLevelerTarget);
        // 다른 탭/창에서 바뀐 경우용. 자기 탭의 조작은 서랍에서 바로 적용한다(relay 가 자기 탭으로 돌아오지 않을 수 있다).
        WT.watch(["roomLevelerEnabled", "roomLevelerTarget"], (c) => {
            if ("roomLevelerEnabled" in c) state.leveler.enabled = c.roomLevelerEnabled.newValue === true;
            if ("roomLevelerTarget" in c) state.leveler.target = clampTarget(c.roomLevelerTarget.newValue);
            renderLevelerSettings();
            applyLevelerSetting();
        });
        state.channels = Array.isArray(r.roomChannels) ? r.roomChannels.slice(0, MAX_CHANNELS) : [];
        // roomSound: 예전(단일 id 문자열)과 현재(배열) 둘 다 받아들인다
        const snd = r.roomSound;
        state.sounds = new Set(Array.isArray(snd) ? snd : (typeof snd === "string" && snd ? [snd] : []));
        const lay = r.roomLayout || {};
        state.cols = COL_CHOICES.includes(lay.cols) ? lay.cols : "auto";
        state.fit = lay.fit === true;
    }
    function saveState() {
        browser.storage.local.set({
            roomChannels: state.channels, roomSound: [...(state.focus !== null && state.soundBackup ? state.soundBackup : state.sounds)],
            roomLayout: { cols: state.cols, fit: state.fit },
        }).catch(() => {});
    }

    // --- 격자 렌더 ---
    function autoColumns(n) { return Math.min(4, Math.ceil(Math.sqrt(Math.max(1, n)))); }
    function gridColumns(n) { return state.cols === "auto" ? autoColumns(n) : Math.min(state.cols, Math.max(1, n)); }
    // 상태를 아직 모르면(첫 조회 전) 켜진 것으로 본다
    const isOffline = (id) => state.status[id]?.open === false;
    const onlineChannels = () => state.channels.filter(c => !isOffline(c.id));

    // 타일은 한 번 만들면 DOM 위치를 옮기지 않는다 — iframe 을 DOM 에서 떼었다 붙이면 재로드되기 때문.
    // 순서는 CSS order 로만 표현한다. (추가/삭제/스왑 모두 기존 타일을 건드리지 않는다)
    function render() {
        const grid = document.getElementById("wt-grid");
        const online = onlineChannels();
        const n = online.length;
        const cols = gridColumns(n);
        const rows = Math.max(1, Math.ceil(n / cols));
        grid.style.setProperty("--cols", cols);
        grid.style.setProperty("--rows", rows);
        document.body.classList.add("wt-room");   // 외부 스크립트가 body class 를 덮어써도 우리 스타일이 유지되게
        document.body.classList.toggle("fit", state.fit);
        document.getElementById("wt-empty").hidden = state.channels.length > 0;
        const focused = state.focus !== null ? state.channels.find(c => c.id === state.focus) : null;
        document.getElementById("wt-count").textContent = focused
            ? `${focused.name || focused.id.slice(0, 8)} — ${t("roomFocusHint")}`
            : (state.channels.length ? `${n}/${state.channels.length} · ${cols}${t("roomCols")}` : "");
        document.body.classList.toggle("focus-mode", state.focus !== null);
        document.getElementById("wt-mode").hidden = !focused;
        const dock = document.getElementById("wt-chatdock");
        dock.dataset.side = state.chatSide;
        for (const b of document.querySelectorAll("#wt-chat-side .wt-seg-btn")) b.setAttribute("aria-pressed", String(b.dataset.side === state.chatSide));
        const sideDesc = document.getElementById("wt-chat-side-desc");
        if (sideDesc) sideDesc.textContent = `${t("roomChatSideDesc")} · ${t("roomCurrent")}: ${t(state.chatSide === "left" ? "roomChatLeft" : "roomChatRight")}`;
        const frame = document.getElementById("wt-chat-frame");
        const chatUrl = focused ? `${location.origin}/live/${focused.id}/chat` : "about:blank";
        if (frame.src !== chatUrl) frame.src = chatUrl;   // 채널이 바뀔 때만 다시 불러온다
        dock.hidden = !focused;
        if (!focused) closeChatDock();
        // 열 수 세그먼트만 (채팅 위치 세그먼트도 같은 .wt-seg-btn 을 쓰므로 범위를 한정한다)
        for (const b of document.querySelectorAll(".wt-layout .wt-seg-btn")) {
            b.setAttribute("aria-pressed", String(b.dataset.cols === String(state.cols)));
        }
        document.getElementById("wt-fit").setAttribute("aria-pressed", String(state.fit));
        renderLevelerSettings();

        if (state.focus !== null && !online.some(c => c.id === state.focus)) exitFocus();   // 집중 중인 방송이 끝나면 격자로
        // 없어졌거나 종료된 채널의 타일은 내린다 (종료된 방송의 iframe 은 붙들고 있지 않는다)
        for (const [id, tile] of tiles) {
            if (!online.some(c => c.id === id)) { detachLeveler(tile); tile.root.remove(); tiles.delete(id); }
        }
        // 켜진 채널만 격자에. 순서는 state.channels 의 순서를 따르되 CSS order 로만 표현
        state.channels.forEach((ch, i) => {
            if (isOffline(ch.id)) return;
            let tile = tiles.get(ch.id);
            if (!tile) { tile = createTile(ch); tiles.set(ch.id, tile); grid.appendChild(tile.root); }
            tile.root.style.order = i;
            updateTile(ch.id);
        });
        renderShelf();
        fitTiles();
    }

    // 종료된 방송 선반
    function renderShelf() {
        const shelf = document.getElementById("wt-shelf");
        const list = document.getElementById("wt-shelf-list");
        const offline = state.channels.filter(c => isOffline(c.id));
        shelf.hidden = offline.length === 0;
        list.replaceChildren(...offline.map(ch => el("span", { class: "wt-chip", title: ch.name || ch.id }, [
            ch.image ? el("img", { src: ch.image, alt: "" }) : el("span", { class: "wt-chip-dot" }),
            el("span", { class: "wt-chip-name", text: ch.name || ch.id.slice(0, 8) }),
            el("button", { class: "wt-chip-x", type: "button", title: t("roomRemove"), "aria-label": t("roomRemove"), text: "×",
                onclick: () => removeChannel(ch.id) }),
        ])));
    }

    // 화면에 맞춤: 모든 줄이 스크롤 없이 들어오도록 타일 폭을 계산한다 (16:9 유지)
    function fitTiles() {
        const grid = document.getElementById("wt-grid");
        const n = onlineChannels().length;
        if (!state.fit || !n) { grid.style.removeProperty("--tile-w"); return; }
        const scroll = grid.parentElement;
        const gap = 6, pad = 8;
        const cols = gridColumns(n);
        const rows = Math.ceil(n / cols);
        const w = scroll.clientWidth - pad * 2, h = scroll.clientHeight - pad * 2;
        const byW = (w - gap * (cols - 1)) / cols;
        const byH = ((h - gap * (rows - 1)) / rows) * 16 / 9;
        grid.style.setProperty("--tile-w", Math.max(120, Math.floor(Math.min(byW, byH))) + "px");
    }

    // --- 스왑: 타일 상단 바를 잡아 다른 타일 위에 놓으면 자리를 바꾼다 ---
    let dragId = null;
    function onDragStart(id, e) {
        dragId = id;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", id); } catch {}
        document.body.classList.add("dragging");   // iframe 이 드래그 이벤트를 삼키지 않도록 pointer-events 차단
        tiles.get(id)?.root.classList.add("drag-src");
    }
    function onDragEnd() {
        document.body.classList.remove("dragging");
        for (const t of tiles.values()) t.root.classList.remove("drag-src", "drag-over");
        dragId = null;
    }
    function onDragOver(id, e) {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        tiles.get(id)?.root.classList.add("drag-over");
    }
    function onDragLeave(id) { tiles.get(id)?.root.classList.remove("drag-over"); }
    function onDrop(id, e) {
        e.preventDefault();
        if (!dragId || dragId === id) { onDragEnd(); return; }
        swapChannels(dragId, id);
        onDragEnd();
    }
    function swapChannels(a, b) {
        const i = state.channels.findIndex(c => c.id === a);
        const j = state.channels.findIndex(c => c.id === b);
        if (i < 0 || j < 0) return;
        [state.channels[i], state.channels[j]] = [state.channels[j], state.channels[i]];
        saveState(); render();
        WT.log("room", "스왑", a.slice(0, 6), "<->", b.slice(0, 6));
    }

    function createTile(ch) {
        const iframe = el("iframe", {
            src: `/live/${ch.id}`,
            allow: "autoplay; fullscreen",
            title: ch.name || ch.id,
        });
        const root = el("div", { class: "wt-tile", "data-id": ch.id,
            ondragover: (e) => onDragOver(ch.id, e), ondragleave: () => onDragLeave(ch.id), ondrop: (e) => onDrop(ch.id, e) }, [
            iframe,
            el("div", { class: "wt-tile-top", draggable: "true", title: t("roomDragHint"),
                ondragstart: (e) => onDragStart(ch.id, e), ondragend: onDragEnd,
                onpointerenter: () => { if (state.focus === ch.id) closeChatDock(); },
                onclick: (e) => { if (!e.target.closest("button")) toggleFocus(ch.id); } }, [
                el("span", { class: "wt-live", text: "LIVE" }),
                el("span", { class: "wt-name", text: ch.name || ch.id }),
                el("span", { class: "wt-viewers" }),
                el("span", { class: "wt-level", title: t("roomLevelerBadge") }),
                el("span", { class: "wt-sp" }),
                el("button", { class: "wt-btn wt-icon wt-focus-btn", type: "button", title: t("roomFocus"), "aria-label": t("roomFocus"),
                    onclick: (e) => { e.stopPropagation(); toggleFocus(ch.id); } }, [focusIcon()]),
                el("button", { class: "wt-btn wt-icon wt-remove", type: "button", title: t("roomRemove"), "aria-label": t("roomRemove"), text: "×",
                    onclick: (e) => { e.stopPropagation(); removeChannel(ch.id); } }),
            ]),
            el("div", { class: "wt-offline", text: t("roomOffline") }),
            el("div", { class: "wt-error" }, [
                el("span", { class: "wt-error-text", text: t("roomPlaybackFailed") }),
                el("span", { class: "wt-error-sub" }),
                el("button", { class: "wt-btn wt-retry", type: "button", text: t("roomRetry"), onclick: () => retryTile(ch.id, true) }),
            ]),
        ]);
        const tile = { root, iframe, styled: false };
        iframe.addEventListener("load", () => onTileLoad(ch.id));
        return tile;
    }

    // iframe 로드 → 플레이어만 남기는 CSS 주입 + 음소거 정책 적용
    function onTileLoad(id) {
        const tile = tiles.get(id);
        if (!tile) return;
        const doc = tile.iframe.contentDocument;
        if (!doc) { WT.log("room", "iframe 문서 접근 불가", id); return; }
        const style = doc.createElement("style");
        style.id = "wt-player-only";
        style.textContent = PLAYER_ONLY_CSS;
        (doc.head || doc.documentElement).appendChild(style);
        tile.styled = true;
        tile.root.classList.add("ready", "playing");
        tile.root.classList.remove("error");
        // 플레이어 자체 버튼으로 음소거를 풀거나 걸어도 우리 상태가 따라가도록 (capture: video 가 바뀌어도 잡힌다)
        doc.addEventListener("volumechange", (e) => {
            if (e.target?.tagName !== "VIDEO") return;
            syncSoundFromVideo(id, e.target);
        }, true);
        // 타일 더블클릭 → 집중 보기 토글. 플레이어의 더블클릭(브라우저 전체화면)은 여기서 끊는다.
        doc.addEventListener("dblclick", (e) => {
            if (!e.target?.closest?.("#live_player_layout")) return;
            e.preventDefault(); e.stopImmediatePropagation();
            toggleFocus(id);
        }, true);
        // 집중 보기에 들어가면 키보드 포커스가 이 iframe 안에 있으므로(contentWindow.focus(), 더블클릭) 단축키를 여기서도 받는다.
        // iframe 의 keydown 은 부모 문서로 올라가지 않는다.
        doc.addEventListener("keydown", (e) => { if (handleRoomKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
        doc.addEventListener("pointerover", () => { if (state.focus === id) closeChatDock(); }, { capture: true, passive: true });
        // 타일 안 광고 SKIP 버튼 자동 클릭 (content script 는 iframe 에서 돌지 않으므로 부모가 등록)
        WT.adSkip?.watch(doc);
        applySound(id);
        WT.log("room", "타일 준비", id);
    }

    // video.muted 가 곧 진실. 우리 상태와 다르면 맞추고 저장한다.
    function syncSoundFromVideo(id, v) {
        const tile = tiles.get(id);
        if (tile?.autoMuting) return;           // 우리가 되돌린 음소거는 사용자의 뜻이 아니다
        const on = !v.muted;
        if (on) tile?.root.classList.remove("sound-pending");
        if (state.sounds.has(id) === on) return;
        if (on) state.sounds.add(id); else state.sounds.delete(id);
        saveState();
        updateTile(id);
        WT.log("room", "플레이어에서 소리 변경", id.slice(0, 6), on);
    }

    function tileVideo(id) {
        const tile = tiles.get(id);
        try { return tile?.iframe.contentDocument?.querySelector("video") || null; } catch { return null; }
    }

    // 소리 토글 — 여러 채널이 동시에 켜질 수 있다. 클릭(사용자 제스처) 안에서 muted 를 풀어야 Safari 가 허용한다.
    // 저장된 소리 의도(state.sounds)를 video 에 적용한다.
    // - 소리를 켜려는 타일: 페이지에 사용자 제스처가 있었을 때만 실제로 푼다(없으면 Safari 가 재생을 멈춘다).
    //   제스처가 없으면 음소거 상태로 두고 의도는 유지 → 첫 클릭 때 다시 적용한다(pending 표시).
    //   풀었는데도 Safari 가 멈추면 음소거로 되돌리되 의도는 지우지 않는다.
    // - 음소거 타일: muted 만 걸고 play() 는 부르지 않는다(플레이어의 광고/준비 단계를 건드리면 멈춘다).
    function applySound(id) {
        const v = tileVideo(id);
        const tile = tiles.get(id);
        const want = state.sounds.has(id);
        if (v && tile) {
            if (!want) {
                if (!v.muted) { tile.autoMuting = true; v.muted = true; tile.autoMuting = false; }
                tile.root.classList.remove("sound-pending");
            } else if (navigator.userActivation?.hasBeenActive !== false) {
                v.muted = false;
                if (v.paused) v.play().catch(() => {});
                tile.root.classList.remove("sound-pending");
                setTimeout(() => {
                    if (v.paused && state.sounds.has(id)) {
                        WT.log("room", "제스처 없이 소리 켜기 거부됨 → 음소거 유지, 의도는 보존", id.slice(0, 6));
                        tile.autoMuting = true; v.muted = true; tile.autoMuting = false;
                        v.play().catch(() => {});
                        tile.root.classList.add("sound-pending");
                    }
                }, 800);
            } else {
                tile.root.classList.add("sound-pending");
            }
            if (want && state.leveler.enabled) levelApply(id);   // 간직한 평균이 있으면 켜는 순간 맞춘다
        }
        updateTile(id);
    }
    // --- 집중 보기: 타일 하나가 격자 영역을 채우고 소리는 그 채널만 ---
    function toggleFocus(id) { if (state.focus === id) exitFocus(); else enterFocus(id); }
    function enterFocus(id) {
        if (!tiles.has(id)) return;
        if (state.focus === null) state.soundBackup = new Set(state.sounds);   // 처음 들어갈 때만 백업
        state.focus = id;
        state.sounds = new Set([id]);
        document.body.classList.add("focus-mode");
        for (const ch of state.channels) applySound(ch.id);
        render();
        tiles.get(id)?.iframe.contentWindow?.focus();
        showFocusToast(state.channels.find(c => c.id === id));
        WT.log("room", "집중 보기", id.slice(0, 6));
    }
    // 집중 보기 안내 토스트: 진입하거나 ←/→·숫자 키로 옮길 때 채널명과 단축키를 2초쯤 보여 준다
    let focusToastTimer = null;
    function showFocusToast(ch) {
        const toast = document.getElementById("wt-focus-toast");
        if (!toast || !ch) return;
        document.getElementById("wt-focus-toast-name").textContent = ch.name || ch.id.slice(0, 8);
        clearTimeout(focusToastTimer);
        toast.classList.add("show");
        focusToastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
    }
    function exitFocus() {
        if (state.focus === null) return;
        state.focus = null;
        state.sounds = state.soundBackup ? new Set(state.soundBackup) : new Set();
        state.soundBackup = null;
        document.body.classList.remove("focus-mode");
        clearTimeout(focusToastTimer);
        document.getElementById("wt-focus-toast")?.classList.remove("show");
        saveState();
        for (const ch of state.channels) applySound(ch.id);
        render();
        WT.log("room", "격자로 복귀");
    }
    // 집중 보기 중 ←/→ 로 이웃 채널로, 숫자 키로 n번째 채널로
    function focusStep(delta) {
        const online = onlineChannels();
        if (!online.length) return;
        const i = online.findIndex(c => c.id === state.focus);
        const next = online[((i < 0 ? 0 : i) + delta + online.length) % online.length];
        if (next) enterFocus(next.id);
    }
    // 상황실 단축키. 부모 문서와 타일·채팅 iframe 문서 모두 이 함수를 부른다(키보드 포커스가 어디에 있든 같은 동작).
    // 처리했으면 true 를 돌려주고, 호출한 쪽이 기본 동작(플레이어 탐색 등)을 막는다.
    function handleRoomKey(e) {
        if (e.target?.closest?.("input, textarea, [contenteditable]")) return false;
        if (e.key === "Escape") {
            const had = state.focus !== null;
            closeOverlays();
            if (had) exitFocus();
            return had;
        }
        if (state.focus !== null && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
            focusStep(e.key === "ArrowRight" ? 1 : -1);
            return true;
        }
        if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const ch = onlineChannels()[Number(e.key) - 1];
            if (!ch) return false;
            toggleFocus(ch.id);
            return true;
        }
        return false;
    }

    // 첫 사용자 제스처가 생기면 보류된 소리 의도를 적용한다
    function applyPendingSounds() {
        for (const id of state.sounds) {
            if (tiles.get(id)?.root.classList.contains("sound-pending")) applySound(id);
        }
    }

    function updateTile(id) {
        const tile = tiles.get(id);
        if (!tile) return;
        const st = state.status[id];
        const on = state.sounds.has(id);
        tile.root.classList.toggle("sound", on);
        tile.root.classList.toggle("offline", st ? !st.open : false);
        tile.root.classList.toggle("focus", state.focus === id);
        tile.root.querySelector(".wt-viewers").textContent = st?.open && st.viewers != null ? st.viewers.toLocaleString() : "";
        tile.root.querySelector(".wt-name").title = st?.title || "";
    }

    // --- 채널 추가/제거 ---
    async function addChannel(ch) {
        if (!ch?.id) return;
        if (state.channels.some(c => c.id === ch.id)) return;
        if (state.channels.length >= MAX_CHANNELS) { alert(t("roomMax")); return; }
        state.channels.push({ id: ch.id, name: ch.name || "", image: ch.image || "" });
        saveState();
        // 켜짐/종료를 알고 나서 그린다 — 종료된 방송이 격자에 잠깐 떴다가 선반으로 밀려나지 않게
        if (typeof ch.open === "boolean") state.status[ch.id] = { open: ch.open, title: ch.title || "" };
        else await refreshStatus([ch.id], { render: false });
        render();
    }
    function removeChannel(id) {
        if (state.focus === id) exitFocus();
        state.channels = state.channels.filter(c => c.id !== id);
        state.sounds.delete(id); state.soundBackup?.delete(id);
        saveState(); render();
    }

    // URL 또는 채널 ID로 추가: chzzk.naver.com/live/<id>, chzzk.naver.com/<id>, 또는 32자리 hex
    async function addByUrl() {
        const input = prompt(t("roomAddUrlPrompt"));
        if (!input) return;
        const m = input.trim().match(/([0-9a-f]{32})/i);
        if (!m) { alert(t("roomBadUrl")); return; }
        const id = m[1].toLowerCase();
        let name = "";
        try {
            const r = await fetch(`${API}/v1/channels/${id}`, { credentials: "include" });
            const j = await r.json();
            name = j?.content?.channelName || "";
        } catch {}
        addChannel({ id, name });
    }

    // --- 팔로우 목록 패널 ---
    async function openFollowPanel() {
        const panel = document.getElementById("wt-follow");
        closeOverlays();
        panel.hidden = false;
        document.getElementById("wt-backdrop").hidden = false;
        panel.innerHTML = "";
        panel.appendChild(el("h2", {}, [
            el("span", { text: t("roomAddFollow") }),
            el("button", { class: "wt-btn", type: "button", onclick: closeOverlays, text: t("roomClose") }),
        ]));
        const list = el("div", { class: "wt-follow-list" });
        panel.appendChild(list);
        list.appendChild(el("p", { class: "wt-muted", text: "…" }));

        let items;
        try {
            items = await fetchFollowings();
        } catch (e) {
            WT.log("room", "팔로우 목록 실패", e?.message);
            list.replaceChildren(el("p", { class: "wt-muted", text: t("roomLoginNeeded") }));
            return;
        }
        if (!items.length) { list.replaceChildren(el("p", { class: "wt-muted", text: t("roomFollowEmpty") })); return; }
        list.replaceChildren();
        for (const it of items) {
            const added = state.channels.some(c => c.id === it.id);
            list.appendChild(el("button", { class: "wt-follow-item" + (added ? " added" : ""), type: "button", disabled: added ? "" : null,
                onclick: () => { addChannel(it); closeOverlays(); } }, [
                it.image ? el("img", { src: it.image, alt: "" }) : el("span", { class: "wt-avatar" }),
                el("span", { class: "wt-follow-text" }, [
                    el("span", { class: "wt-follow-name", text: it.name }),
                    el("span", { class: "wt-follow-title", text: it.open ? (it.title || "LIVE") : t("roomOffline") }),
                ]),
                el("span", { class: "wt-live" + (it.open ? "" : " off"), text: it.open ? "LIVE" : "OFF" }),
            ]));
        }
    }

    // 라이브 중인 팔로우 채널 우선, 그 다음 나머지 팔로우 채널.
    // 응답 형태는 치지직 내부 API라 바뀔 수 있어 channelId를 가진 객체를 넓게 찾는다.
    async function fetchFollowings() {
        const seen = new Map();
        const collect = (json, open) => {
            const walk = (node) => {
                if (!node || typeof node !== "object") return;
                if (Array.isArray(node)) { node.forEach(walk); return; }
                const ch = node.channel && typeof node.channel === "object" ? node.channel : node;
                if (typeof ch.channelId === "string" && ch.channelId.length === 32 && !seen.has(ch.channelId)) {
                    seen.set(ch.channelId, {
                        id: ch.channelId, name: ch.channelName || "", image: ch.channelImageUrl || "",
                        open: open ?? (node.liveInfo?.liveStatus === "OPEN" || node.streamer?.openLive === true),
                        title: node.liveInfo?.liveTitle || node.liveTitle || "",
                    });
                }
                for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
            };
            walk(json?.content);
        };
        const live = await fetch(`${API}/v1/channels/followings/live?page=0&size=50`, { credentials: "include" });
        if (live.status === 401 || live.status === 403) throw new Error("login");
        collect(await live.json(), true);
        try {
            const all = await fetch(`${API}/v1/channels/followings?page=0&size=100`, { credentials: "include" });
            if (all.ok) collect(await all.json(), undefined);
        } catch {}
        const arr = [...seen.values()];
        arr.sort((a, b) => (b.open - a.open) || a.name.localeCompare(b.name));
        return arr;
    }

    // --- 소리 평준화 ---
    // 채널마다 방송 원본 음량이 제각각이라, 사용자가 정한 기준(dBFS)에 맞춰 큰 방송을 낮춘다. 보정은 video.volume 으로만(최대 100%).
    //
    // 왜 이렇게 하나: Safari 는 <video> 의 소리를 Web Audio 로 넘겨주지 않는다 — 네이티브 HLS 도, hls.js(MSE) 로 바꿔도
    // 분석기에는 0 만 들어온다(2026-09-13 실기기 확인). 그래서 플레이어 소리는 건드리지 않고, 같은 HLS 의 가장 낮은 화질 변형
    // (144p, ~190kbps) 세그먼트를 따로 받아 OfflineAudioContext.decodeAudioData 로 풀고, BS.1770 방식(K-가중 + 게이트)으로
    // 라우드니스(LUFS 근사)를 잰다(세그먼트 ~1초, 54KB, 디코드 ~80ms). 단순 RMS 보다 사람이 느끼는 크기에 가깝다.
    // 평균 기반·저부하: 10초에 세그먼트 하나만 받아(처음 3개는 3초 간격) 최근 약 2분 표본의 파워 평균을 내고,
    // 평균이 1dB 이상 달라졌을 때만 1초 램프로 볼륨을 한 번 맞춘다. 실시간 추종은 하지 않는다(의도). 재생목록 주소는 live-detail 의 livePlaybackJson.
    // 소리가 켜진 타일만 잰다(음소거 타일 몫의 부하를 없앤다). 음소거해도 표본은 간직해 다시 켤 때 바로 옛 평균으로 맞추고,
    // 5분 넘게 쉬었으면 표본을 2개만 남겨 빠른 주기로 갱신한다.
    // 부하 절감 세 가지: (1) 채널별 평균을 storage(roomLevelerProfiles)에 저장해 다음에 열 때 준비 과정 없이 바로 맞추고, 표본 편차가
    // 작은 채널은 주기를 30초·60초로 늘린다(적응형). (2) 탭이 숨겨졌거나 영상이 정지·버퍼링이면 재지 않는다. (3) 분석 컨텍스트는 8kHz 모노 —
    // 디코드 출력이 작아진다(4kHz 위 에너지가 빠져 0.5dB 쯤 낮게 재지만 채널 간 비교엔 영향 없다).
    //
    // 한계: 100% 를 넘겨 키울 수 없다. 기준보다 조용한 방송은 100% 에 고정되고 배지에 부족분을 표시한다 → 기준을 낮추고 시스템 볼륨을 올리는 식으로 쓴다.
    // 부작용: 치지직 플레이어는 volume 변경을 사용자 설정으로 저장한다. 끄면 처음 볼륨으로 되돌리지만, 켜진 채 타일을 없애면 마지막 값이 남는다.
    const LEVEL_POLL_FAST_MS = 3_000;                   // 켜자마자(표본 부족) 빠르게 재는 주기
    const LEVEL_POLL_MS = 10_000;                       // 자리를 잡은 뒤 표본 하나 받는 주기 (타일당 ≈5KB/s, 디코드 ~80ms/10초)
    const LEVEL_POLL_STEADY_MS = 30_000, LEVEL_POLL_IDLE_MS = 60_000;   // 표본 편차가 작아 안정된 채널은 더 드물게 (적응형 주기)
    const LEVEL_STEADY_STD_DB = 4, LEVEL_IDLE_STD_DB = 2;   // 편차(표준편차) 기준
    const LEVEL_DEVIATE_DB = 3;                         // 새 표본이 평균에서 이만큼 벗어나면 빠른 주기로 돌아간다(2번 연속이면 표본을 버리고 새로)
    const LEVEL_WARMUP = 3;                             // 이 개수까지는 빠른 주기
    const LEVEL_PROFILE_SEED = 6;                       // 저장된 프로파일로 시작할 때 표본으로 치는 개수(신뢰도만큼)
    const LEVEL_PROFILE_TTL_MS = 30 * 24 * 60 * 60_000; // 오래된 프로파일 정리
    const LEVEL_PROFILE_VERSION = 2;                    // 측정 방식이 바뀌면 올린다 (저장된 값을 버리기 위해)
    const LEVEL_WINDOW = 12;                            // 평균에 쓰는 표본 수 (10초 주기면 약 2분)
    const LEVEL_HYST_DB = 1;                            // 평균이 이만큼 이상 달라져야 볼륨을 다시 맞춘다
    const LEVEL_RAMP_MS = 1_000, LEVEL_RAMP_STEPS = 5;  // 볼륨 변경은 1초 램프로
    const LEVEL_STALE_MS = 5 * 60_000;                  // 이보다 오래 쉰 표본은 옛 평균으로만 쓰고 빨리 갱신한다
    const LEVEL_GATE_DB = -50;                          // 이보다 조용한 세그먼트(무음·잡음)는 표본에 넣지 않는다 (LUFS)
    const LEVEL_MIN_GAIN_DB = -40;
    const LEVEL_TARGET_DEF = -24, LEVEL_TARGET_MIN = -40, LEVEL_TARGET_MAX = -10;
    let levelTimer = null, analysisCtx = null;

    const dbToLin = (db) => Math.pow(10, db / 20);
    const linToDb = (x) => 20 * Math.log10(Math.max(x, 1e-6));
    const clampTarget = (v) => Number.isFinite(v) ? Math.min(LEVEL_TARGET_MAX, Math.max(LEVEL_TARGET_MIN, v)) : LEVEL_TARGET_DEF;

    // live-detail 응답에서 HLS 마스터 재생목록 주소 (없으면 "")
    function hlsPathOf(content) {
        try {
            const media = JSON.parse(content?.livePlaybackJson || "{}")?.media || [];
            return (media.find(m => m.protocol === "HLS") || media[0])?.path || "";
        } catch { return ""; }
    }
    // 마스터에서 대역폭이 가장 낮은 변형을 고른다 (분석용이라 오디오만 같으면 된다). 마스터가 아니면 그대로.
    async function pickLowestVariant(masterUrl) {
        const text = await (await fetch(masterUrl, { cache: "no-store" })).text();
        const lines = text.split("\n").map(l => l.trim());
        let best = null;
        for (let i = 0; i < lines.length - 1; i++) {
            if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
            const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || Infinity);
            if (!best || bw < best.bw) best = { bw, url: new URL(lines[i + 1], masterUrl).href };
        }
        return best?.url || masterUrl;
    }
    // 초기화 세그먼트 + 미디어 세그먼트를 이어 디코드하고 라우드니스(LUFS 근사)를 돌려준다. 무음이면 -Infinity.
    async function segmentLoudness(initBuf, segBuf) {
        const buf = new Uint8Array((initBuf?.byteLength || 0) + segBuf.byteLength);
        if (initBuf) buf.set(new Uint8Array(initBuf), 0);
        buf.set(new Uint8Array(segBuf), initBuf?.byteLength || 0);
        analysisCtx ||= new OfflineAudioContext(1, 8000, 8000);   // 모노·8kHz 로 리샘플되어 나온다 (음량 비교용으론 충분)
        const ab = await analysisCtx.decodeAudioData(buf.buffer);
        const x = Float32Array.from(ab.getChannelData(0));
        kCoefs ||= kWeightCoefs(ab.sampleRate);
        for (const c of kCoefs) biquad(x, c);
        return gatedLoudness(x, ab.sampleRate);
    }
    // BS.1770 K-가중을 표본율에 맞춰 만든 2차 필터 계수(RBJ cookbook). 1단: +4dB 하이셸프(1682Hz), 2단: 하이패스(38Hz)
    let kCoefs = null;
    function kWeightCoefs(fs) {
        const shelf = (f0, Q, gainDb) => {
            const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f0 / fs, c = Math.cos(w), a = Math.sin(w) / (2 * Q), s = 2 * Math.sqrt(A) * a;
            const a0 = (A + 1) - (A - 1) * c + s;
            return [A * ((A + 1) + (A - 1) * c + s) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - s) / a0,
                2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - s) / a0];
        };
        const hp = (f0, Q) => {
            const w = 2 * Math.PI * f0 / fs, c = Math.cos(w), a = Math.sin(w) / (2 * Q), a0 = 1 + a;
            return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - a) / a0];
        };
        return [shelf(1681.97, 0.7072, 3.9998), hp(38.135, 0.5003)];
    }
    function biquad(x, [b0, b1, b2, a1, a2]) {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < x.length; i++) {
            const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
        }
    }
    // 게이트 달린 라우드니스: 400ms 블록(100ms 간격), 절대 -70 LUFS, 상대 -10 LU 게이트. 통과 블록이 없으면 -Infinity
    function gatedLoudness(x, fs) {
        const block = Math.round(fs * 0.4), hop = Math.round(fs * 0.1);
        const powers = [];
        for (let s = 0; s + block <= x.length; s += hop) {
            let p = 0;
            for (let i = s; i < s + block; i++) p += x[i] * x[i];
            powers.push(p / block);
        }
        if (!powers.length) { let p = 0; for (const v of x) p += v * v; powers.push(p / Math.max(1, x.length)); }
        const lk = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
        const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const abs = powers.filter(p => lk(p) > -70);
        if (!abs.length) return -Infinity;
        const rel = lk(mean(abs)) - 10;
        const pass = abs.filter(p => lk(p) > rel);
        return pass.length ? lk(mean(pass)) : -Infinity;
    }

    // 타일 하나: 변형 재생목록을 읽고 아직 안 본 최신 세그먼트가 있으면 받아서 표본에 넣는다
    async function analyzeTile(id) {
        const tile = tiles.get(id);
        if (!tile || tile.lv?.busy) return;
        const lv = ensureLv(id);
        lv.busy = true;
        try {
            const hls = state.status[id]?.hls || "";
            if (!hls) { lv.fail = "nohls"; return; }
            if (lv.hls !== hls) { lv.hls = hls; lv.variant = await pickLowestVariant(hls); lv.initUrl = null; lv.lastSeg = null; }   // 방송이 다시 시작되면 주소가 바뀔 수 있다
            const pl = await (await fetch(lv.variant, { cache: "no-store" })).text();
            const lines = pl.split("\n").map(l => l.trim());
            const mapUri = /URI="([^"]+)"/.exec(lines.find(l => l.startsWith("#EXT-X-MAP")) || "")?.[1];
            const segs = lines.filter(l => l && !l.startsWith("#"));
            const seg = segs[segs.length - 1];
            if (!seg || seg === lv.lastSeg) return;
            lv.lastSeg = seg;
            const initUrl = mapUri ? new URL(mapUri, lv.variant).href : null;
            if (initUrl && initUrl !== lv.initUrl) { lv.initBuf = await (await fetch(initUrl)).arrayBuffer(); lv.initUrl = initUrl; }
            const segBuf = await (await fetch(new URL(seg, lv.variant).href)).arrayBuffer();
            const db = await segmentLoudness(lv.initBuf, segBuf);
            if (db > LEVEL_GATE_DB) {
                // 평균에서 크게 벗어난 표본: 한 번이면 빠른 주기로 확인, 두 번 연속이면 스트리머가 볼륨을 바꾼 것으로 보고 새로 시작
                const deviates = lv.measDb != null && Math.abs(db - lv.measDb) > LEVEL_DEVIATE_DB;
                lv.deviations = deviates ? (lv.deviations || 0) + 1 : 0;
                if (lv.deviations >= 2) { lv.samples = lv.samples.slice(-1); lv.deviations = 0; }
                lv.samples.push(db);
                lv.lastAt = Date.now();
                if (lv.samples.length > LEVEL_WINDOW) lv.samples.shift();
                lv.measDb = powerMeanDb(lv.samples);
                levelApply(id);
                saveProfile(id, lv);
            }
            lv.fail = null;
            WT.log("level", id.slice(0, 6), { seg: Math.round(db), avg: Math.round(lv.measDb ?? -999), n: lv.samples.length, std: +stdDb(lv.samples).toFixed(1), next: nextInterval(lv) / 1000 });
        } catch (e) {
            lv.fail = e?.message || "err";
            lv.hls = null;   // 다음 주기에 주소·변형을 다시 잡는다
            WT.log("level", "분석 실패", id.slice(0, 6), lv.fail);
        } finally {
            lv.busy = false;
            lv.nextAt = Date.now() + nextInterval(lv);
            renderLevel(tile);
        }
    }
    // 타일의 평준화 상태. 저장된 프로파일이 있으면 그 평균을 표본 몇 개로 쳐서 준비 과정 없이 시작한다.
    function ensureLv(id) {
        const tile = tiles.get(id);
        if (!tile) return null;
        if (tile.lv) return tile.lv;
        const lv = tile.lv = { samples: [], measDb: null, applied: null, origVolume: null, busy: false, fail: null, nextAt: 0, deviations: 0, lastAt: 0 };
        const prof = state.levelProfiles[id];
        if (prof && Number.isFinite(prof.db)) {
            lv.samples = new Array(Math.max(1, Math.min(LEVEL_PROFILE_SEED, prof.n || 1))).fill(prof.db);
            lv.measDb = prof.db;
            lv.lastAt = prof.at || 0;
        }
        return lv;
    }
    // 적응형 주기: 표본이 적으면 빠르게, 편차가 작으면 드물게, 방금 벗어난 표본이 있으면 다시 빠르게
    function nextInterval(lv) {
        if (lv.samples.length < LEVEL_WARMUP || lv.deviations > 0) return lv.samples.length < LEVEL_WARMUP ? LEVEL_POLL_FAST_MS : LEVEL_POLL_MS;
        const std = stdDb(lv.samples);
        return std < LEVEL_IDLE_STD_DB ? LEVEL_POLL_IDLE_MS : std < LEVEL_STEADY_STD_DB ? LEVEL_POLL_STEADY_MS : LEVEL_POLL_MS;
    }
    function stdDb(samples) {
        if (samples.length < 2) return Infinity;
        const m = samples.reduce((a, b) => a + b, 0) / samples.length;
        return Math.sqrt(samples.reduce((a, b) => a + (b - m) * (b - m), 0) / samples.length);
    }
    // 채널 프로파일 저장(30초에 한 번까지만). 오래된 항목은 함께 정리한다.
    let profileSaveTimer = null;
    function saveProfile(id, lv) {
        state.levelProfiles[id] = { v: LEVEL_PROFILE_VERSION, db: +lv.measDb.toFixed(1), n: lv.samples.length, at: Date.now() };
        if (profileSaveTimer) return;
        profileSaveTimer = setTimeout(() => {
            profileSaveTimer = null;
            const now = Date.now();
            for (const [k, v] of Object.entries(state.levelProfiles)) if (!v || now - (v.at || 0) > LEVEL_PROFILE_TTL_MS) delete state.levelProfiles[k];
            browser.storage.local.set({ roomLevelerProfiles: state.levelProfiles }).catch(() => {});
        }, 30_000);
    }
    // 표본(LUFS)들의 파워 평균 — 큰 구간이 더 반영되는 "평균 음량"
    function powerMeanDb(samples) {
        let sum = 0;
        for (const db of samples) sum += Math.pow(10, db / 10);
        return 10 * Math.log10(sum / samples.length);
    }
    // 1초마다 돌며, 소리가 켜진 타일 중 차례가 된 것만 표본을 받는다
    function levelSchedule() {
        if (!state.leveler.enabled || document.hidden) return;   // 탭이 숨겨져 있으면 듣고 있지 않다
        const now = Date.now();
        for (const [id, tile] of tiles) {
            if (tile.root.classList.contains("offline")) continue;
            if (!state.sounds.has(id)) continue;   // 음소거 타일은 표본을 간직한 채 쉰다
            const v = tileVideo(id);
            if (!v || v.paused || v.readyState < 3) continue;   // 정지·버퍼링 중엔 재지 않는다
            const lv = tile.lv;
            if (lv?.samples.length && now - (lv.lastAt || 0) > LEVEL_STALE_MS) lv.samples = lv.samples.slice(-2);   // 오래 쉬었다 켜짐 → 빠른 주기로 갱신
            if (!lv || lv.nextAt <= now) analyzeTile(id);
        }
    }
    // 평균이 기준에서 벗어난 만큼 볼륨을 정한다. 이전 적용값과 1dB 이상 차이 날 때만, 1초 램프로 바꾼다.
    function levelApply(id) {
        const tile = tiles.get(id);
        const lv = tile ? ensureLv(id) : null;
        const v = tileVideo(id);
        if (!lv || !v || lv.measDb == null) return;
        const want = Math.min(0, Math.max(LEVEL_MIN_GAIN_DB, state.leveler.target - lv.measDb));
        if (lv.applied != null && Math.abs(want - lv.applied) < LEVEL_HYST_DB) return;
        if (lv.origVolume == null) lv.origVolume = playerStoredVolume(id) ?? v.volume;   // 끌 때 되돌릴 값
        lv.applied = want;
        rampVolume(lv, v, Math.min(1, dbToLin(want)));
        WT.log("level", "볼륨 조절", id.slice(0, 6), { avg: Math.round(lv.measDb), gain: +want.toFixed(1), vol: +Math.min(1, dbToLin(want)).toFixed(2) });
        renderLevel(tile);
    }
    function rampVolume(lv, v, to) {
        clearInterval(lv.ramp);
        const from = v.volume, step = LEVEL_RAMP_MS / LEVEL_RAMP_STEPS;
        let i = 0;
        lv.ramp = setInterval(() => {
            i++;
            try { v.volume = from + (to - from) * (i / LEVEL_RAMP_STEPS); } catch {}
            if (i >= LEVEL_RAMP_STEPS) { clearInterval(lv.ramp); lv.ramp = null; }
        }, step);
    }
    function levelApplyAll() { for (const id of tiles.keys()) levelApply(id); }
    function levelerStart() {
        levelTimer ||= setInterval(levelSchedule, 1_000);
        levelSchedule();
    }
    function levelerStop() {
        clearInterval(levelTimer); levelTimer = null;
        for (const tile of tiles.values()) detachLeveler(tile);
    }
    // 타일의 평준화 상태를 지우고 플레이어 볼륨을 처음 값으로 되돌린다
    function detachLeveler(tile) {
        if (!tile?.lv) return;
        clearInterval(tile.lv.ramp);
        const v = tileVideo(tile.root.dataset.id);
        if (v && tile.lv.origVolume != null) { try { v.volume = tile.lv.origVolume; } catch {} WT.log("level", "볼륨 복원", tile.root.dataset.id.slice(0, 6), tile.lv.origVolume); }
        tile.lv = null;
        renderLevel(tile);
    }
    // 플레이어가 저장해 둔 사용자 볼륨. 프로그램으로 바꾼 video.volume 은 여기에 저장되지 않는다(2026-09-13 STP 확인).
    function playerStoredVolume(id) {
        try {
            const raw = tiles.get(id)?.iframe.contentWindow?.localStorage.getItem("player-volume");
            const val = raw ? JSON.parse(raw)?.value : null;
            return typeof val === "number" && val >= 0 && val <= 1 ? val : null;
        } catch { return null; }
    }
    function applyLevelerSetting() {
        if (state.leveler.enabled) levelerStart(); else levelerStop();
        WT.log("level", state.leveler.enabled ? "켬" : "끔", state.leveler.target);
    }
    function renderLevelerSettings() {
        const on = document.getElementById("wt-lv-on");
        if (on) on.checked = state.leveler.enabled;
        const range = document.getElementById("wt-lv-target");
        if (range && Number(range.value) !== state.leveler.target) range.value = String(state.leveler.target);
        const desc = document.getElementById("wt-lv-target-desc");
        if (desc) desc.textContent = `${t("roomLevelerTargetDesc")} · ${t("roomCurrent")}: ${state.leveler.target} LUFS`;
    }
    // 타일 상단 배지: 적용 중인 볼륨 % 만 짧게. ▲ 는 기준보다 조용해 100% 에 고정됐다는 뜻. 자세한 값은 툴팁.
    function renderLevel(tile) {
        const badge = tile.root.querySelector(".wt-level");
        if (!badge) return;
        const lv = tile.lv;
        let text = "", title = t("roomLevelerBadge");
        if (lv) {
            if (lv.fail) { text = "♪ ✗"; title = `${t("roomLevelerBadge")} · ${lv.fail}`; }
            else if (lv.measDb == null || lv.applied == null) text = "♪ …";
            else {
                const short = state.leveler.target - lv.measDb;   // 양수면 기준까지 이만큼 더 키워야 하는데 못 키운다
                text = `♪ ${Math.round(Math.min(1, dbToLin(lv.applied)) * 100)}%` + (short > 0.5 ? " ▲" : "");
                title = `${Math.round(lv.measDb)} LUFS · ${t("roomLevelerTarget")} ${state.leveler.target}` + (short > 0.5 ? ` · ${t("roomLevelerShort")} ${short.toFixed(1)} dB` : "");
            }
        }
        if (badge.textContent !== text) badge.textContent = text;
        if (badge.title !== title) badge.title = title;
    }

    // --- 재생 실패 감시 ---
    // 치지직 플레이어가 "미디어 재생이 실패했습니다" 를 띄우거나 video.error 가 생기면
    // 우리 오버레이를 덮고 자동으로 다시 불러온다(10분에 3회까지). 그 뒤로는 수동 버튼만.
    function detectPlaybackError(id) {
        const tile = tiles.get(id);
        const doc = tile?.iframe.contentDocument;
        if (!doc || !tile.styled) return false;
        const v = doc.querySelector("video");
        if (v?.error) return true;
        const layout = doc.getElementById("live_player_layout");
        const text = layout?.innerText || "";
        return /재생이 실패|재생할 수 없|playback failed|cannot be played/i.test(text);
    }
    function checkPlayback() {
        for (const ch of state.channels) {
            const id = ch.id;
            const tile = tiles.get(id);
            if (!tile || tile.root.classList.contains("offline")) continue;
            const failed = detectPlaybackError(id);
            if (!failed) { if (tile.root.classList.contains("error")) tile.root.classList.remove("error"); continue; }
            if (tile.root.classList.contains("error")) continue;   // 이미 처리 중
            tile.root.classList.add("error");
            const rec = state.errors[id] || { count: 0, last: 0 };
            if (Date.now() - rec.last > RETRY_WINDOW_MS) rec.count = 0;
            state.errors[id] = rec;
            const sub = tile.root.querySelector(".wt-error-sub");
            if (rec.count < RETRY_MAX) {
                sub.textContent = t("roomRetrying");
                setTimeout(() => { if (tile.root.classList.contains("error")) retryTile(id, false); }, RETRY_DELAY_MS);
            } else {
                sub.textContent = t("roomRetryGiveUp");
            }
            WT.log("room", "재생 실패 감지", id.slice(0, 6), rec);
        }
    }
    function retryTile(id, manual) {
        const tile = tiles.get(id);
        if (!tile) return;
        const rec = state.errors[id] || { count: 0, last: 0 };
        if (manual) rec.count = 0; else rec.count += 1;
        rec.last = Date.now();
        state.errors[id] = rec;
        tile.styled = false;
        tile.root.classList.remove("ready", "error");
        tile.root.querySelector(".wt-error-sub").textContent = "";
        reloadTile(id);
        WT.log("room", "다시 시도", id.slice(0, 6), manual ? "수동" : "자동", rec.count);
    }
    function reloadTile(id) {
        const tile = tiles.get(id);
        if (!tile) return;
        try { tile.iframe.contentWindow.location.reload(); }
        catch { tile.iframe.src = tile.iframe.src; }
    }

    // --- 방송 상태 폴링 (공개 API, 로그인 불필요) ---
    async function refreshStatus(ids = state.channels.map(c => c.id), opts = {}) {
        let changed = false;
        await Promise.all(ids.map(async (id) => {
            try {
                const r = await fetch(`${API}/v2/channels/${id}/live-detail`, { credentials: "include" });
                const c = (await r.json())?.content;
                const wasOffline = isOffline(id);
                state.status[id] = c ? { open: c.status === "OPEN", title: c.liveTitle || "", viewers: c.concurrentUserCount, hls: hlsPathOf(c) } : { open: false };
                if (wasOffline !== isOffline(id)) changed = true;
                // 이름 없이 추가된 채널(URL 추가)은 여기서 이름을 채운다
                const ch = state.channels.find(x => x.id === id);
                if (ch && !ch.name && c?.channel?.channelName) {
                    ch.name = c.channel.channelName; saveState();
                    const nameEl = tiles.get(id)?.root.querySelector(".wt-name");
                    if (nameEl) nameEl.textContent = ch.name;
                }
            } catch (e) {
                WT.log("room", "상태 조회 실패", id, e?.message);
            }
            updateTile(id);
        }));
        if (changed && opts.render !== false) render();   // 종료 → 선반으로, 재개 → 원래 자리로
    }

    // --- 시작 ---
    async function main() {
        buildDocument();
        await Promise.all([loadSettings(), loadState()]);
        render();
        refreshStatus();
        setInterval(() => refreshStatus(), STATUS_INTERVAL_MS);
        setInterval(checkPlayback, PLAYBACK_CHECK_MS);
        window.addEventListener("resize", fitTiles);
        document.addEventListener("pointerdown", applyPendingSounds, true);
        applyLevelerSetting();
        document.addEventListener("keydown", (e) => { if (handleRoomKey(e)) e.preventDefault(); });
        // 채팅 서랍 iframe 안에서도(입력창 밖) 같은 단축키가 통하게. 채널이 바뀌어 다시 불러오면 load 가 또 와서 새 문서에 붙는다.
        document.getElementById("wt-chat-frame")?.addEventListener("load", (e) => {
            try { e.target.contentDocument?.addEventListener("keydown", (ke) => { if (handleRoomKey(ke)) { ke.preventDefault(); ke.stopImmediatePropagation(); } }, true); }
            catch (_) { /* about:blank 나 교차 출처면 무시 */ }
        });
        WT.log("room", "상황실 시작", state.channels.length, "채널");
    }

    // document_start 에서 실행된다. 파서가 남긴 게 있어도 buildDocument 가 덮어쓴다.
    main();
})();
