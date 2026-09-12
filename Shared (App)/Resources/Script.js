// 호스트 앱 안내 화면 (macOS 전용) — 확장 활성 상태에 맞는 문구를 표시한다.
const i18n = {
    en: {
        unknownPrefs: "You can turn on watchtower's extension in Safari Extensions preferences.",
        onPrefs: "watchtower's extension is currently on. You can turn it off in Safari Extensions preferences.",
        offPrefs: "watchtower's extension is currently off. You can turn it on in Safari Extensions preferences.",
        openPrefsBtn: "Quit and Open Safari Extensions Preferences…",
        unknownSettings: "You can turn on watchtower's extension in the Extensions section of Safari Settings.",
        onSettings: "watchtower's extension is currently on. You can turn it off in the Extensions section of Safari Settings.",
        offSettings: "watchtower's extension is currently off. You can turn it on in the Extensions section of Safari Settings.",
        openSettingsBtn: "Quit and Open Safari Settings…"
    },
    ko: {
        unknownPrefs: "Safari 환경설정의 확장 프로그램 섹션에서 watchtower를 켤 수 있습니다.",
        onPrefs: "watchtower 확장 프로그램이 현재 켜져 있습니다. Safari 환경설정의 확장 프로그램 섹션에서 끌 수 있습니다.",
        offPrefs: "watchtower 확장 프로그램이 현재 꺼져 있습니다. Safari 환경설정의 확장 프로그램 섹션에서 켤 수 있습니다.",
        openPrefsBtn: "종료 후 Safari 환경설정 열기…",
        unknownSettings: "Safari 설정의 확장 프로그램 섹션에서 watchtower를 켤 수 있습니다.",
        onSettings: "watchtower 확장 프로그램이 현재 켜져 있습니다. Safari 설정의 확장 프로그램 섹션에서 끌 수 있습니다.",
        offSettings: "watchtower 확장 프로그램이 현재 꺼져 있습니다. Safari 설정의 확장 프로그램 섹션에서 켤 수 있습니다.",
        openSettingsBtn: "종료 후 Safari 설정 열기…"
    }
};

function getLang() {
    return (navigator.language || "en").startsWith("ko") ? "ko" : "en";
}

// enabled: 확장 활성 여부(불명이면 undefined), useSettings: macOS 13+ 는 "설정", 이전은 "환경설정"
function show(enabled, useSettings) {
    const t = i18n[getLang()];
    const s = useSettings ? "Settings" : "Prefs";
    document.querySelector(".state-unknown").innerText = t["unknown" + s];
    document.querySelector(".state-on").innerText = t["on" + s];
    document.querySelector(".state-off").innerText = t["off" + s];
    document.querySelector(".open-preferences").innerText = t[useSettings ? "openSettingsBtn" : "openPrefsBtn"];

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on", "state-off");
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
