// Background - popup에서 content script로 메시지 전달

browser.runtime.onMessage.addListener((request, sender) => {
    if (request.target === "content") {
        return browser.tabs.query({ active: true, currentWindow: true })
            .then(tabs => {
                if (tabs.length === 0) {
                    return { success: false, error: "no_active_tab" };
                }
                return browser.tabs.sendMessage(tabs[0].id, request);
            });
    }

    // Vimium: 새 탭에서 URL 열기 (F 명령용 — content script는 tabs.create 직접 호출 불가)
    if (request.action === "vimium:openTab" && request.url) {
        return browser.tabs.create({ url: request.url, active: false });
    }

    // Vimium: 탭 조작 (J/K/t/x/X/gt/gT)
    if (request.action === "vimium:tabs") {
        return handleVimiumTabOp(request.op, sender);
    }
});

async function handleVimiumTabOp(op, sender) {
    try {
        if (op === "next" || op === "prev") {
            const tabs = await browser.tabs.query({ currentWindow: true });
            if (tabs.length < 2) return;
            const active = tabs.findIndex(t => t.active);
            if (active < 0) return;
            const target = op === "next"
                ? (active + 1) % tabs.length
                : (active - 1 + tabs.length) % tabs.length;
            await browser.tabs.update(tabs[target].id, { active: true });
        } else if (op === "new") {
            await browser.tabs.create({});
        } else if (op === "close") {
            if (sender?.tab?.id != null) {
                await browser.tabs.remove(sender.tab.id);
            }
        } else if (op === "restore") {
            if (browser.sessions?.restore) {
                await browser.sessions.restore();
            } else {
                console.warn("[WT] browser.sessions.restore unavailable in this Safari version");
            }
        }
    } catch (e) {
        console.error("[WT] vimium:tabs error:", op, e?.name, e?.message);
    }
}

// storage 변경 → 활성 탭의 content script로 relay
// (Safari에서 content script의 storage.onChanged가 신뢰성 없음)
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        for (const tab of tabs) {
            browser.tabs.sendMessage(tab.id, { action: "storageChanged", changes }).catch(() => {});
        }
    });
});

// --- 동영상 프레임: Safari 우클릭 메뉴에 항목 2개 추가 ---
browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "wt-copy-video-frame",
        title: browser.i18n.getMessage("copyVideoFrame"),
        contexts: ["video"]
    });
    browser.contextMenus.create({
        id: "wt-download-video-frame",
        title: browser.i18n.getMessage("downloadVideoFrame"),
        contexts: ["video"]
    });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === "wt-copy-video-frame") {
        // scripting.executeScript + world:"MAIN" 으로 사용자 제스처를 유지하며 클립보드 접근
        browser.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
                const dbg = (...a) => { if (window._wtDebug) console.log("[WT]", ...a); };

                const video = window._lastRightClickedVideo;
                dbg("executeScript 진입, video:", video ? "found" : "null");
                if (!video) return;

                const w = video.videoWidth || video.offsetWidth;
                const h = video.videoHeight || video.offsetHeight;
                dbg("캔버스 크기:", w, "x", h);
                if (!w || !h) return;

                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                try {
                    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
                } catch (e) {
                    console.error("[WT] drawImage 실패:", e.name, e.message);
                    return;
                }

                const ko = navigator.language?.startsWith("ko");
                const toast = (msg, err) => {
                    if (typeof _wtShowFrameToast === "function") _wtShowFrameToast(msg, err);
                };

                let dataUrl;
                try {
                    dataUrl = canvas.toDataURL("image/png");
                } catch (e) {
                    const msg = e?.name === "SecurityError"
                        ? (ko ? "보안 정책으로 캡처가 제한됩니다" : "Capture blocked by security policy")
                        : (ko ? "캡처에 실패했습니다" : "Capture failed");
                    toast(msg, true);
                    return;
                }

                const parts = dataUrl.split(",");
                const binary = atob(parts[1]);
                const arr = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
                const blob = new Blob([arr], { type: "image/png" });
                dbg("clipboard.write 시도, blob size:", blob.size);
                navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
                    .then(() => {
                        dbg("clipboard.write 성공");
                        toast(ko ? "클립보드에 복사됐습니다" : "Copied to clipboard");
                    })
                    .catch(e => {
                        console.error("[WT] clipboard.write 실패:", e.name, e.message);
                        toast(ko ? "클립보드 복사에 실패했습니다" : "Clipboard copy failed", true);
                    });
            }
        }).catch(e => console.error("[WT background] executeScript 오류:", e.name, e.message));
    } else if (info.menuItemId === "wt-download-video-frame") {
        // content.js 경유 없이 MAIN world에 직접 이벤트 발생 → 간헐적 sendMessage 실패 방지
        browser.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
                document.dispatchEvent(new CustomEvent("watchtower-download-frame"));
            }
        }).catch(e => console.error("[WT background] download executeScript 오류:", e.name, e.message));
    }
});
