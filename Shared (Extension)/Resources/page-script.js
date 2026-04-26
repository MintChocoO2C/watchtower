// Watchtower Page Script (메인 세계에서 실행)
// manifest.json의 "world": "MAIN" 으로 브라우저가 직접 주입

// 디버그 로그 — 팝업의 "디버그 로깅" 토글로 제어
let DEBUG = false;
const log = (...args) => { if (DEBUG) console.log("[WT]", ...args); };

let autoPiPEnabled = false;
let autoPiPTriggered = false;
let ytLogoMiniplayerEnabled = false;
let miniplayerActive = false;

// --- 재생 중인 비디오 찾기 ---
function findPlayingVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.find(v => !v.paused && !v.ended) || null;
}

// --- autoPictureInPicture 속성 적용 ---
function applyAutoPiP(video) {
    if (!autoPiPEnabled) return;
    video.removeAttribute("disablepictureinpicture");
    video.autoPictureInPicture = true;
    try {
        Object.defineProperty(video, "autoPictureInPicture", {
            get() { return true; },
            set() {},
            configurable: true
        });
    } catch (e) {}
}

function applyToAllVideos() {
    document.querySelectorAll("video").forEach(applyAutoPiP);
}

// --- 탭 전환 시 PiP 진입/해제 (메인 세계에서 시도) ---
document.addEventListener("visibilitychange", async () => {
    if (!autoPiPEnabled) return;

    if (document.hidden) {
        if (document.pictureInPictureElement) return;
        const video = findPlayingVideo();
        if (!video) return;

        // 방법 1: Safari 전용 webkitSetPresentationMode
        try {
            if (video.webkitSupportsPresentationMode &&
                video.webkitSupportsPresentationMode("picture-in-picture")) {
                video.webkitSetPresentationMode("picture-in-picture");
                autoPiPTriggered = true;
                return;
            }
        } catch (e) {}

        // 방법 2: 표준 requestPictureInPicture
        try {
            await video.requestPictureInPicture();
            autoPiPTriggered = true;
        } catch (e) {}
    } else {
        // 탭으로 돌아옴
        if (!autoPiPTriggered) return;

        try {
            const pipVideo = document.pictureInPictureElement;
            if (pipVideo) {
                if (pipVideo.webkitSetPresentationMode) {
                    pipVideo.webkitSetPresentationMode("inline");
                } else {
                    await document.exitPictureInPicture();
                }
            }
        } catch (e) {}
        autoPiPTriggered = false;
    }
});

// PiP가 외부에서 종료됨
document.addEventListener("leavepictureinpicture", () => {
    autoPiPTriggered = false;
});
document.addEventListener("webkitpresentationmodechanged", (e) => {
    if (e.target.webkitPresentationMode === "inline") {
        autoPiPTriggered = false;
    }
}, true);

// --- 새 비디오 감지 ---
const observer = new MutationObserver((mutations) => {
    if (!autoPiPEnabled) return;
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.tagName === "VIDEO") applyAutoPiP(node);
            node.querySelectorAll?.("video").forEach(applyAutoPiP);
        }
    }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// --- YouTube: 로고 클릭 / 미니플레이어 → 전체 플레이어 ---
if (location.hostname.includes("youtube.com")) {

    // 미니플레이어 상태에서 watch 이동 여부 판단
    function isMiniplayerWatchUrl(url) {
        if (!miniplayerActive || !ytLogoMiniplayerEnabled || !url) return null;
        if (location.pathname.startsWith("/watch")) return null; // 활성화 단계 무시
        try {
            const parsed = new URL(url, location.origin);
            if (parsed.pathname === "/watch" && parsed.searchParams.has("v")) return parsed.href;
        } catch {}
        return null;
    }

    // 방법 A: history 오버라이드 (SPA 라우터 차단)
    const originalPushState = history.pushState.bind(history);
    history.pushState = function(state, title, url) {
        log("pushState", { url, miniplayerActive, pathname: location.pathname });
        const target = isMiniplayerWatchUrl(url);
        if (target) { miniplayerActive = false; window.location.href = target; return; }
        return originalPushState(state, title, url);
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function(state, title, url) {
        log("replaceState", { url, miniplayerActive, pathname: location.pathname });
        const target = isMiniplayerWatchUrl(url);
        if (target) { miniplayerActive = false; window.location.href = target; return; }
        return originalReplaceState(state, title, url);
    };

    // 방법 B: 클릭 인터셉트 (캡처 단계로 YouTube보다 먼저 실행)
    document.addEventListener("click", (e) => {
        if (!miniplayerActive || !ytLogoMiniplayerEnabled) return;
        if (location.pathname.startsWith("/watch")) return;

        const link = e.target.closest("a[href]");
        if (!link) return;

        let watchUrl = null;
        try {
            const url = new URL(link.href);
            if (url.pathname === "/watch" && url.searchParams.has("v") && url.hostname.includes("youtube.com")) {
                watchUrl = link.href;
            }
        } catch { return; }

        log("click intercept", { watchUrl, miniplayerActive, target: e.target.tagName });
        if (!watchUrl) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        miniplayerActive = false;
        window.location.href = watchUrl;
    }, true);

    // 로고 클릭 → 미니플레이어 전환
    document.addEventListener("click", (e) => {
        if (!ytLogoMiniplayerEnabled) return;
        if (!location.pathname.startsWith("/watch")) return;

        const link = e.target.closest("a");
        if (!link) return;

        const inMasthead = e.target.closest("ytd-masthead, #masthead") !== null;
        if (!inMasthead) return;

        let isHomeLink = false;
        try {
            const url = new URL(link.href);
            isHomeLink = url.pathname === "/" && url.hostname.includes("youtube.com");
        } catch { return; }
        if (!isHomeLink) return;

        if (!findPlayingVideo()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        miniplayerActive = true;
        log("logo clicked → miniplayerActive = true");

        const miniplayerBtn = document.querySelector(".ytp-miniplayer-button");
        if (miniplayerBtn) {
            log("clicking .ytp-miniplayer-button");
            miniplayerBtn.click();
            return;
        }

        log("fallback: keyboard shortcut i");
        document.querySelector("#movie_player, .html5-video-player")
            ?.dispatchEvent(new KeyboardEvent("keydown", {
                key: "i", keyCode: 73, which: 73, code: "KeyI", bubbles: true
            }));
    }, true);
}


// --- 동영상 프레임 복사 + 다운로드 ---
// window에 직접 저장 — background.js의 executeScript(world:"MAIN")에서 접근 가능
window._lastRightClickedVideo = null;
window._wtDebug = false;

// 우클릭된 비디오 추적 — capture로 사이트보다 먼저 실행
// video 위에서 stopImmediatePropagation → 사이트의 contextmenu 차단 무력화
document.addEventListener("contextmenu", (e) => {
    const video = e.target.closest("video");
    window._lastRightClickedVideo = video ?? null;
    if (video) {
        e.stopImmediatePropagation();
        log("contextmenu: video found");
    }
}, true);

// 토스트 알림
function _wtShowFrameToast(message, isError = false) {
    document.getElementById("wt-frame-toast")?.remove();
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const toast = document.createElement("div");
    toast.id = "wt-frame-toast";
    toast.textContent = message;
    toast.style.cssText = [
        "position:fixed", "bottom:28px", "left:50%", "transform:translateX(-50%)",
        `background:${isError ? "#c0392b" : (dark ? "#444" : "#333")}`,
        "color:#fff", "padding:9px 20px", "border-radius:8px",
        "font:14px -apple-system,sans-serif", "z-index:2147483647",
        "pointer-events:none", "opacity:1", "transition:opacity .3s", "white-space:nowrap"
    ].join(";");
    document.body?.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 350); }, 2500);
}

// 비디오 캡처 공통 함수
function _wtCaptureVideoFrame(video, onBlob, onError) {
    const w = video.videoWidth || video.offsetWidth;
    const h = video.videoHeight || video.offsetHeight;
    if (!w || !h) { if (onError) onError(null); return; }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    try {
        canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    } catch (e) {
        log("drawImage error:", e);
        if (onError) onError(e);
        return;
    }
    try {
        canvas.toBlob((blob) => {
            if (blob) onBlob(blob);
            else if (onError) onError(null);
        }, "image/png");
    } catch (e) {
        log("toBlob error:", e);
        if (onError) onError(e);
    }
}

// 파일명 생성
function _wtFrameFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `frame-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
         + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
}

// background.js의 executeScript(world:"MAIN")에서 직접 발생시킨 이벤트 수신
document.addEventListener("watchtower-download-frame", () => {
    const video = window._lastRightClickedVideo;
    log("download 이벤트 수신, video:", video ? "found" : "null");
    if (!video) return;

    const ko = navigator.language?.startsWith("ko");
    _wtCaptureVideoFrame(video, (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = _wtFrameFilename();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        _wtShowFrameToast(ko ? "프레임이 저장되었습니다" : "Frame saved");
    }, (e) => {
        const msg = e?.name === "SecurityError"
            ? (ko ? "보안 정책으로 캡처가 제한됩니다" : "Capture blocked by security policy")
            : (ko ? "캡처에 실패했습니다" : "Capture failed");
        _wtShowFrameToast(msg, true);
    });
});

// --- content.js에서 설정 수신 ---
document.addEventListener("watchtower-settings", (e) => {
    DEBUG = e.detail.debugEnabled ?? false;
    window._wtDebug = DEBUG;
    autoPiPEnabled = e.detail.autoPiPEnabled;
    ytLogoMiniplayerEnabled = e.detail.ytLogoMiniplayerEnabled ?? false;
    if (autoPiPEnabled) {
        applyToAllVideos();
    }
});
