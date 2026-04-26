// Watchtower Content Script (격리된 세계)
// 역할: 확장 프로그램 API ↔ 페이지 스크립트 다리

// --- 설정을 페이지 스크립트(메인 세계)로 전달 ---
function sendSettingsToPage(settings) {
    document.dispatchEvent(new CustomEvent("watchtower-settings", {
        detail: settings
    }));
}

function loadAndSendSettings() {
    browser.storage.local.get(["autoPiPEnabled", "ytLogoMiniplayerEnabled", "ytHideShortsEnabled", "debugEnabled"]).then((result) => {
        sendSettingsToPage({
            autoPiPEnabled: result.autoPiPEnabled ?? false,
            ytLogoMiniplayerEnabled: result.ytLogoMiniplayerEnabled ?? false,
            debugEnabled: result.debugEnabled ?? false
        });
        applyHideShorts(result.ytHideShortsEnabled ?? false);
    }).catch(() => {});
}

// --- YouTube: Shorts 숨기기 ---
let shortsNavObserver = null;

function isShortsNavEntry(entry) {
    // 1. Light DOM 링크 확인
    const lightLink = entry.querySelector("a");
    if (lightLink?.href) {
        try {
            if (new URL(lightLink.href).pathname.replace(/\/$/, "") === "/shorts") return true;
        } catch {}
    }
    // 2. Shadow DOM 링크 확인
    const shadowLink = entry.shadowRoot?.querySelector("a");
    if (shadowLink?.href) {
        try {
            if (new URL(shadowLink.href).pathname.replace(/\/$/, "") === "/shorts") return true;
        } catch {}
    }
    // 3. 텍스트 fallback ("Shorts"는 모든 로케일에서 동일한 브랜드명)
    const titleEl = entry.querySelector("yt-formatted-string")
                 || entry.shadowRoot?.querySelector("yt-formatted-string");
    if (titleEl?.textContent?.trim() === "Shorts") return true;

    return false;
}

function hideShortsNavItems() {
    document.querySelectorAll("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer").forEach(entry => {
        if (entry.dataset.wtShortsHidden) return;
        if (isShortsNavEntry(entry)) {
            entry.dataset.wtShortsHidden = "1";
            entry.style.setProperty("display", "none", "important");
        }
    });
}

function restoreShortsNavItems() {
    document.querySelectorAll("[data-wt-shorts-hidden]").forEach(el => {
        el.style.removeProperty("display");
        delete el.dataset.wtShortsHidden;
    });
}

function applyHideShorts(enabled) {
    const STYLE_ID = "wt-hide-shorts";
    if (enabled) {
        // CSS: 홈 피드 Shorts 섹션
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.textContent = [
                // 홈 피드 Shorts 섹션
                "ytd-rich-section-renderer:has(a[href^=\"/shorts\"])",
                "ytd-rich-section-renderer:has(ytd-reel-item-renderer)",
                "ytd-rich-shelf-renderer:has(ytd-reel-item-renderer)",
                "ytd-rich-shelf-renderer[is-reel-item-flow]",
                "ytd-reel-shelf-renderer"
            ].join(",") + " { display: none !important; }";
            (document.head || document.documentElement).appendChild(style);
        }
        // JS: 사이드바 Shorts 링크 (동적 로드 + 재시도)
        hideShortsNavItems();
        if (!shortsNavObserver) {
            shortsNavObserver = new MutationObserver(hideShortsNavItems);
            shortsNavObserver.observe(document.documentElement, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ["href"]
            });
        }
    } else {
        document.getElementById(STYLE_ID)?.remove();
        restoreShortsNavItems();
        shortsNavObserver?.disconnect();
        shortsNavObserver = null;
    }
}

// 저장된 설정 불러오기
loadAndSendSettings();

// --- 팝업 / background 메시지 응답 ---
browser.runtime.onMessage.addListener((request) => {
    if (request.action === "getStatus") {
        const videos = Array.from(document.querySelectorAll("video"));
        const playing = videos.filter(v => !v.paused && !v.ended);
        return Promise.resolve({
            videoCount: videos.length,
            playingCount: playing.length,
            pipActive: !!document.pictureInPictureElement
        });
    }

    if (request.action === "storageChanged") {
        const { changes } = request;
        if (changes.autoPiPEnabled || changes.ytLogoMiniplayerEnabled || changes.debugEnabled) {
            loadAndSendSettings();
        }
        if (changes.ytHideShortsEnabled) {
            applyHideShorts(changes.ytHideShortsEnabled.newValue ?? false);
        }
    }
});

