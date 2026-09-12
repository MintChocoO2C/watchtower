# Watchtower

> A Safari Web Extension for smoother YouTube, Chzzk, and livestream viewing.

Watchtower bundles a **Situation Room** for watching several Chzzk channels on one screen, plus small quality-of-life features for watching videos on Safari.

[한국어 README](README.ko.md)

## Features

- **Situation Room** — Click the toolbar icon to watch up to 16 Chzzk channels in one grid. Pick channels from your follows, click a tile to choose which one plays sound. Streams going offline or coming back are reflected automatically.
- **Auto Picture-in-Picture** — Automatically enters PiP when you switch tabs while a video is playing, and restores inline playback when you return.
- **YouTube Miniplayer** — Click the YouTube logo on a `/watch` page to switch to the miniplayer; click the miniplayer again to return to the full player.
- **Hide YouTube Shorts** — Removes the Shorts section from the home feed and the Shorts entry from the sidebar.
- **Video Frame Capture** — Right-click any `<video>` element to copy or download the current frame as a PNG.
- **Press to Fast-Forward** — Press and hold on a video to play at 2× speed; release to restore the original speed. (Works on any `<video>`, e.g. Chzzk VOD. YouTube is excluded since it has this built in.)

## Installation

Build from source (no App Store release yet).

**Requirements**: macOS 10.14+, Xcode 15+

1. `git clone https://github.com/MintChocoO2C/watchtower.git`
2. (Optional) Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig` and fill in your Team ID — this file is git-ignored. If you skip it, pick a team under Signing & Capabilities in Xcode.
3. Open `watchtower.xcodeproj` in Xcode
4. Build and run (⌘R) — this launches the host app once
5. In Safari → Settings → Extensions → enable **Watchtower**

macOS only (iOS is not supported).

If macOS blocks the unsigned extension, see Apple's docs on [running unsigned Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari_web_extensions/running_your_safari_web_extension).

## Usage

Click the ⚡ toolbar icon to open the **Situation Room**. Feature toggles live behind the gear (Settings) in the room's top-right corner.

### Situation Room

Watch several Chzzk channels on one screen without switching tabs.

- **Add channels**: `＋ Add from follows` (live channels first; requires a Chzzk login) or `Add by URL` (paste a live/channel URL or a channel ID). Up to 16.
- **Grid**: 1–4 columns chosen automatically from the channel count, tiles stay 16:9, and the page scrolls vertically when it overflows.
- **Sound**: only one channel plays sound. Press the `Muted` button at a tile's bottom-right to move sound there; the rest are muted. Safari only allows unmuting on a click.
- **Live status**: checked every minute; offline channels show `Offline` and reload automatically when they come back.
- The channel list and sound choice are saved and restored next time.

The room lives at `chzzk.naver.com/wt-room`. Each live is embedded as a same-origin iframe inside the Chzzk domain, so your login carries over.

### Press to Fast-Forward

Toggle **Press to Fast-Forward** ON in the popup. Press and **hold** the left mouse button on a video to play at 2× speed; release to restore the original speed. Fast-forward only starts after a short hold, so it doesn't conflict with a quick click (play/pause) or a timeline drag (seek), and it never triggers on menus, buttons, or the progress bar overlaid on the video. YouTube has the same feature built into its player (hold to play at 2×), so the extension stays out of the way there.

## Tech Stack

- **Swift** — host app + extension entry point (`SafariWebExtensionHandler`)
- **JavaScript** — `manifest_version: 3` web extension (background, wt-core, content, speed, room, page-script)
- **Xcode** — build and packaging

The extension uses three execution contexts:
- A service worker (`background.js`) — owns the toolbar action (opens the room), context menus, and storage relay
- Isolated content scripts (`wt-core.js` → `content.js` → `speed.js`; on the room path, `wt-core.js` → `room.js`) — DOM-aware; cannot access page globals. `wt-core.js` loads first and exposes shared services (`window.WT`: logging, settings subscription) that the other features build on
- A MAIN-world script (`page-script.js`) — runs in the page's JS context for APIs the page exposes

Storage changes are relayed by the background script because Safari's `storage.onChanged` is unreliable inside content scripts.

## License

[MIT](LICENSE) © 2026 MintChocoO2C

## Acknowledgments

- Built on Apple's Safari Web Extension App Xcode template.
