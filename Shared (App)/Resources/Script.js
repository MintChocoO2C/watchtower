const i18n = {
    en: {
        ios: "You can turn on watchtower's Safari extension in Settings.",
        macUnknownPrefs: "You can turn on watchtower's extension in Safari Extensions preferences.",
        macOnPrefs: "watchtower's extension is currently on. You can turn it off in Safari Extensions preferences.",
        macOffPrefs: "watchtower's extension is currently off. You can turn it on in Safari Extensions preferences.",
        openPrefsBtn: "Quit and Open Safari Extensions Preferences\u2026",
        macUnknownSettings: "You can turn on watchtower's extension in the Extensions section of Safari Settings.",
        macOnSettings: "watchtower's extension is currently on. You can turn it off in the Extensions section of Safari Settings.",
        macOffSettings: "watchtower's extension is currently off. You can turn it on in the Extensions section of Safari Settings.",
        openSettingsBtn: "Quit and Open Safari Settings\u2026"
    },
    ko: {
        ios: "설정에서 watchtower Safari 확장 프로그램을 켤 수 있습니다.",
        macUnknownPrefs: "Safari 환경설정의 확장 프로그램 섹션에서 watchtower를 켤 수 있습니다.",
        macOnPrefs: "watchtower 확장 프로그램이 현재 켜져 있습니다. Safari 환경설정의 확장 프로그램 섹션에서 끌 수 있습니다.",
        macOffPrefs: "watchtower 확장 프로그램이 현재 꺼져 있습니다. Safari 환경설정의 확장 프로그램 섹션에서 켤 수 있습니다.",
        openPrefsBtn: "종료 후 Safari 환경설정 열기\u2026",
        macUnknownSettings: "Safari 설정의 확장 프로그램 섹션에서 watchtower를 켤 수 있습니다.",
        macOnSettings: "watchtower 확장 프로그램이 현재 켜져 있습니다. Safari 설정의 확장 프로그램 섹션에서 끌 수 있습니다.",
        macOffSettings: "watchtower 확장 프로그램이 현재 꺼져 있습니다. Safari 설정의 확장 프로그램 섹션에서 켤 수 있습니다.",
        openSettingsBtn: "종료 후 Safari 설정 열기\u2026"
    }
};

function getLang() {
    return (navigator.language || "en").startsWith("ko") ? "ko" : "en";
}

function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);
    const t = i18n[getLang()];

    if (platform === "ios") {
        document.querySelector(".platform-ios").innerText = t.ios;
    } else if (platform === "mac") {
        if (useSettingsInsteadOfPreferences) {
            document.getElementsByClassName("platform-mac state-unknown")[0].innerText = t.macUnknownSettings;
            document.getElementsByClassName("platform-mac state-on")[0].innerText = t.macOnSettings;
            document.getElementsByClassName("platform-mac state-off")[0].innerText = t.macOffSettings;
            document.getElementsByClassName("platform-mac open-preferences")[0].innerText = t.openSettingsBtn;
        } else {
            document.getElementsByClassName("platform-mac state-unknown")[0].innerText = t.macUnknownPrefs;
            document.getElementsByClassName("platform-mac state-on")[0].innerText = t.macOnPrefs;
            document.getElementsByClassName("platform-mac state-off")[0].innerText = t.macOffPrefs;
            document.getElementsByClassName("platform-mac open-preferences")[0].innerText = t.openPrefsBtn;
        }
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
