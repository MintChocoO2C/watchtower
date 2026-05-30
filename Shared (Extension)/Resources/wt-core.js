// Watchtower 공용 기반 (격리 세계) — content_scripts 배열에서 가장 먼저 로드된다.
// 같은 격리 세계 전역(window)을 공유하므로, 이후의 기능 모듈들이 window.WT 를 통해
// 로깅·설정구독·탭 서비스를 공용으로 사용한다. (번들러 없이 역할을 분리하는 방식)
//
// 제공 서비스
//   WT.log(tag, ...args)   debugEnabled가 켜졌을 때만 "[WT][tag]" 로 출력
//   WT.load(keys)          storage.local.get 래퍼 (Promise)
//   WT.watch(keys, cb)     해당 키가 바뀌면 cb(changes) 호출 (storageChanged relay 구독)
//   WT.tabs.op(op)         탭 조작을 background로 위임 ("wt:tabs")
//   WT.tabs.openTab(url)   배경 새 탭으로 URL 열기 ("wt:openTab")

(() => {
    "use strict";

    const WT = window.WT || (window.WT = {});

    // --- 디버그 로깅 (debugEnabled 중앙 관리) ---
    WT.debug = false;
    WT.log = (tag, ...args) => { if (WT.debug) console.log(`[WT][${tag}]`, ...args); };

    // --- 설정 ---
    WT.load = (keys) => browser.storage.local.get(keys);

    const watchers = [];   // { keys:Set<string>, cb:(changes)=>void }
    WT.watch = (keys, cb) => { watchers.push({ keys: new Set(keys), cb }); };

    // storageChanged relay를 한 곳에서 수신해 구독자에게 팬아웃.
    // (Safari는 content script의 storage.onChanged가 불안정 → background가 relay)
    browser.runtime.onMessage.addListener((req) => {
        if (req.action !== "storageChanged" || !req.changes) return;
        if (req.changes.debugEnabled) WT.debug = req.changes.debugEnabled.newValue ?? false;
        const changedKeys = Object.keys(req.changes);
        for (const w of watchers) {
            if (changedKeys.some(k => w.keys.has(k))) w.cb(req.changes);
        }
    });

    // 초기 debug 상태 로드
    browser.storage.local.get("debugEnabled")
        .then(r => { WT.debug = r.debugEnabled ?? false; })
        .catch(() => {});

    // --- 탭 서비스 (중립 메시지로 background에 위임) ---
    WT.tabs = {
        op: (op) => browser.runtime.sendMessage({ action: "wt:tabs", op }).catch(() => {}),
        openTab: (url) => browser.runtime.sendMessage({ action: "wt:openTab", url }).catch(() => {}),
    };
})();
