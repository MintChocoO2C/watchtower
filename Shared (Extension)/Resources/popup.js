const toggle = document.getElementById("auto-pip-toggle");
const ytLogoToggle = document.getElementById("yt-logo-miniplayer-toggle");
const ytHideShortsToggle = document.getElementById("yt-hide-shorts-toggle");
const vimiumToggle = document.getElementById("vimium-toggle");
const vimiumSub = document.getElementById("vimium-sub");
const vimiumScrollStep = document.getElementById("vimium-scroll-step");
const vimiumScrollBehavior = document.getElementById("vimium-scroll-behavior");
const vimiumKeyTimeout = document.getElementById("vimium-key-timeout");
const debugToggle = document.getElementById("debug-toggle");
const statusEl = document.getElementById("status");

// i18n 적용
function t(key, substitutions) {
    return browser.i18n.getMessage(key, substitutions) || key;
}

document.querySelectorAll("[data-i18n]").forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
});

// 저장된 설정 불러와서 토글/입력에 반영
browser.storage.local.get([
    "autoPiPEnabled", "ytLogoMiniplayerEnabled", "ytHideShortsEnabled",
    "vimiumEnabled", "vimiumScrollStep", "vimiumScrollBehavior", "vimiumKeyTimeout",
    "debugEnabled"
]).then((result) => {
    toggle.checked = result.autoPiPEnabled ?? false;
    ytLogoToggle.checked = result.ytLogoMiniplayerEnabled ?? false;
    ytHideShortsToggle.checked = result.ytHideShortsEnabled ?? false;
    vimiumToggle.checked = result.vimiumEnabled ?? false;
    vimiumScrollStep.value = result.vimiumScrollStep ?? 60;
    vimiumScrollBehavior.value = result.vimiumScrollBehavior ?? "smooth";
    vimiumKeyTimeout.value = result.vimiumKeyTimeout ?? 1000;
    debugToggle.checked = result.debugEnabled ?? false;
    updateVimiumSubState();
});

// Vimium sub-section 활성/비활성 (회색 처리 + 입력 disable)
function updateVimiumSubState() {
    const on = vimiumToggle.checked;
    vimiumSub.classList.toggle("disabled", !on);
    vimiumScrollStep.disabled = !on;
    vimiumScrollBehavior.disabled = !on;
    vimiumKeyTimeout.disabled = !on;
}

// 숫자 input 값 정규화 (range 클램핑 + 정수 변환)
function clampInt(input, fallback, min, max) {
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v)) v = fallback;
    v = Math.max(min, Math.min(max, v));
    input.value = String(v);
    return v;
}

function showStatus(msg) {
    statusEl.textContent = msg;
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
}

// 토글 변경 시 설정 저장
toggle.addEventListener("change", () => {
    browser.storage.local.set({ autoPiPEnabled: toggle.checked });
    showStatus(t(toggle.checked ? "autoPipOn" : "autoPipOff"));
});

ytLogoToggle.addEventListener("change", () => {
    browser.storage.local.set({ ytLogoMiniplayerEnabled: ytLogoToggle.checked });
    showStatus(t(ytLogoToggle.checked ? "ytMiniplayerOn" : "ytMiniplayerOff"));
});

ytHideShortsToggle.addEventListener("change", () => {
    browser.storage.local.set({ ytHideShortsEnabled: ytHideShortsToggle.checked });
    showStatus(t(ytHideShortsToggle.checked ? "hideShortsOn" : "hideShortsOff"));
});

vimiumToggle.addEventListener("change", () => {
    browser.storage.local.set({ vimiumEnabled: vimiumToggle.checked });
    showStatus(t(vimiumToggle.checked ? "vimiumOn" : "vimiumOff"));
    updateVimiumSubState();
});

vimiumScrollStep.addEventListener("change", () => {
    const v = clampInt(vimiumScrollStep, 60, 1, 9999);
    browser.storage.local.set({ vimiumScrollStep: v });
});

vimiumScrollBehavior.addEventListener("change", () => {
    browser.storage.local.set({ vimiumScrollBehavior: vimiumScrollBehavior.value });
});

vimiumKeyTimeout.addEventListener("change", () => {
    const v = clampInt(vimiumKeyTimeout, 1000, 100, 10000);
    browser.storage.local.set({ vimiumKeyTimeout: v });
});

debugToggle.addEventListener("change", () => {
    browser.storage.local.set({ debugEnabled: debugToggle.checked });
    showStatus(t(debugToggle.checked ? "debugOn" : "debugOff"));
});

// 현재 탭의 비디오 상태 표시
async function refreshStatus() {
    try {
        const response = await browser.runtime.sendMessage({
            target: "content",
            action: "getStatus"
        });
        if (response && response.playingCount > 0) {
            statusEl.textContent = t("videoPlaying", [String(response.playingCount)]);
        } else if (response && response.videoCount > 0) {
            statusEl.textContent = t("videoPaused");
        }
    } catch {
        // Content script not loaded on this page
    }
}

refreshStatus();
