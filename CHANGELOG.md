# Changelog

## 1.0.3 - 2026-06-18

### Fixed

- Persist dashboard-tab tracking across background service worker restarts for more reliable duplicate detection.
- Prevent new-tab replacement from immediately reopening Tab Out after the final dashboard tab is closed manually.
- Serialize simultaneous dashboard openings so only one dashboard remains active.
- Close transient duplicate-dashboard windows cleanly when they contain no other tabs.

## 1.0.2 - 2026-06-18

### Fixed

- Keep newly opened Chrome tabs in their original window when new-tab replacement is enabled.
- Avoid closing a dashboard tab when doing so would leave its Chrome window empty.
- Protect browser-internal pages such as `chrome://`, `edge://`, `brave://`, and `about:` from bulk, duplicate, and fallback close actions.
- Improve keyboard and screen-reader behavior for the settings panel and shortcut dialogs by keeping hidden controls inert and out of the focus order.
