# Save for Later Tab Actions

Date: 2026-05-15

## Summary

This update improves the open-tabs dashboard actions so saving tabs for later also cleans up the active browser session. It also clarifies the open-tabs header by moving tab counts out of destructive action labels.

## User-Facing Changes

- Clicking a tab chip's save button now saves that tab to the "Saved for later" list and closes the Chrome tab.
- Clicking a domain card's save button now saves all tabs in that domain group and closes those Chrome tabs.
- The open-tabs header now shows domain and tab counts separately:
  - Chinese: `n 个域名 · x 个标签页`
  - English: `n domains · x tabs`
- The global close button text no longer includes the tab count:
  - Chinese: `关闭全部标签页`
  - English: `Close all tabs`
- The open-tabs header now includes a global save action:
  - Chinese: `全部添加到稍后查看`
  - English: `Add all to saved for later`
- Duplicate cleanup on a domain card now uses a shorter label and icon:
  - Chinese: `去重标签(x)`
  - English: `Deduplicate tabs (x)`
- The duplicate cleanup button now uses its own slate color treatment while matching the shape, spacing, and icon style of the other card action buttons.

## Implementation Notes

- Added tab-closing helpers in `extension/app.js`:
  - `closeTabByIdOrUrl(tabId, url)` closes a single tab by `tab.id` first, with URL matching as a fallback.
  - `closeTabsByIds(tabs)` closes a list of tabs by their Chrome tab ids.
- Tab chip action buttons now carry `data-tab-id` in addition to `data-tab-url`, which makes closing more reliable across duplicate URLs and multiple windows.
- The global "add all to saved for later" action uses `getRealTabs()` so Chrome internal pages, extension pages, and `about:` pages are excluded.
- The duplicate badge cleanup recognizes both English and Chinese duplicate labels after deduplication.
- Header action button sizing moved from inline styles into `.section-action-btn`.
- Added `.dedup-tabs` styling for the duplicate cleanup action.

## Validation

Syntax checks passed:

```bash
node --check extension/app.js
node --check extension/background.js
```

Manual validation after loading the unpacked extension:

1. Reload Tab Out from `chrome://extensions`.
2. Open several normal web tabs across at least two domains.
3. Click a single tab chip's save button and confirm the tab appears under "Saved for later" and closes in Chrome.
4. Click a domain card's save button and confirm that group is saved and closed.
5. Click the header's global save button and confirm all real web tabs are saved and closed.
6. Open duplicate URLs and confirm the domain card shows `去重标签(x)` / `Deduplicate tabs (x)` with the slate icon button styling.
