// Watchtower 공용 기반 (격리 세계) — content_scripts 배열에서 가장 먼저 로드된다.
// 같은 격리 세계 전역(window)을 공유하므로, 이후의 기능 모듈들이 window.WT 를 통해
// 로깅·설정구독을 공용으로 사용한다. (번들러 없이 역할을 분리하는 방식)
//
// 제공 서비스
//   WT.log(tag, ...args)   debugEnabled가 켜졌을 때만 "[WT][tag]" 로 출력
//   WT.load(keys)          storage.local.get 래퍼 (Promise)
//   WT.watch(keys, cb)     해당 키가 바뀌면 cb(changes) 호출 (storageChanged relay 구독)
//   WT.notify(changes)     자기 탭에서 바꾼 설정을 같은 탭의 구독자에게 즉시 전달 (relay 가 자기 탭엔 안 올 수 있음)

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
    const fanout = (changes) => {
        if (changes.debugEnabled) WT.debug = changes.debugEnabled.newValue ?? false;
        const changedKeys = Object.keys(changes);
        for (const w of watchers) {
            if (changedKeys.some(k => w.keys.has(k))) w.cb(changes);
        }
    };
    browser.runtime.onMessage.addListener((req) => {
        if (req.action !== "storageChanged" || !req.changes) return;
        fanout(req.changes);
    });
    // 자기 탭에서 바꾼 설정을 같은 탭의 구독자에게 바로 알린다.
    // relay 는 자기 탭으로 돌아오지 않을 수 있어(상황실 탭에서 광고 건너뛰기를 꺼도 그 탭에선 계속 동작하던 버그),
    // 설정을 쓰는 쪽이 set 뒤에 호출한다. relay 가 뒤늦게 와도 구독자 처리는 멱등이라 문제없다.
    WT.notify = (changes) => fanout(changes);

    // 초기 debug 상태 로드
    browser.storage.local.get("debugEnabled")
        .then(r => { WT.debug = r.debugEnabled ?? false; })
        .catch(() => {});
})();
