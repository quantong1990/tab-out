/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for Tab Out.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

const SETTINGS_KEY = 'tabOutSettings';
const DASHBOARD_TABS_SESSION_KEY = 'tabOutDashboardTabs';

const DEFAULT_SETTINGS = {
  language: 'en',
  replaceChromeNewTab: false,
};

const dashboardTabsById = new Map();
const suppressedNativeNewTabs = new Set();
const nativeNewTabRedirectsInFlight = new Set();
const intentionalDashboardClosures = new Set();
let dashboardOpenQueue = Promise.resolve();
let dashboardTrackingQueue = Promise.resolve();
let dashboardTrackingReady;

function getDashboardUrl() {
  return chrome.runtime.getURL('index.html');
}

async function getDashboardTabs() {
  const dashboardUrl = getDashboardUrl();
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => tab.url === dashboardUrl || tab.pendingUrl === dashboardUrl);
}

function isDashboardTab(tab) {
  const dashboardUrl = getDashboardUrl();
  return tab?.url === dashboardUrl || tab?.pendingUrl === dashboardUrl;
}

async function persistDashboardTabTracking() {
  const entries = Object.fromEntries(dashboardTabsById);
  await chrome.storage.session.set({ [DASHBOARD_TABS_SESSION_KEY]: entries });
}

async function hydrateDashboardTabTracking() {
  try {
    const stored = await chrome.storage.session.get(DASHBOARD_TABS_SESSION_KEY);
    const entries = stored[DASHBOARD_TABS_SESSION_KEY] || {};
    Object.entries(entries).forEach(([tabId, windowId]) => {
      dashboardTabsById.set(Number(tabId), windowId);
    });

    const currentDashboards = await getDashboardTabs();
    currentDashboards.forEach(tab => dashboardTabsById.set(tab.id, tab.windowId));
    await persistDashboardTabTracking();
  } catch (err) {
    console.warn('[Tab Out] Failed to restore dashboard tracking:', err);
  }
}

function trackDashboardTab(tab) {
  if (!tab?.id) return Promise.resolve();

  dashboardTrackingQueue = dashboardTrackingQueue
    .then(() => dashboardTrackingReady)
    .then(async () => {
      if (isDashboardTab(tab)) {
        dashboardTabsById.set(tab.id, tab.windowId);
      } else {
        dashboardTabsById.delete(tab.id);
      }
      await persistDashboardTabTracking();
    })
    .catch(err => {
      console.warn('[Tab Out] Failed to track dashboard tab:', err);
    });

  return dashboardTrackingQueue;
}

async function refreshDashboard(tabId) {
  try {
    await chrome.runtime.sendMessage({ type: 'TAB_OUT_REFRESH_TABS' });
  } catch {
    // The dashboard may still be loading. Reloading gives it a fresh tab query
    // without depending on the page message listener being ready.
    try {
      await chrome.tabs.reload(tabId);
    } catch {}
  }
}

async function focusDashboard(tab, { refresh = true } = {}) {
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, { active: true, pinned: false });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  if (refresh) await refreshDashboard(tab.id);
}

async function findExistingDashboard(excludeTabId = null) {
  const dashboardTabs = await getDashboardTabs();
  return dashboardTabs.find(tab => tab.id !== excludeTabId) || null;
}

function suppressNativeNewTab(tabId) {
  if (!tabId) return;

  suppressedNativeNewTabs.add(tabId);
  setTimeout(() => {
    suppressedNativeNewTabs.delete(tabId);
  }, 3000);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function closeTransientTabOrWindow(tab) {
  if (!tab?.id || !tab.windowId) return;

  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
  if (windowTabs.length <= 1) {
    await chrome.windows.remove(tab.windowId);
    return;
  }

  await chrome.tabs.remove(tab.id);
}

async function handleTabRemoved(tabId, removeInfo) {
  await dashboardTrackingReady;
  await dashboardTrackingQueue;

  const wasDashboard = dashboardTabsById.delete(tabId);
  const wasIntentional = intentionalDashboardClosures.delete(tabId);
  if (wasDashboard) await persistDashboardTabTracking();
  updateBadge();

  if (!wasDashboard || wasIntentional || removeInfo.isWindowClosing) return;

  // Chrome may create a native replacement tab after its last tab is closed.
  // Give that event time to settle, then exempt only that specific tab.
  await delay(50);
  try {
    const windowTabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
    if (windowTabs.length !== 1) return;

    const replacement = windowTabs[0];
    const replacementUrl = replacement.pendingUrl || replacement.url || '';
    if (isNativeNewTabUrl(replacementUrl)) suppressNativeNewTab(replacement.id);
  } catch {
    // The browser window was closed along with its final tab.
  }
}

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * openDashboard()
 *
 * Opens Tab Out from the toolbar icon or keyboard shortcut.
 * This always opens the dashboard, regardless of the user's new-tab setting.
 */
async function openDashboard() {
  try {
    const existing = await findExistingDashboard();
    if (existing) {
      await focusDashboard(existing);
      return;
    }

    await chrome.tabs.create({ url: getDashboardUrl(), active: true, pinned: false });
  } catch (err) {
    console.error('[Tab Out] Failed to open dashboard:', err);
  }
}

async function getSettings() {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  } catch (err) {
    console.warn('[Tab Out] Failed to load settings:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

function isNativeNewTabUrl(url = '') {
  return (
    url === 'chrome://newtab/' ||
    url.startsWith('chrome-search://local-ntp/') ||
    url.startsWith('chrome://new-tab-page/')
  );
}

async function redirectNewTabIfEnabled(tab) {
  if (!tab?.id || nativeNewTabRedirectsInFlight.has(tab.id)) return;

  nativeNewTabRedirectsInFlight.add(tab.id);
  try {
    const settings = await getSettings();
    if (!settings.replaceChromeNewTab) return;

    // onRemoved may identify this as Chrome's replacement for a manually
    // closed final dashboard tab. Waiting avoids racing that determination.
    await delay(200);

    const currentTab = await chrome.tabs.get(tab.id);
    const tabUrl = currentTab.pendingUrl || currentTab.url || '';
    if (!isNativeNewTabUrl(tabUrl)) return;
    if (suppressedNativeNewTabs.delete(currentTab.id)) return;

    const existing = await findExistingDashboard(currentTab.id);
    if (existing) {
      await focusDashboard(existing);
      await closeTransientTabOrWindow(currentTab);
      return;
    }

    await chrome.tabs.update(currentTab.id, { url: getDashboardUrl(), pinned: false });
  } catch (err) {
    if (!String(err?.message || err).includes('No tab with id')) {
      console.warn('[Tab Out] Failed to redirect new tab:', err);
    }
  } finally {
    nativeNewTabRedirectsInFlight.delete(tab.id);
  }
}

async function handleDashboardOpened(tabId) {
  if (!tabId) return;

  const existing = await findExistingDashboard(tabId);
  if (!existing) return;

  await focusDashboard(existing);
  const duplicate = await chrome.tabs.get(tabId);
  intentionalDashboardClosures.add(tabId);
  await closeTransientTabOrWindow(duplicate);
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener((tab) => {
  trackDashboardTab(tab);
  updateBadge();
  redirectNewTabIfEnabled(tab);
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleTabRemoved(tabId, removeInfo).catch(err => {
    console.warn('[Tab Out] Failed to handle removed tab:', err);
  });
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  trackDashboardTab(tab);
  updateBadge();
  if (changeInfo.url) {
    redirectNewTabIfEnabled({ ...tab, id: tabId, url: changeInfo.url });
  }
});

// Open the dashboard when the user clicks the extension toolbar icon
chrome.action.onClicked.addListener(() => {
  openDashboard();
});

// Also handle keyboard shortcut
chrome.commands.onCommand.addListener(() => {
  console.log('[Tab Out] Keyboard shortcut triggered');
  openDashboard();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'TAB_OUT_DASHBOARD_READY') return false;

  const tabId = sender.tab?.id || message.tabId;
  dashboardOpenQueue = dashboardOpenQueue
    .then(() => handleDashboardOpened(tabId))
    .catch(err => {
      console.warn('[Tab Out] Failed to focus existing dashboard:', err);
    });
  return false;
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
dashboardTrackingReady = hydrateDashboardTabTracking();
updateBadge();
