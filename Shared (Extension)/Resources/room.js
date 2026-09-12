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
        cols: "auto",   // "auto" | 1..4
        fit: false,     // true면 스크롤 없이 모든 타일이 한 화면에 들어오도록 크기를 줄인다
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

        const bar = el("header", { class: "wt-bar" }, [
            el("span", { class: "wt-title", text: t("roomTitle") }),
            el("span", { class: "wt-count", id: "wt-count" }),
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
        const shelf = el("footer", { class: "wt-shelf", id: "wt-shelf", hidden: "" }, [
            el("span", { class: "wt-shelf-label", text: t("roomOfflineShelf") }),
            el("div", { class: "wt-shelf-list", id: "wt-shelf-list" }),
        ]);
        // 패널/서랍 바깥을 누르면 닫히게 하는 투명 배경
        const backdrop = el("div", { class: "wt-backdrop", id: "wt-backdrop", hidden: "", onclick: closeOverlays });
        // 채팅 자리 — 지금은 비워 둔다 (나중에 소리 채널의 채팅을 여기에 붙인다)
        const chat = el("aside", { class: "wt-chat", id: "wt-chat", hidden: "" });
        const drawer = buildSettingsDrawer();
        const panel = el("div", { class: "wt-panel", id: "wt-follow", hidden: "" });
        body.append(bar, el("div", { class: "wt-body" }, [scroll, chat]), shelf, backdrop, drawer, panel);
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

    function speakerIcon(on) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
        svg.innerHTML = on
            ? '<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
            : '<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 6l4 4M14.5 6l-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';
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
        const keys = SETTINGS.flatMap(g => g.items.map(i => i.key));
        const r = await WT.load(keys);
        for (const key of keys) {
            const input = document.querySelector(`input[data-key="${key}"]`);
            if (input) input.checked = r[key] ?? false;
        }
        WT.watch(keys, (c) => {
            for (const key of Object.keys(c)) {
                const input = document.querySelector(`input[data-key="${key}"]`);
                if (input) input.checked = c[key].newValue ?? false;
            }
        });
    }

    // --- 채널 목록 저장/복원 ---
    async function loadState() {
        const r = await WT.load(["roomChannels", "roomSound", "roomLayout"]);
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
            roomChannels: state.channels, roomSound: [...state.sounds],
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
        document.getElementById("wt-count").textContent = state.channels.length
            ? `${n}/${state.channels.length} · ${cols}${t("roomCols")}` : "";
        for (const b of document.querySelectorAll(".wt-seg-btn")) {
            b.setAttribute("aria-pressed", String(b.dataset.cols === String(state.cols)));
        }
        document.getElementById("wt-fit").setAttribute("aria-pressed", String(state.fit));

        // 없어졌거나 종료된 채널의 타일은 내린다 (종료된 방송의 iframe 은 붙들고 있지 않는다)
        for (const [id, tile] of tiles) {
            if (!online.some(c => c.id === id)) { tile.root.remove(); tiles.delete(id); }
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
                ondragstart: (e) => onDragStart(ch.id, e), ondragend: onDragEnd }, [
                el("span", { class: "wt-live", text: "LIVE" }),
                el("span", { class: "wt-name", text: ch.name || ch.id }),
                el("span", { class: "wt-viewers" }),
                el("span", { class: "wt-sp" }),
                el("button", { class: "wt-btn wt-icon wt-remove", type: "button", title: t("roomRemove"), "aria-label": t("roomRemove"), text: "×",
                    onclick: (e) => { e.stopPropagation(); removeChannel(ch.id); } }),
            ]),
            el("button", { class: "wt-tile-sound", type: "button", onclick: () => toggleSound(ch.id) }),
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
    function toggleSound(id) {
        if (state.sounds.has(id)) state.sounds.delete(id); else state.sounds.add(id);
        saveState();
        applySound(id);
    }
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
        }
        updateTile(id);
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
        const btn = tile.root.querySelector(".wt-tile-sound");
        const label = on ? t("roomSound") : t("roomMuted");
        if (btn.dataset.on !== String(on)) {
            btn.dataset.on = String(on);
            btn.replaceChildren(speakerIcon(on));
            btn.title = label; btn.setAttribute("aria-label", label);
        }
        tile.root.querySelector(".wt-viewers").textContent = st?.open && st.viewers != null ? st.viewers.toLocaleString() : "";
        tile.root.querySelector(".wt-name").title = st?.title || "";
    }

    // --- 채널 추가/제거 ---
    function addChannel(ch) {
        if (!ch?.id) return;
        if (state.channels.some(c => c.id === ch.id)) return;
        if (state.channels.length >= MAX_CHANNELS) { alert(t("roomMax")); return; }
        state.channels.push({ id: ch.id, name: ch.name || "", image: ch.image || "" });
        saveState(); render(); refreshStatus([ch.id]);
    }
    function removeChannel(id) {
        state.channels = state.channels.filter(c => c.id !== id);
        state.sounds.delete(id);
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
    async function refreshStatus(ids = state.channels.map(c => c.id)) {
        let changed = false;
        await Promise.all(ids.map(async (id) => {
            try {
                const r = await fetch(`${API}/v2/channels/${id}/live-detail`, { credentials: "include" });
                const c = (await r.json())?.content;
                const wasOffline = isOffline(id);
                state.status[id] = c ? { open: c.status === "OPEN", title: c.liveTitle || "", viewers: c.concurrentUserCount } : { open: false };
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
        if (changed) render();   // 종료 → 선반으로, 재개 → 원래 자리로
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
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlays(); });
        WT.log("room", "상황실 시작", state.channels.length, "채널");
    }

    // document_start 에서 실행된다. 파서가 남긴 게 있어도 buildDocument 가 덮어쓴다.
    main();
})();
