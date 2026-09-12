const toggle = document.getElementById("auto-pip-toggle");
const pressFfToggle = document.getElementById("press-ff-toggle");
const ytLogoToggle = document.getElementById("yt-logo-miniplayer-toggle");
const ytHideShortsToggle = document.getElementById("yt-hide-shorts-toggle");
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
    "autoPiPEnabled", "pressFastForwardEnabled", "ytLogoMiniplayerEnabled", "ytHideShortsEnabled",
    "debugEnabled"
]).then((result) => {
    toggle.checked = result.autoPiPEnabled ?? false;
    pressFfToggle.checked = result.pressFastForwardEnabled ?? false;
    ytLogoToggle.checked = result.ytLogoMiniplayerEnabled ?? false;
    ytHideShortsToggle.checked = result.ytHideShortsEnabled ?? false;
    debugToggle.checked = result.debugEnabled ?? false;
});

// 상태 줄은 두 가지가 공유한다: 토글 ON/OFF 토스트(2초)와 현재 탭 영상 상태(상시).
// 토스트가 사라지면 영상 상태를 다시 보여준다.
let videoStatus = "";
let toastTimer = null;

function showStatus(msg) {
    statusEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { statusEl.textContent = videoStatus; }, 2000);
}

// 토글 변경 시 설정 저장
toggle.addEventListener("change", () => {
    browser.storage.local.set({ autoPiPEnabled: toggle.checked });
    showStatus(t(toggle.checked ? "autoPipOn" : "autoPipOff"));
});

pressFfToggle.addEventListener("change", () => {
    browser.storage.local.set({ pressFastForwardEnabled: pressFfToggle.checked });
    showStatus(t(pressFfToggle.checked ? "pressFastForwardOn" : "pressFastForwardOff"));
});

ytLogoToggle.addEventListener("change", () => {
    browser.storage.local.set({ ytLogoMiniplayerEnabled: ytLogoToggle.checked });
    showStatus(t(ytLogoToggle.checked ? "ytMiniplayerOn" : "ytMiniplayerOff"));
});

ytHideShortsToggle.addEventListener("change", () => {
    browser.storage.local.set({ ytHideShortsEnabled: ytHideShortsToggle.checked });
    showStatus(t(ytHideShortsToggle.checked ? "hideShortsOn" : "hideShortsOff"));
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
            videoStatus = t("videoPlaying", [String(response.playingCount)]);
        } else if (response && response.videoCount > 0) {
            videoStatus = t("videoPaused");
        }
        if (!toastTimer) statusEl.textContent = videoStatus;
    } catch {
        // Content script not loaded on this page
    }
}

refreshStatus();
