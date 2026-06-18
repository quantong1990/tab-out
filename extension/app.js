/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

const SETTINGS_KEY = 'tabOutSettings';
const SHORTCUTS_KEY = 'searchShortcuts';
const SHORTCUT_ICON_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  language: 'en',
  colorScheme: 'warm',
  contentWidth: 'medium',
  replaceChromeNewTab: false,
};

const DEFAULT_SHORTCUTS = [
  { name: 'Gmail', url: 'https://mail.google.com/' },
  { name: 'GitHub', url: 'https://github.com/' },
  { name: 'YouTube', url: 'https://www.youtube.com/' },
  { name: 'X', url: 'https://x.com/home' },
];

let appSettings = { ...DEFAULT_SETTINGS };
let draftSettings = { ...DEFAULT_SETTINGS };
let searchShortcutGroups = [];
let activeShortcutDrag = null;
let suppressShortcutClick = false;
let shortcutIconRefreshInFlight = null;
let headerClockTimer = null;
let dashboardRefreshInFlight = null;

const I18N = {
  en: {
    settings: 'Settings',
    settingsSubtitle: 'Make Tab Out fit the way you browse.',
    languageTitle: 'Language',
    languageDesc: 'Choose a language, then save to apply it.',
    colorSchemeTitle: 'Color style',
    colorSchemeDesc: 'Switch the dashboard palette with one click.',
    themeWarm: 'Warm',
    themeForest: 'Forest',
    themeCoast: 'Coast',
    themeDusk: 'Dusk',
    themeDopamine: 'Dopamine',
    contentWidthTitle: 'Content width',
    contentWidthDesc: 'Choose how much of the page the dashboard should use.',
    contentWidthWide: 'Wide',
    contentWidthWideDesc: 'Use more page width for denser tab grids.',
    contentWidthMedium: 'Medium',
    contentWidthMediumDesc: 'Balanced width for everyday browsing.',
    contentWidthNarrow: 'Narrow',
    contentWidthNarrowDesc: 'Keep the dashboard focused and compact.',
    newTabTitle: 'New Tab',
    newTabDesc: 'Choose what Chrome opens when you create a new tab.',
    replaceChromeNewTab: "Replace Chrome's new tab page with Tab Out",
    replaceChromeNewTabDesc: "When off, Tab Out leaves Chrome's new tab page and other new-tab extensions alone.",
    shortcutTitle: 'Shortcut',
    shortcutDesc: 'Use this keyboard shortcut to open Tab Out from anywhere in Chrome.',
    refreshShortcutIcons: 'Update shortcut icons',
    shortcutIconsRefreshed: (checked, updated) => `Shortcut icons checked: ${checked} checked, ${updated} updated`,
    shortcutIconsRefreshFailed: 'Could not update shortcut icons',
    dupePrefix: 'You have',
    dupeSuffix: 'Tab Out tabs open. Keep just this one?',
    closeExtras: 'Close extras',
    savedForLater: 'Saved for later',
    nothingSaved: 'Nothing saved. Living in the moment.',
    archive: 'Archive',
    searchArchived: 'Search archived tabs...',
    openTabsStat: 'Open tabs',
    openTabsTitle: 'Open tabs',
    refreshTabs: 'Refresh',
    searchPlaceholder: 'Search the web',
    searchGoogle: 'Search Google',
    searchBaidu: 'Search Baidu',
    addShortcut: 'Add',
    addShortcutGroup: 'Add group',
    editShortcutGroup: 'Edit group',
    shortcutGroupMenu: 'Group actions',
    deleteShortcutGroup: 'Delete group',
    defaultShortcutGroupName: 'Shortcuts',
    shortcutGroupNamePrompt: 'Group name',
    shortcutGroupModalTitle: 'Shortcut group',
    shortcutGroupNameLabel: 'Group name',
    shortcutGroupAdded: 'Shortcut group added',
    shortcutGroupSaved: 'Shortcut group saved',
    shortcutGroupDeleted: 'Shortcut group deleted',
    shortcutGroupRenamed: 'Shortcut group renamed',
    confirmDeleteShortcutGroup: name => `Delete the "${name}" shortcut group and every shortcut in it?`,
    shortcutModalTitle: 'Shortcut',
    shortcutNameLabel: 'Name',
    shortcutUrlLabel: 'URL',
    shortcutNamePlaceholder: 'GitHub',
    shortcutUrlPlaceholder: 'https://github.com',
    deleteShortcut: 'Delete',
    shortcutSaved: 'Shortcut saved',
    shortcutDeleted: 'Shortcut deleted',
    shortcutNameUrlRequired: 'Name and URL are required',
    invalidShortcutUrl: 'Enter a valid URL',
    homepages: 'Homepages',
    domains: count => `${count} domain${count !== 1 ? 's' : ''}`,
    tabsOpen: count => `${count} tab${count !== 1 ? 's' : ''} open`,
    tabs: count => `${count} tab${count !== 1 ? 's' : ''}`,
    closeAllTabs: 'Close all tabs',
    duplicateBadge: count => `${count} duplicate${count !== 1 ? 's' : ''}`,
    closeDuplicates: count => `Deduplicate tabs (${count})`,
    closeAllCompact: count => `Close all (${count})`,
    saveAllForLaterCompact: count => `Save for later (${count})`,
    closeAllSavedCompact: 'Close all',
    openAllCompact: 'Open all',
    clearAllSavedTabs: 'Clear all tabs',
    confirmCloseAllOpenTabs: 'Close all open tabs?',
    confirmClearAllSavedTabs: 'Clear all saved tabs?',
    savedTabsCleared: 'Saved tabs cleared',
    deferAllForLater: 'Add all to saved for later',
    savedItems: count => `${count} item${count !== 1 ? 's' : ''}`,
    inboxZeroTitle: 'Inbox zero, but for tabs.',
    inboxZeroSubtitle: "You're free.",
    noResults: 'No results',
    goodMorning: 'Good morning',
    goodAfternoon: 'Good afternoon',
    goodEvening: 'Good evening',
    closedExtraTabs: 'Closed extra Tab Out tabs',
    tabClosed: 'Tab closed',
    closeThisTab: 'Close this tab',
    savedForLaterToast: 'Saved for later',
    savedTabsForLaterToast: count => `Saved ${count} tab${count !== 1 ? 's' : ''} for later`,
    failedToSave: 'Failed to save tab',
    closedFrom: (count, label) => `Closed ${count} tab${count !== 1 ? 's' : ''} from ${label}`,
    closedDuplicatesToast: 'Closed duplicates, kept one copy each',
    allTabsClosed: 'All tabs closed. Fresh start.',
    tabsRefreshed: 'Tabs refreshed',
    settingsSaved: 'Settings saved',
    saveSettings: 'Save',
    cancelSettings: 'Cancel',
  },
  zh: {
    settings: '设置',
    settingsSubtitle: '让 Tab Out 更符合你的浏览习惯。',
    languageTitle: '语言',
    languageDesc: '选择语言后，点击保存即可生效。',
    colorSchemeTitle: '配色风格',
    colorSchemeDesc: '点击图标即可切换页面配色。',
    themeWarm: '暖纸',
    themeForest: '森林',
    themeCoast: '海岸',
    themeDusk: '夜幕',
    themeDopamine: '多巴胺',
    contentWidthTitle: '内容宽度',
    contentWidthDesc: '选择仪表盘占用页面宽度的比例。',
    contentWidthWide: '宽',
    contentWidthWideDesc: '更多利用页面宽度，适合更密集的标签网格。',
    contentWidthMedium: '中',
    contentWidthMediumDesc: '日常浏览的平衡宽度。',
    contentWidthNarrow: '窄',
    contentWidthNarrowDesc: '让仪表盘更集中、更紧凑。',
    newTabTitle: '新标签页',
    newTabDesc: '选择 Chrome 新建标签页时打开什么。',
    replaceChromeNewTab: '替换 Chrome 新标签页为 Tab Out',
    replaceChromeNewTabDesc: '关闭时，Tab Out 不接管 Chrome 新标签页，也不影响其他新标签页扩展。',
    shortcutTitle: '快捷键',
    shortcutDesc: '在 Chrome 任意位置使用这个快捷键打开 Tab Out。',
    refreshShortcutIcons: '更新快捷方式图标',
    shortcutIconsRefreshed: (checked, updated) => `快捷方式图标已检查：${checked} 个检查，${updated} 个更新`,
    shortcutIconsRefreshFailed: '无法更新快捷方式图标',
    dupePrefix: '你打开了',
    dupeSuffix: '个 Tab Out 页面。只保留当前这个？',
    closeExtras: '关闭多余页面',
    savedForLater: '稍后查看',
    nothingSaved: '还没有保存内容。活在当下。',
    archive: '归档',
    searchArchived: '搜索归档标签...',
    openTabsStat: '打开的标签',
    openTabsTitle: '打开的标签',
    refreshTabs: '刷新',
    searchPlaceholder: '搜索网页',
    searchGoogle: 'Google 搜索',
    searchBaidu: '百度搜索',
    addShortcut: '添加',
    addShortcutGroup: '添加分组',
    editShortcutGroup: '编辑分组',
    shortcutGroupMenu: '分组操作',
    deleteShortcutGroup: '删除分组',
    defaultShortcutGroupName: '快捷方式',
    shortcutGroupNamePrompt: '分组名称',
    shortcutGroupModalTitle: '快捷方式分组',
    shortcutGroupNameLabel: '分组名称',
    shortcutGroupAdded: '快捷方式分组已添加',
    shortcutGroupSaved: '快捷方式分组已保存',
    shortcutGroupDeleted: '快捷方式分组已删除',
    shortcutGroupRenamed: '快捷方式分组已重命名',
    confirmDeleteShortcutGroup: name => `确定要删除「${name}」分组及其中所有快捷方式吗？`,
    shortcutModalTitle: '快捷方式',
    shortcutNameLabel: '名称',
    shortcutUrlLabel: '网址',
    shortcutNamePlaceholder: 'GitHub',
    shortcutUrlPlaceholder: 'https://github.com',
    deleteShortcut: '删除',
    shortcutSaved: '快捷方式已保存',
    shortcutDeleted: '快捷方式已删除',
    shortcutNameUrlRequired: '名称和网址不能为空',
    invalidShortcutUrl: '请输入有效网址',
    homepages: '主页',
    domains: count => `${count} 个域名`,
    tabsOpen: count => `${count} 个标签打开中`,
    tabs: count => `${count} 个标签页`,
    closeAllTabs: '关闭全部标签页',
    duplicateBadge: count => `${count} 个重复`,
    closeDuplicates: count => `去重标签(${count})`,
    closeAllCompact: count => `关闭全部(${count})`,
    saveAllForLaterCompact: count => `稍后查看(${count})`,
    closeAllSavedCompact: '全部关闭',
    openAllCompact: '全部打开',
    clearAllSavedTabs: '清除所有标签页',
    confirmCloseAllOpenTabs: '确定要关闭所有打开的标签页吗？',
    confirmClearAllSavedTabs: '确定要清除所有稍后查看的标签页吗？',
    savedTabsCleared: '已清除稍后查看标签页',
    deferAllForLater: '全部添加到稍后查看',
    savedItems: count => `${count} 项`,
    inboxZeroTitle: '标签页版 Inbox Zero。',
    inboxZeroSubtitle: '你自由了。',
    noResults: '没有结果',
    goodMorning: '早上好',
    goodAfternoon: '下午好',
    goodEvening: '晚上好',
    closedExtraTabs: '已关闭多余的 Tab Out 页面',
    tabClosed: '标签已关闭',
    closeThisTab: '关闭这个标签',
    savedForLaterToast: '已保存到稍后查看',
    savedTabsForLaterToast: count => `已保存 ${count} 个标签到稍后查看`,
    failedToSave: '保存失败',
    closedFrom: (count, label) => `已从 ${label} 关闭 ${count} 个标签`,
    closedDuplicatesToast: '已关闭重复标签，并保留一份',
    allTabsClosed: '所有标签已关闭。重新开始。',
    tabsRefreshed: '标签页已刷新',
    settingsSaved: '设置已保存',
    saveSettings: '保存',
    cancelSettings: '取消',
  },
};

const GREETING_PHRASES = {
  en: {
    lateNight: [
      'Still awake?',
      'Quiet hours, clear tabs.',
      'Late night focus mode.',
    ],
    dawn: [
      'Early start.',
      'Morning light, lighter tabs.',
      'Fresh day, fresh browser.',
    ],
    morning: [
      'Good morning',
      'Ready when you are.',
      'Let’s make the tabs behave.',
    ],
    noon: [
      'Good noon',
      'Midday reset.',
      'A small tab tidy would hit nicely.',
    ],
    afternoon: [
      'Good afternoon',
      'Afternoon focus.',
      'Your tabs are waiting politely.',
    ],
    evening: [
      'Good evening',
      'Evening cleanup window.',
      'Wind down the tab stack.',
    ],
    night: [
      'Good night',
      'Night mode for your brain.',
      'Close a few tabs, keep the good ones.',
    ],
  },
  zh: {
    lateNight: [
      '还没睡呀',
      '夜深了，标签也该安静一点。',
      '深夜专注模式。',
    ],
    dawn: [
      '早起的一天',
      '新的一天，先把标签理顺。',
      '清晨好，浏览器也醒了。',
    ],
    morning: [
      '早上好',
      '今天也从清爽的标签开始。',
      '早安，先把打开的东西看清楚。',
    ],
    noon: [
      '中午好',
      '午间重整一下。',
      '吃饭前后，都适合清一清标签。',
    ],
    afternoon: [
      '下午好',
      '下午继续专注。',
      '打开的标签正在排队等你。',
    ],
    evening: [
      '晚上好',
      '晚间整理时间。',
      '收一收标签，也收一收脑子。',
    ],
    night: [
      '夜里好',
      '夜晚适合留下真正重要的标签。',
      '该轻一点了，标签也是。',
    ],
  },
};

function t(key, ...args) {
  const lang = I18N[appSettings.language] ? appSettings.language : 'en';
  const value = I18N[lang][key] ?? I18N.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    appSettings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    draftSettings = { ...appSettings };
  } catch (err) {
    console.warn('[tab-out] Failed to load settings:', err);
    appSettings = { ...DEFAULT_SETTINGS };
    draftSettings = { ...appSettings };
  }
  return appSettings;
}

async function persistSettings(settings) {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } catch (err) {
    console.warn('[tab-out] Failed to save settings:', err);
  }
}

async function refreshLocalizedUI() {
  applyColorScheme();
  applyContentWidth();
  applyLanguage();
  updateSettingsControls();
  renderSearchShortcuts();
  await renderStaticDashboard();
  applyColorScheme();
  applyContentWidth();
  applyLanguage();
  updateSettingsControls();
  renderSearchShortcuts();
}

function applyLanguage() {
  document.documentElement.lang = appSettings.language === 'zh' ? 'zh-CN' : 'en';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
}

function getValidContentWidth(value) {
  return ['wide', 'medium', 'narrow'].includes(value) ? value : DEFAULT_SETTINGS.contentWidth;
}

function getValidColorScheme(value) {
  return ['warm', 'forest', 'coast', 'dusk', 'dopamine'].includes(value) ? value : DEFAULT_SETTINGS.colorScheme;
}

function applyColorScheme(value = appSettings.colorScheme) {
  document.documentElement.dataset.theme = getValidColorScheme(value);
}

function applyContentWidth() {
  const mainPanel = document.getElementById('mainPanel');
  if (!mainPanel) return;

  const width = getValidContentWidth(appSettings.contentWidth);
  mainPanel.classList.remove('content-width-wide', 'content-width-medium', 'content-width-narrow');
  mainPanel.classList.add(`content-width-${width}`);
}

function updateSettingsControls() {
  document.querySelectorAll('[data-action="set-language"]').forEach(el => {
    el.classList.toggle('selected', el.dataset.value === draftSettings.language);
  });

  const selectedColorScheme = getValidColorScheme(draftSettings.colorScheme);
  document.querySelectorAll('[data-action="set-color-scheme"]').forEach(el => {
    const selected = el.dataset.value === selectedColorScheme;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });

  const selectedWidth = getValidContentWidth(draftSettings.contentWidth);
  document.querySelectorAll('[data-action="set-content-width"]').forEach(el => {
    const selected = el.dataset.value === selectedWidth;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });

  document.querySelectorAll('[data-action="toggle-new-tab-override"]').forEach(el => {
    const selected = !!draftSettings.replaceChromeNewTab;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
}

function setHiddenState(el, hidden) {
  if (!el) return;

  if (hidden && el.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  el.toggleAttribute('inert', hidden);
  el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

function openSettingsPanel() {
  const shell = document.getElementById('appShell');
  const panel = document.getElementById('settingsPanel');
  if (!shell || !panel) return;
  draftSettings = { ...appSettings };
  updateSettingsControls();
  shell.classList.add('settings-open');
  setHiddenState(panel, false);
}

function closeSettingsPanel() {
  const shell = document.getElementById('appShell');
  const panel = document.getElementById('settingsPanel');
  if (!shell || !panel) return;
  draftSettings = { ...appSettings };
  updateSettingsControls();
  applyColorScheme(appSettings.colorScheme);
  shell.classList.remove('settings-open');
  setHiddenState(panel, true);
}

function isSettingsOpen() {
  return document.getElementById('appShell')?.classList.contains('settings-open');
}

async function loadSearchShortcuts() {
  try {
    const result = await chrome.storage.local.get(SHORTCUTS_KEY);
    const storedShortcuts = Array.isArray(result[SHORTCUTS_KEY])
      ? result[SHORTCUTS_KEY]
      : createDefaultShortcutGroups();
    searchShortcutGroups = normalizeShortcutGroups(storedShortcuts);
    if (JSON.stringify(searchShortcutGroups) !== JSON.stringify(storedShortcuts)) {
      await persistSearchShortcuts();
    }
  } catch (err) {
    console.warn('[tab-out] Failed to load shortcuts:', err);
    searchShortcutGroups = createDefaultShortcutGroups();
  }
  renderSearchShortcuts();
  refreshShortcutIcons();
}

async function persistSearchShortcuts() {
  try {
    await chrome.storage.local.set({ [SHORTCUTS_KEY]: searchShortcutGroups });
  } catch (err) {
    console.warn('[tab-out] Failed to save shortcuts:', err);
  }
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createShortcutGroup(name = t('defaultShortcutGroupName'), shortcuts = []) {
  return {
    id: createId('shortcut-group'),
    name: (name || t('defaultShortcutGroupName')).trim(),
    shortcuts: shortcuts.map(normalizeShortcut),
  };
}

function createDefaultShortcutGroups() {
  return [createShortcutGroup(t('defaultShortcutGroupName'), DEFAULT_SHORTCUTS)];
}

function isShortcutGroup(value) {
  return value && typeof value === 'object' && Array.isArray(value.shortcuts);
}

function normalizeShortcutGroup(group, index = 0) {
  return {
    id: typeof group?.id === 'string' && group.id ? group.id : createId('shortcut-group'),
    name: (group?.name || (index === 0 ? t('defaultShortcutGroupName') : `${t('defaultShortcutGroupName')} ${index + 1}`)).trim(),
    shortcuts: Array.isArray(group?.shortcuts) ? group.shortcuts.map(normalizeShortcut) : [],
  };
}

function normalizeShortcutGroups(value) {
  if (!Array.isArray(value) || value.length === 0) return createDefaultShortcutGroups();

  if (value.every(isShortcutGroup)) {
    const groups = value.map(normalizeShortcutGroup).filter(group => group.name || group.shortcuts.length);
    return groups.length ? groups : createDefaultShortcutGroups();
  }

  return [createShortcutGroup(t('defaultShortcutGroupName'), value)];
}

function getFlatShortcutEntries() {
  return searchShortcutGroups.flatMap((group, groupIndex) =>
    group.shortcuts.map((shortcut, shortcutIndex) => ({ group, groupIndex, shortcut, shortcutIndex }))
  );
}

function normalizeShortcutUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).href;
}

function getShortcutInitial(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function normalizeShortcut(shortcut) {
  return {
    name: shortcut?.name || '',
    url: shortcut?.url || '',
    iconUrl: shortcut?.iconUrl || '',
    iconStatus: shortcut?.iconUrl && shortcut?.iconStatus !== 'missing' ? 'loaded' : 'missing',
    iconCheckedAt: Number.isFinite(shortcut?.iconCheckedAt) ? shortcut.iconCheckedAt : 0,
  };
}

function createShortcutRecord(name, url, existingShortcut = null) {
  const canKeepIcon = existingShortcut?.url === url && existingShortcut?.iconUrl;
  return normalizeShortcut({
    name,
    url,
    iconUrl: canKeepIcon ? existingShortcut.iconUrl : '',
    iconStatus: canKeepIcon ? existingShortcut.iconStatus : 'missing',
    iconCheckedAt: canKeepIcon ? existingShortcut.iconCheckedAt : 0,
  });
}

function getFaviconUrl(url, size = 32, cacheBust = '') {
  try {
    const pageUrl = new URL(url).href;
    const params = new URLSearchParams({ pageUrl, size: String(size) });
    if (cacheBust) params.set('tabOutIconCheck', cacheBust);
    return `${chrome.runtime.getURL('_favicon/')}?${params.toString()}`;
  } catch {
    return '';
  }
}

function loadShortcutIcon(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(url), { once: true });
    image.addEventListener('error', () => reject(new Error(`Could not load shortcut icon: ${url}`)), { once: true });
    image.src = url;
  });
}

async function fetchShortcutIconDataUrl(url) {
  const faviconUrl = getFaviconUrl(url, 32, String(Date.now()));
  if (!faviconUrl) return '';
  return loadShortcutIcon(faviconUrl);
}

function shouldRefreshShortcutIcon(shortcut, now = Date.now()) {
  if (!shortcut?.url) return false;
  if (!shortcut.iconUrl || shortcut.iconStatus !== 'loaded') return true;
  return !shortcut.iconCheckedAt || now - shortcut.iconCheckedAt >= SHORTCUT_ICON_REFRESH_INTERVAL_MS;
}

async function refreshShortcutIcons({ force = false } = {}) {
  if (shortcutIconRefreshInFlight) return shortcutIconRefreshInFlight;

  shortcutIconRefreshInFlight = (async () => {
    const now = Date.now();
    const refreshTargets = getFlatShortcutEntries()
      .filter(({ shortcut }) => force ? !!shortcut?.url : shouldRefreshShortcutIcon(shortcut, now));

    const stats = { checked: refreshTargets.length, updated: 0 };
    if (!refreshTargets.length) return stats;

    let changed = false;
    for (const { shortcut, groupIndex, shortcutIndex } of refreshTargets) {
      const originalUrl = shortcut.url;
      try {
        const iconUrl = await fetchShortcutIconDataUrl(originalUrl);
        const currentShortcut = searchShortcutGroups[groupIndex]?.shortcuts[shortcutIndex];
        if (!currentShortcut || currentShortcut.url !== originalUrl) continue;

        if (iconUrl) {
          if (currentShortcut.iconUrl !== iconUrl) stats.updated += 1;
          searchShortcutGroups[groupIndex].shortcuts[shortcutIndex] = {
            ...currentShortcut,
            iconUrl,
            iconStatus: 'loaded',
            iconCheckedAt: Date.now(),
          };
          changed = true;
        } else if (currentShortcut.iconUrl) {
          searchShortcutGroups[groupIndex].shortcuts[shortcutIndex] = {
            ...currentShortcut,
            iconStatus: 'loaded',
            iconCheckedAt: Date.now(),
          };
          changed = true;
        } else if (currentShortcut.iconStatus !== 'missing') {
          searchShortcutGroups[groupIndex].shortcuts[shortcutIndex] = {
            ...currentShortcut,
            iconUrl: '',
            iconStatus: 'missing',
          };
          changed = true;
        }
      } catch (err) {
        const currentShortcut = searchShortcutGroups[groupIndex]?.shortcuts[shortcutIndex];
        if (!currentShortcut || currentShortcut.url !== originalUrl) continue;

        if (currentShortcut.iconUrl) {
          searchShortcutGroups[groupIndex].shortcuts[shortcutIndex] = {
            ...currentShortcut,
            iconStatus: 'loaded',
            iconCheckedAt: Date.now(),
          };
          changed = true;
        } else if (currentShortcut.iconStatus !== 'missing') {
          searchShortcutGroups[groupIndex].shortcuts[shortcutIndex] = {
            ...currentShortcut,
            iconUrl: '',
            iconStatus: 'missing',
          };
          changed = true;
        }
        console.warn('[tab-out] Failed to refresh shortcut icon:', err);
      }
    }

    if (changed) {
      await persistSearchShortcuts();
      renderSearchShortcuts();
    }

    return stats;
  })().finally(() => {
    shortcutIconRefreshInFlight = null;
  });

  return shortcutIconRefreshInFlight;
}

function createShortcutTile(shortcut, groupIndex, shortcutIndex) {
  const tile = document.createElement('a');
  tile.href = shortcut.url;
  tile.className = 'shortcut-item';
  tile.draggable = true;
  tile.dataset.groupIndex = String(groupIndex);
  tile.dataset.shortcutIndex = String(shortcutIndex);
  tile.title = shortcut.name;

  tile.addEventListener('dragstart', event => {
    activeShortcutDrag = { type: 'shortcut', groupIndex, shortcutIndex };
    tile.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${groupIndex}:${shortcutIndex}`);
  });

  tile.addEventListener('dragend', () => {
    tile.classList.remove('dragging');
    activeShortcutDrag = null;
  });

  tile.addEventListener('contextmenu', event => {
    event.preventDefault();
    openShortcutModal(groupIndex, shortcutIndex);
  });

  tile.addEventListener('click', event => {
    if (suppressShortcutClick || tile.classList.contains('dragging')) {
      event.preventDefault();
      return;
    }

    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      window.location.assign(shortcut.url);
    }
  });

  const icon = document.createElement('span');
  icon.className = 'shortcut-icon';

  const favicon = document.createElement('img');
  favicon.alt = '';
  favicon.loading = 'lazy';

  const fallback = document.createElement('span');
  fallback.className = 'shortcut-icon-fallback';
  fallback.textContent = getShortcutInitial(shortcut.name);

  if (shortcut.iconUrl) {
    favicon.src = shortcut.iconUrl;
  } else {
    favicon.style.display = 'none';
    fallback.classList.add('visible');
  }

  favicon.addEventListener('error', () => {
    favicon.style.display = 'none';
    fallback.classList.add('visible');
  });
  favicon.addEventListener('load', () => {
    favicon.style.display = 'block';
    fallback.classList.remove('visible');
  });

  icon.append(favicon, fallback);

  const text = document.createElement('span');
  text.className = 'shortcut-text';
  text.textContent = shortcut.name;

  tile.append(icon, text);
  return tile;
}

function closeShortcutGroupMenus(exceptMenu = null) {
  document.querySelectorAll('.shortcut-group-menu.open').forEach(menu => {
    if (menu === exceptMenu) return;
    menu.classList.remove('open');
  });
  document.querySelectorAll('.shortcut-group-menu-button[aria-expanded="true"]').forEach(button => {
    if (exceptMenu && button.nextElementSibling === exceptMenu) return;
    button.setAttribute('aria-expanded', 'false');
  });
}

function createShortcutGroupMenu(groupIndex) {
  const wrapper = document.createElement('span');
  wrapper.className = 'shortcut-group-menu-wrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shortcut-group-menu-button';
  button.dataset.action = 'toggle-shortcut-group-menu';
  button.dataset.groupIndex = String(groupIndex);
  button.setAttribute('aria-expanded', 'false');
  button.title = t('shortcutGroupMenu');
  button.innerHTML = '<span></span><span></span><span></span>';

  const menu = document.createElement('div');
  menu.className = 'shortcut-group-menu';
  menu.setAttribute('role', 'menu');

  [
    { action: 'open-shortcut-modal', label: t('addShortcut') },
    { action: 'add-shortcut-group', label: t('addShortcutGroup') },
    { action: 'open-shortcut-group-modal', label: t('editShortcutGroup') },
  ].forEach(item => {
    const menuItem = document.createElement('button');
    menuItem.type = 'button';
    menuItem.className = 'shortcut-group-menu-item';
    menuItem.dataset.action = item.action;
    menuItem.dataset.groupIndex = String(groupIndex);
    menuItem.setAttribute('role', 'menuitem');
    menuItem.textContent = item.label;
    menu.appendChild(menuItem);
  });

  wrapper.append(button, menu);
  return wrapper;
}

function renderSearchShortcuts() {
  const strip = document.getElementById('shortcutStrip');
  if (!strip) return;

  strip.innerHTML = '';
  searchShortcutGroups.forEach((group, groupIndex) => {
    const row = document.createElement('div');
    row.className = 'shortcut-group-row';
    row.dataset.groupIndex = String(groupIndex);

    const label = document.createElement('div');
    label.className = 'shortcut-group-label';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'shortcut-group-name-button';
    handle.draggable = true;
    handle.dataset.groupIndex = String(groupIndex);
    handle.title = group.name;
    handle.innerHTML = `<span class="shortcut-group-name"></span><span class="shortcut-group-divider" aria-hidden="true"></span>`;
    handle.querySelector('.shortcut-group-name').textContent = group.name;
    handle.addEventListener('dblclick', () => openShortcutGroupModal(groupIndex));
    handle.addEventListener('dragstart', event => {
      activeShortcutDrag = { type: 'group', groupIndex };
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `group:${groupIndex}`);
    });
    handle.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      activeShortcutDrag = null;
    });
    label.append(handle, createShortcutGroupMenu(groupIndex));

    const list = document.createElement('div');
    list.className = 'shortcut-group-list';
    group.shortcuts.forEach((shortcut, shortcutIndex) => {
      list.appendChild(createShortcutTile(shortcut, groupIndex, shortcutIndex));
    });

    row.append(label, list);
    strip.appendChild(row);
  });
}

function getShortcutDropReference(container, clientX, clientY) {
  const items = [...container.querySelectorAll('.shortcut-item[data-shortcut-index]:not(.dragging)')];
  if (!items.length) return null;

  return items.reduce((closest, item) => {
    const rect = item.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    if (distance >= closest.distance) return closest;
    const sameRow = Math.abs(clientY - centerY) <= rect.height / 2;
    return { item, before: clientY < centerY || (sameRow && clientX < centerX), distance };
  }, { item: null, before: false, distance: Number.POSITIVE_INFINITY });
}

function openShortcutModal(groupIndex = 0, shortcutIndex = -1) {
  const modal = document.getElementById('shortcutModal');
  const groupInput = document.getElementById('shortcutGroupIndex');
  const indexInput = document.getElementById('shortcutEditIndex');
  const nameInput = document.getElementById('shortcutNameInput');
  const urlInput = document.getElementById('shortcutUrlInput');
  const deleteButton = document.getElementById('shortcutDeleteButton');
  if (!modal || !groupInput || !indexInput || !nameInput || !urlInput || !deleteButton) return;

  const safeGroupIndex = searchShortcutGroups[groupIndex] ? groupIndex : 0;
  const shortcut = searchShortcutGroups[safeGroupIndex]?.shortcuts[shortcutIndex];
  groupInput.value = String(safeGroupIndex);
  indexInput.value = String(shortcutIndex);
  nameInput.value = shortcut?.name || '';
  urlInput.value = shortcut?.url || '';
  deleteButton.style.display = shortcutIndex >= 0 ? 'inline-flex' : 'none';
  modal.classList.add('open');
  setHiddenState(modal, false);
  setTimeout(() => nameInput.focus(), 0);
}

function closeShortcutModal() {
  const modal = document.getElementById('shortcutModal');
  if (!modal) return;
  modal.classList.remove('open');
  setHiddenState(modal, true);
}

async function saveShortcutFromModal() {
  const groupInput = document.getElementById('shortcutGroupIndex');
  const indexInput = document.getElementById('shortcutEditIndex');
  const nameInput = document.getElementById('shortcutNameInput');
  const urlInput = document.getElementById('shortcutUrlInput');
  if (!groupInput || !indexInput || !nameInput || !urlInput) return;

  const groupIndex = Number.parseInt(groupInput.value, 10);
  const index = Number.parseInt(indexInput.value, 10);
  const name = nameInput.value.trim();
  const rawUrl = urlInput.value.trim();
  if (!name || !rawUrl) {
    showToast(t('shortcutNameUrlRequired'));
    return;
  }

  let url;
  try {
    url = normalizeShortcutUrl(rawUrl);
  } catch {
    showToast(t('invalidShortcutUrl'));
    return;
  }

  const group = searchShortcutGroups[groupIndex] || searchShortcutGroups[0];
  if (!group) return;

  const existingShortcut = Number.isInteger(index) && index >= 0 && index < group.shortcuts.length
    ? group.shortcuts[index]
    : null;
  const nextShortcut = createShortcutRecord(name, url, existingShortcut);
  if (Number.isInteger(index) && index >= 0 && index < group.shortcuts.length) {
    group.shortcuts[index] = nextShortcut;
  } else {
    group.shortcuts.push(nextShortcut);
  }

  await persistSearchShortcuts();
  renderSearchShortcuts();
  refreshShortcutIcons();
  closeShortcutModal();
  showToast(t('shortcutSaved'));
}

async function deleteShortcutFromModal() {
  const groupInput = document.getElementById('shortcutGroupIndex');
  const indexInput = document.getElementById('shortcutEditIndex');
  if (!groupInput || !indexInput) return;

  const groupIndex = Number.parseInt(groupInput.value, 10);
  const index = Number.parseInt(indexInput.value, 10);
  const group = searchShortcutGroups[groupIndex];
  if (!group || !Number.isInteger(index) || index < 0 || index >= group.shortcuts.length) return;

  group.shortcuts.splice(index, 1);
  await persistSearchShortcuts();
  renderSearchShortcuts();
  closeShortcutModal();
  showToast(t('shortcutDeleted'));
}

async function addShortcutGroup(afterGroupIndex = searchShortcutGroups.length - 1) {
  const name = window.prompt(t('shortcutGroupNamePrompt'), `${t('defaultShortcutGroupName')} ${searchShortcutGroups.length + 1}`);
  const trimmed = (name || '').trim();
  if (!trimmed) return;

  const insertIndex = Math.min(Math.max(afterGroupIndex + 1, 0), searchShortcutGroups.length);
  searchShortcutGroups.splice(insertIndex, 0, createShortcutGroup(trimmed, []));
  await persistSearchShortcuts();
  renderSearchShortcuts();
  showToast(t('shortcutGroupAdded'));
}

function openShortcutGroupModal(groupIndex = -1) {
  const modal = document.getElementById('shortcutGroupModal');
  const indexInput = document.getElementById('shortcutGroupEditIndex');
  const nameInput = document.getElementById('shortcutGroupNameInput');
  if (!modal || !indexInput || !nameInput) return;

  const group = searchShortcutGroups[groupIndex];
  if (!group) return;

  indexInput.value = String(groupIndex);
  nameInput.value = group.name;
  modal.classList.add('open');
  setHiddenState(modal, false);
  setTimeout(() => nameInput.focus(), 0);
}

function closeShortcutGroupModal() {
  const modal = document.getElementById('shortcutGroupModal');
  if (!modal) return;
  modal.classList.remove('open');
  setHiddenState(modal, true);
}

async function saveShortcutGroupFromModal() {
  const indexInput = document.getElementById('shortcutGroupEditIndex');
  const nameInput = document.getElementById('shortcutGroupNameInput');
  if (!indexInput || !nameInput) return;

  const groupIndex = Number.parseInt(indexInput.value, 10);
  const group = searchShortcutGroups[groupIndex];
  const trimmed = nameInput.value.trim();
  if (!group || !trimmed) return;
  if (trimmed === group.name) {
    closeShortcutGroupModal();
    return;
  }

  group.name = trimmed;
  await persistSearchShortcuts();
  renderSearchShortcuts();
  closeShortcutGroupModal();
  showToast(t('shortcutGroupSaved'));
}

async function deleteShortcutGroupFromModal() {
  const indexInput = document.getElementById('shortcutGroupEditIndex');
  if (!indexInput) return;

  const groupIndex = Number.parseInt(indexInput.value, 10);
  await deleteShortcutGroup(groupIndex);
}

async function deleteShortcutGroup(groupIndex) {
  const group = searchShortcutGroups[groupIndex];
  if (!group) return;
  if (!window.confirm(t('confirmDeleteShortcutGroup', group.name))) return;

  searchShortcutGroups.splice(groupIndex, 1);
  if (!searchShortcutGroups.length) {
    searchShortcutGroups = [createShortcutGroup(t('defaultShortcutGroupName'), [])];
  }
  await persistSearchShortcuts();
  renderSearchShortcuts();
  closeShortcutGroupModal();
  showToast(t('shortcutGroupDeleted'));
}

async function reorderSearchShortcutGroups(fromGroupIndex, toGroupIndex) {
  if (fromGroupIndex === toGroupIndex || fromGroupIndex < 0 || toGroupIndex < 0) return;
  if (fromGroupIndex >= searchShortcutGroups.length || toGroupIndex >= searchShortcutGroups.length) return;

  const next = [...searchShortcutGroups];
  const [moved] = next.splice(fromGroupIndex, 1);
  next.splice(toGroupIndex, 0, moved);
  searchShortcutGroups = next;
  await persistSearchShortcuts();
  renderSearchShortcuts();
}

async function moveSearchShortcut(fromGroupIndex, fromShortcutIndex, toGroupIndex, toShortcutIndex) {
  const fromGroup = searchShortcutGroups[fromGroupIndex];
  const toGroup = searchShortcutGroups[toGroupIndex];
  if (!fromGroup || !toGroup) return;
  if (fromShortcutIndex < 0 || fromShortcutIndex >= fromGroup.shortcuts.length) return;

  const [moved] = fromGroup.shortcuts.splice(fromShortcutIndex, 1);
  const insertIndex = Math.min(Math.max(toShortcutIndex, 0), toGroup.shortcuts.length);
  toGroup.shortcuts.splice(insertIndex, 0, moved);
  await persistSearchShortcuts();
  renderSearchShortcuts();
}

function handleSearchSubmit(event) {
  const form = event.target.closest('form[data-search-engine]');
  if (!form) return;
  event.preventDefault();

  const engine = event.submitter?.dataset.searchEngine || form.dataset.searchEngine;
  const input = form.querySelector('input[type="search"]');
  const query = input?.value.trim();
  if (!query) {
    input?.focus();
    return;
  }

  const targetUrl = engine === 'baidu'
    ? `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`
    : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  window.location.assign(targetUrl);
}


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS an extension page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

function isBrowserInternalUrl(url = '') {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://')
  );
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    const dashboardUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      // Flag Tab Out's own dashboard page so we can detect duplicate dashboards
      isTabOut: t.url === dashboardUrl,
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (isBrowserInternalUrl(tabUrl)) return false;
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(t => t.url && !isBrowserInternalUrl(t.url) && urlSet.has(t.url))
    .map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeTabByIdOrUrl(tabId, url) {
  let closed = false;

  if (Number.isInteger(tabId) && tabId >= 0) {
    try {
      await chrome.tabs.remove(tabId);
      closed = true;
    } catch (err) {
      console.warn('[tab-out] Could not close tab by id, falling back to URL:', err);
    }
  }

  if (!closed && url) {
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url && !isBrowserInternalUrl(t.url) && t.url === url);
    if (match) {
      await chrome.tabs.remove(match.id);
      closed = true;
    }
  }

  await fetchOpenTabs();
  return closed;
}

async function closeTabsByIds(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) return 0;

  const ids = tabs
    .filter(tab => !isBrowserInternalUrl(tab.url || ''))
    .map(tab => tab.id)
    .filter(id => Number.isInteger(id) && id >= 0);

  if (ids.length > 0) {
    await chrome.tabs.remove(ids);
    await fetchOpenTabs();
  }

  return ids.length;
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    if (isBrowserInternalUrl(url || '')) continue;

    const matching = allTabs.filter(t => t.url && !isBrowserInternalUrl(t.url) && t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      if (!keep) continue;
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out dashboard pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const dashboardUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t => t.url === dashboardUrl);

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

async function saveTabsForLater(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) return 0;

  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const now = Date.now();
  const savedAt = new Date().toISOString();

  tabs.forEach((tab, index) => {
    deferred.push({
      id:        `${now}-${index}`,
      url:       tab.url,
      title:     tab.title || tab.url,
      savedAt,
      completed: false,
      dismissed: false,
    });
  });

  await chrome.storage.local.set({ deferred });
  return tabs.length;
}

function getDomainFromUrl(url) {
  try {
    if (url && url.startsWith('file://')) return 'local-files';
    return new URL(url).hostname;
  } catch {
    return 'saved-links';
  }
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHTML(value);
}

function groupSavedTabsByDomain(items) {
  const groupMap = {};

  for (const item of items) {
    const domain = getDomainFromUrl(item.url);
    if (!groupMap[domain]) groupMap[domain] = { domain, tabs: [] };
    groupMap[domain].tabs.push(item);
  }

  return Object.values(groupMap).sort((a, b) => {
    if (b.tabs.length !== a.tabs.length) return b.tabs.length - a.tabs.length;
    return friendlyDomain(a.domain).localeCompare(friendlyDomain(b.domain));
  });
}

function getGroupActionId(group) {
  if (group.actionId) return group.actionId;
  return 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');
}

function splitGroupsByTabLimit(groups, limit = 8) {
  return groups.flatMap(group => {
    const tabs = group.tabs || [];
    if (tabs.length <= limit) return [group];

    const baseActionId = getGroupActionId(group);
    const chunks = [];
    for (let index = 0; index < tabs.length; index += limit) {
      const part = Math.floor(index / limit) + 1;
      chunks.push({
        ...group,
        actionId: `${baseActionId}--part-${part}`,
        tabs: tabs.slice(index, index + limit),
      });
    }
    return chunks;
  });
}

function groupSavedTabsForOpenTabsModule(items) {
  const groups = groupSavedTabsByDomain(items).map(group => ({
    domain: group.domain,
    tabs: group.tabs.map(item => ({
      id: null,
      savedId: item.id,
      url: item.url,
      title: item.title || item.url,
      windowId: null,
      active: false,
    })),
  }));

  return splitGroupsByTabLimit(groups, 8);
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}

async function dismissSavedTabs(ids) {
  const idSet = new Set(ids);
  if (idSet.size === 0) return;

  const { deferred = [] } = await chrome.storage.local.get('deferred');
  let changed = false;

  for (const tab of deferred) {
    if (!idSet.has(tab.id)) continue;
    tab.dismissed = true;
    changed = true;
  }

  if (changed) await chrome.storage.local.set({ deferred });
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function renderOpenTabsModule({ sectionId, titleId, countId, missionsId, title, groups = domainGroups, itemCount = getRealTabs().length, showDuplicates = true, showSaveAction = true, savedModule = false }) {
  const section = document.getElementById(sectionId);
  const titleEl = document.getElementById(titleId);
  const countEl = document.getElementById(countId);
  const missionsEl = document.getElementById(missionsId);
  if (!section || !countEl || !missionsEl) return;

  if (groups.length === 0) {
    section.style.display = 'none';
    return;
  }

  if (titleEl) titleEl.textContent = title;
  const actionsHtml = savedModule
    ? `<button class="action-btn close-tabs section-action-btn" data-action="clear-all-saved-tabs">${ICONS.close} ${t('clearAllSavedTabs')}</button>`
    : `<button class="action-btn close-tabs section-action-btn" data-action="close-all-open-tabs">${ICONS.close} ${t('closeAllTabs')}</button>
       <button class="action-btn save-tabs section-action-btn" data-action="defer-all-open-tabs">${ICONS.bookmark} ${t('deferAllForLater')}</button>`;
  countEl.innerHTML = `
    <span>${t('domains', groups.length)}</span>
    <span class="section-count-divider">&middot;</span>
    <span>${t('tabs', itemCount)}</span>
    ${actionsHtml}`;
  missionsEl.innerHTML = groups.map(g => renderDomainCard(g, { showDuplicates, showSaveAction, savedModule })).join('');
  section.style.display = 'block';
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${t('inboxZeroTitle')}</div>
      <div class="empty-subtitle">${t('inboxZeroSubtitle')}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) {
    countEl.innerHTML = `
      <span>${t('domains', 0)}</span>
      <span class="section-count-divider">&middot;</span>
      <span>${t('tabs', 0)}</span>`;
  }
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

function getGreetingPeriod(hour) {
  if (hour < 5) return 'lateNight';
  if (hour < 8) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  if (hour < 23) return 'night';
  return 'lateNight';
}

function pickStablePhrase(phrases, now) {
  if (!phrases?.length) return '';
  const seed = now.getFullYear() + now.getMonth() + now.getDate() + now.getHours();
  return phrases[seed % phrases.length];
}

/**
 * getGreeting() — localized, time-aware greeting.
 */
function getGreeting(now = new Date()) {
  const lang = appSettings.language === 'zh' ? 'zh' : 'en';
  const period = getGreetingPeriod(now.getHours());
  const phrases = GREETING_PHRASES[lang]?.[period] || GREETING_PHRASES.en.morning;
  return pickStablePhrase(phrases, now);
}

/**
 * getDateTimeDisplay() — localized date + live time down to seconds.
 */
function getDateTimeDisplay(now = new Date()) {
  const locale = appSettings.language === 'zh' ? 'zh-CN' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: appSettings.language !== 'zh',
  }).format(now);
}

function updateHeaderClock() {
  const now = new Date();
  const greetingEl = document.getElementById('greeting');
  const dateEl = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting(now);
  if (dateEl) dateEl.textContent = getDateTimeDisplay(now);
}

function startHeaderClock() {
  updateHeaderClock();
  if (headerClockTimer) return;
  headerClockTimer = setInterval(updateHeaderClock, 1000);
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  bookmark:`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>`,
  dedup:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 8.25V6A2.25 2.25 0 0 0 14.25 3.75h-8.5A2.25 2.25 0 0 0 3.5 6v8.5a2.25 2.25 0 0 0 2.25 2.25H8m3.5-9.5h6.75A2.25 2.25 0 0 1 20.5 9.5v8.75a2.25 2.25 0 0 1-2.25 2.25H9.5a2.25 2.25 0 0 1-2.25-2.25V11.5A2.25 2.25 0 0 1 9.5 9.25Z" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return !isBrowserInternalUrl(url);
  });
}

/**
 * checkTabOutDupes()
 *
 * The background service worker now handles duplicate Tab Out pages by
 * focusing the existing dashboard and closing the extra tab.
 */
function checkTabOutDupes() {
  const banner  = document.getElementById('tabOutDupeBanner');
  if (!banner) return;

  banner.style.display = 'none';
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}, { showDuplicates = true, showSaveAction = true, savedModule = false } = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const isDupe   = showDuplicates && count > 1;
    const dupeTag  = isDupe ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = isDupe ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const safeTabId = Number.isInteger(tab.id) ? tab.id : '';
    const safeSavedId = tab.savedId ? String(tab.savedId).replace(/"/g, '&quot;') : '';
    const closeAction = savedModule ? 'dismiss-open-tabs2-tab' : 'close-single-tab';
    const deferredAttrs = savedModule ? ` data-deferred-id="${safeSavedId}" data-deferred-url="${safeUrl}"` : '';
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        ${showSaveAction ? `<button class="chip-action chip-save" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('savedForLater')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>` : ''}
        <button class="chip-action chip-close" data-action="${closeAction}" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}"${deferredAttrs} title="${t('closeThisTab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group, { showDuplicates = true, showSaveAction = true, savedModule = false } = {}) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = getGroupActionId(group);

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = showDuplicates && dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge${savedModule ? ' saved-tabs-badge' : ''}">
    ${ICONS.tabs}
    ${savedModule ? `${tabCount}个` : t('tabsOpen', tabCount)}
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${t('duplicateBadge', totalExtras)}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const displayTabs = showDuplicates ? uniqueTabs : tabs;
  const visibleTabs = displayTabs.slice(0, 8);
  const extraCount  = displayTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const isDupe   = showDuplicates && count > 1;
    const dupeTag  = isDupe ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = isDupe ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const safeTabId = Number.isInteger(tab.id) ? tab.id : '';
    const safeSavedId = tab.savedId ? String(tab.savedId).replace(/"/g, '&quot;') : '';
    const closeAction = savedModule ? 'dismiss-open-tabs2-tab' : 'close-single-tab';
    const deferredAttrs = savedModule ? ` data-deferred-id="${safeSavedId}" data-deferred-url="${safeUrl}"` : '';
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        ${showSaveAction ? `<button class="chip-action chip-save" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('savedForLater')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>` : ''}
        <button class="chip-action chip-close" data-action="${closeAction}" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}"${deferredAttrs} title="${t('closeThisTab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(displayTabs.slice(8), urlCounts, { showDuplicates, showSaveAction, savedModule }) : '');

  let actionsHtml = savedModule ? '' : `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      ${t('closeAllCompact', tabCount)}
    </button>
    <button class="action-btn save-tabs" data-action="defer-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.bookmark}
      ${t('saveAllForLaterCompact', tabCount)}
    </button>`;

  const savedHeaderActions = savedModule
    ? `<div class="saved-domain-actions">
        <button class="saved-domain-btn saved-close-all-btn" data-action="dismiss-open-tabs2-card" type="button">${t('closeAllSavedCompact')}</button>
        <button class="saved-domain-btn saved-open-all-btn" data-action="open-open-tabs2-card" type="button">${t('openAllCompact')}</button>
      </div>`
    : '';

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn dedup-tabs" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        ${ICONS.dedup}
        ${t('closeDuplicates', totalExtras)}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? t('homepages') : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
          ${savedHeaderActions}
        </div>
        <div class="mission-pages">${pageChips}</div>
        ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">${t('tabs', tabCount).replace(String(tabCount), '').trim() || 'tabs'}</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Domain Cards
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders active saved
 * links below the open-tab cards, grouped into the same domain-card grid.
 * Completed items stay available in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');
  const archiveBody    = document.getElementById('archiveBody');
  const archiveToggle  = document.getElementById('archiveToggle');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire section if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active saved links as domain cards
    if (active.length > 0) {
      const groups = groupSavedTabsByDomain(active);
      countEl.innerHTML = `
        <span>${t('domains', groups.length)}</span>
        <span class="section-count-divider">&middot;</span>
        <span>${t('savedItems', active.length)}</span>`;
      list.innerHTML = groups.map(group => renderDeferredDomainCard(group)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
      if (archiveBody) archiveBody.style.display = 'block';
      if (archiveToggle) archiveToggle.classList.add('open');
    } else {
      archiveEl.style.display = 'none';
      if (archiveBody) archiveBody.style.display = 'none';
      if (archiveToggle) archiveToggle.classList.remove('open');
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredDomainCard(group)
 *
 * Builds one saved-for-later domain card.
 */
function renderDeferredDomainCard(group) {
  const tabs = group.tabs || [];
  const itemCount = tabs.length;
  const itemBadge = `<span class="open-tabs-badge saved-tabs-badge">
    ${ICONS.bookmark}
    ${t('savedItems', itemCount)}
  </span>`;

  return `
    <div class="mission-card domain-card saved-domain-card has-active-bar" data-saved-domain="${escapeAttr(group.domain)}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${escapeHTML(friendlyDomain(group.domain))}</span>
          ${itemBadge}
          <div class="saved-domain-actions">
            <button class="saved-domain-btn saved-close-all-btn" data-action="dismiss-deferred-domain" type="button">${t('closeAllSavedCompact')}</button>
            <button class="saved-domain-btn saved-open-all-btn" data-action="open-deferred-domain" type="button">${t('openAllCompact')}</button>
          </div>
        </div>
        <div class="mission-pages">${tabs.map(item => renderDeferredItem(item, group.domain)).join('')}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${itemCount}</div>
        <div class="mission-page-label">${t('savedItems', itemCount).replace(String(itemCount), '').trim() || 'items'}</div>
      </div>
    </div>`;
}

/**
 * renderDeferredItem(item, groupDomain)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item, groupDomain = '') {
  const domain = groupDomain || getDomainFromUrl(item.url);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);
  const label = cleanTitle(smartTitle(stripTitleNoise(item.title || ''), item.url), domain) || item.url;

  return `
    <div class="page-chip deferred-item deferred-saved-chip" data-deferred-id="${escapeAttr(item.id)}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${escapeAttr(item.id)}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <div class="deferred-info">
        <a href="${escapeAttr(item.url)}" target="_blank" rel="noopener" class="deferred-title saved-page-link" data-action="open-deferred-tab" data-deferred-id="${escapeAttr(item.id)}" data-deferred-url="${escapeAttr(item.url)}" title="${escapeAttr(item.title || item.url)}">
          <span class="chip-text">${escapeHTML(label)}</span>
        </a>
        <div class="deferred-meta">
          <span>${escapeHTML(ago)}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${escapeAttr(item.id)}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

function updateSavedDomainCardCount(card) {
  if (!card) return;

  const itemCount = card.querySelectorAll('.deferred-item:not(.removing)').length;
  if (itemCount === 0) {
    card.classList.add('closing');
    setTimeout(() => {
      card.remove();
      updateDeferredSectionCountFromDOM();
    }, 250);
    return;
  }

  const badge = card.querySelector('.saved-tabs-badge');
  if (badge) {
    badge.innerHTML = `${ICONS.bookmark} ${t('savedItems', itemCount)}`;
  }

  const countEl = card.querySelector('.mission-page-count');
  if (countEl) countEl.textContent = itemCount;

  const labelEl = card.querySelector('.mission-page-label');
  if (labelEl) {
    labelEl.textContent = t('savedItems', itemCount).replace(String(itemCount), '').trim() || 'items';
  }
}

function updateDeferredSectionCountFromDOM() {
  const column = document.getElementById('deferredColumn');
  const list = document.getElementById('deferredList');
  const empty = document.getElementById('deferredEmpty');
  const countEl = document.getElementById('deferredCount');
  const archiveEl = document.getElementById('deferredArchive');
  if (!column || !list || !empty || !countEl) return;

  const cardCount = list.querySelectorAll('.saved-domain-card:not(.closing)').length;
  const itemCount = list.querySelectorAll('.deferred-item:not(.removing)').length;

  if (itemCount > 0) {
    countEl.innerHTML = `
      <span>${t('domains', cardCount)}</span>
      <span class="section-count-divider">&middot;</span>
      <span>${t('savedItems', itemCount)}</span>`;
    list.style.display = 'block';
    empty.style.display = 'none';
    column.style.display = 'block';
    return;
  }

  countEl.textContent = '';
  list.style.display = 'none';
  empty.style.display = 'block';

  const hasArchive = archiveEl && archiveEl.style.display !== 'none';
  column.style.display = hasArchive ? 'block' : 'none';
}

function removeDeferredItemFromDOM(item) {
  if (!item) return;

  const savedCard = item.closest('.saved-domain-card');
  item.classList.add('removing');
  setTimeout(() => {
    item.remove();
    updateSavedDomainCardCount(savedCard);
    updateDeferredSectionCountFromDOM();
  }, 300);
}

function removeSavedDomainCardFromDOM(card) {
  if (!card) return;

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    updateDeferredSectionCountFromDOM();
  }, 250);
}

async function openSavedTabAndRemove(id, url, item) {
  if (!id || !url) return;

  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    window.open(url, '_blank', 'noopener');
  }

  await dismissSavedTab(id);
  removeDeferredItemFromDOM(item);
}

async function openSavedDomainAndRemove(card) {
  if (!card) return;

  const savedTabs = getSavedTabsFromCard(card);

  if (savedTabs.length === 0) return;

  for (const tab of savedTabs) {
    try {
      await chrome.tabs.create({ url: tab.url, active: false });
    } catch (err) {
      window.open(tab.url, '_blank', 'noopener');
    }
  }

  await dismissSavedTabs(savedTabs.map(tab => tab.id));
  removeSavedDomainCardFromDOM(card);
}

function getSavedTabsFromCard(card) {
  if (!card) return [];

  return Array.from(card.querySelectorAll('[data-deferred-id]'))
    .map(el => ({
      id: el.dataset.deferredId,
      url: el.dataset.deferredUrl || el.dataset.tabUrl || el.getAttribute('href'),
    }))
    .filter(tab => tab.id && tab.url);
}

async function dismissSavedDomain(card) {
  const savedTabs = getSavedTabsFromCard(card);
  if (savedTabs.length === 0) return;

  await dismissSavedTabs(savedTabs.map(tab => tab.id));
  removeSavedDomainCardFromDOM(card);
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" domain cards
 */
async function renderStaticDashboard() {
  // --- Header ---
  updateHeaderClock();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  const sortedDomainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });
  domainGroups = splitGroupsByTabLimit(sortedDomainGroups, 8);

  // --- Render domain cards ---
  renderOpenTabsModule({
    sectionId: 'openTabsSection',
    titleId: 'openTabsSectionTitle',
    countId: 'openTabsSectionCount',
    missionsId: 'openTabsMissions',
    title: t('openTabsTitle'),
    groups: domainGroups,
    itemCount: realTabs.length,
  });

  const { active: activeSavedTabs } = await getSavedTabs();
  const savedGroupsForOpenTabsModule = groupSavedTabsForOpenTabsModule(activeSavedTabs);
  renderOpenTabsModule({
    sectionId: 'openTabsSection2',
    titleId: 'openTabsSectionTitle2',
    countId: 'openTabsSectionCount2',
    missionsId: 'openTabsMissions2',
    title: t('savedForLater'),
    groups: savedGroupsForOpenTabsModule,
    itemCount: activeSavedTabs.length,
    showDuplicates: false,
    showSaveAction: false,
    savedModule: true,
  });

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // Saved-for-later links render through openTabsSection2 above.
}

async function renderDashboard() {
  await loadSettings();
  await loadSearchShortcuts();
  applyColorScheme();
  applyContentWidth();
  applyLanguage();
  updateSettingsControls();
  renderSearchShortcuts();
  startHeaderClock();
  await renderStaticDashboard();
}

async function refreshDashboardFromBackground() {
  if (dashboardRefreshInFlight) return dashboardRefreshInFlight;

  dashboardRefreshInFlight = refreshLocalizedUI()
    .catch(err => {
      console.warn('[tab-out] Background refresh failed:', err);
    })
    .finally(() => {
      dashboardRefreshInFlight = null;
    });

  return dashboardRefreshInFlight;
}

async function notifyDashboardReady() {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    chrome.runtime.sendMessage({
      type: 'TAB_OUT_DASHBOARD_READY',
      tabId: currentTab?.id,
    });
  } catch (err) {
    console.warn('[tab-out] Failed to notify background:', err);
  }
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  const clickedInsideSettings = !!e.target.closest('#settingsPanel');
  const clickedSettingsToggle = !!e.target.closest('[data-action="open-settings"]');
  if (isSettingsOpen() && !clickedInsideSettings && !clickedSettingsToggle) {
    closeSettingsPanel();
  }

  if (!e.target.closest('.shortcut-group-menu-wrap')) {
    closeShortcutGroupMenus();
  }

  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'toggle-shortcut-group-menu') {
    e.preventDefault();
    const menu = actionEl.nextElementSibling;
    if (!menu?.classList.contains('shortcut-group-menu')) return;
    const willOpen = !menu.classList.contains('open');
    closeShortcutGroupMenus(menu);
    menu.classList.toggle('open', willOpen);
    actionEl.setAttribute('aria-expanded', String(willOpen));
    return;
  }

  closeShortcutGroupMenus();

  if (action === 'open-shortcut-modal') {
    e.preventDefault();
    const groupIndex = Number.parseInt(actionEl.dataset.groupIndex || '0', 10);
    openShortcutModal(Number.isInteger(groupIndex) ? groupIndex : 0);
    return;
  }

  if (action === 'add-shortcut-group') {
    e.preventDefault();
    const groupIndex = Number.parseInt(actionEl.dataset.groupIndex || String(searchShortcutGroups.length - 1), 10);
    await addShortcutGroup(Number.isInteger(groupIndex) ? groupIndex : searchShortcutGroups.length - 1);
    return;
  }

  if (action === 'open-shortcut-group-modal') {
    e.preventDefault();
    const groupIndex = Number.parseInt(actionEl.dataset.groupIndex || '-1', 10);
    openShortcutGroupModal(Number.isInteger(groupIndex) ? groupIndex : -1);
    return;
  }

  if (action === 'close-shortcut-group-modal') {
    e.preventDefault();
    closeShortcutGroupModal();
    return;
  }

  if (action === 'save-shortcut-group') {
    e.preventDefault();
    await saveShortcutGroupFromModal();
    return;
  }

  if (action === 'delete-shortcut-group') {
    e.preventDefault();
    await deleteShortcutGroupFromModal();
    return;
  }

  if (action === 'close-shortcut-modal') {
    e.preventDefault();
    closeShortcutModal();
    return;
  }

  if (action === 'save-shortcut') {
    e.preventDefault();
    await saveShortcutFromModal();
    return;
  }

  if (action === 'delete-shortcut') {
    e.preventDefault();
    await deleteShortcutFromModal();
    return;
  }

  if (action === 'open-settings') {
    e.preventDefault();
    openSettingsPanel();
    return;
  }

  if (action === 'close-settings') {
    e.preventDefault();
    closeSettingsPanel();
    return;
  }

  if (action === 'cancel-settings') {
    e.preventDefault();
    closeSettingsPanel();
    return;
  }

  if (action === 'set-language') {
    const language = actionEl.dataset.value;
    if (!I18N[language]) return;
    draftSettings = { ...draftSettings, language };
    updateSettingsControls();
    return;
  }

  if (action === 'set-color-scheme') {
    e.preventDefault();
    const colorScheme = getValidColorScheme(actionEl.dataset.value);
    draftSettings = { ...draftSettings, colorScheme };
    applyColorScheme(colorScheme);
    updateSettingsControls();
    return;
  }

  if (action === 'set-content-width') {
    e.preventDefault();
    const contentWidth = getValidContentWidth(actionEl.dataset.value);
    draftSettings = { ...draftSettings, contentWidth };
    updateSettingsControls();
    return;
  }

  if (action === 'toggle-new-tab-override') {
    e.preventDefault();
    draftSettings = {
      ...draftSettings,
      replaceChromeNewTab: !draftSettings.replaceChromeNewTab,
    };
    updateSettingsControls();
    return;
  }

  if (action === 'save-settings') {
    e.preventDefault();
    appSettings = { ...DEFAULT_SETTINGS, ...draftSettings };
    await persistSettings(appSettings);
    await refreshLocalizedUI();
    showToast(t('settingsSaved'));
    return;
  }

  if (action === 'refresh-tabs') {
    e.preventDefault();
    await refreshLocalizedUI();
    showToast(t('tabsRefreshed'));
    return;
  }

  if (action === 'refresh-shortcut-icons') {
    e.preventDefault();
    actionEl.disabled = true;
    try {
      const stats = await refreshShortcutIcons({ force: true });
      showToast(t('shortcutIconsRefreshed', stats?.checked || 0, stats?.updated || 0));
    } catch (err) {
      console.warn('[tab-out] Manual shortcut icon refresh failed:', err);
      showToast(t('shortcutIconsRefreshFailed'));
    } finally {
      actionEl.disabled = false;
    }
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast(t('closedExtraTabs'));
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    const tabId  = actionEl.dataset.tabId ? Number(actionEl.dataset.tabId) : null;
    if (!tabUrl) return;

    await closeTabByIdOrUrl(tabId, tabUrl);

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const parentCard = chip.closest('.mission-card');
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        if (parentCard && parentCard.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
          animateCardOut(parentCard);
        }
        document.querySelectorAll('.active-section .mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast(t('tabClosed'));
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    const tabId    = actionEl.dataset.tabId ? Number(actionEl.dataset.tabId) : null;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast(t('failedToSave'));
      return;
    }

    const closed = await closeTabByIdOrUrl(tabId, tabUrl);
    if (closed) playCloseSound();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(t('savedForLaterToast'));
    setTimeout(() => renderStaticDashboard(), 220);
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderStaticDashboard();
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Open a saved tab in a new tab, then remove it from Saved for Later ----
  if (action === 'open-deferred-tab') {
    e.preventDefault();
    e.stopPropagation();
    const id = actionEl.dataset.deferredId;
    const url = actionEl.dataset.deferredUrl || actionEl.getAttribute('href');
    const item = actionEl.closest('.deferred-item');
    await openSavedTabAndRemove(id, url, item);
    return;
  }

  // ---- Remove one saved item from the Open Tabs 2 module ----
  if (action === 'dismiss-open-tabs2-tab') {
    e.preventDefault();
    e.stopPropagation();
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);
    const chip = actionEl.closest('.page-chip');
    const card = actionEl.closest('.mission-card');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        if (card && card.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
          animateCardOut(card);
        }
      }, 200);
    }
    return;
  }

  // ---- Open every saved item in this Open Tabs 2 card, then remove them ----
  if (action === 'open-open-tabs2-card') {
    e.preventDefault();
    e.stopPropagation();
    const card = actionEl.closest('.mission-card');
    const savedTabs = getSavedTabsFromCard(card);
    for (const tab of savedTabs) {
      try {
        await chrome.tabs.create({ url: tab.url, active: false });
      } catch {
        window.open(tab.url, '_blank', 'noopener');
      }
    }
    await dismissSavedTabs(savedTabs.map(tab => tab.id));
    animateCardOut(card);
    return;
  }

  // ---- Remove every saved item in this Open Tabs 2 card without opening them ----
  if (action === 'dismiss-open-tabs2-card') {
    e.preventDefault();
    e.stopPropagation();
    const card = actionEl.closest('.mission-card');
    const savedTabs = getSavedTabsFromCard(card);
    await dismissSavedTabs(savedTabs.map(tab => tab.id));
    animateCardOut(card);
    return;
  }

  // ---- Open every saved tab in this domain card, then remove the card ----
  if (action === 'open-deferred-domain') {
    e.preventDefault();
    e.stopPropagation();
    const savedCard = actionEl.closest('.saved-domain-card');
    await openSavedDomainAndRemove(savedCard);
    return;
  }

  // ---- Remove every saved tab in this domain card without opening them ----
  if (action === 'dismiss-deferred-domain') {
    e.preventDefault();
    e.stopPropagation();
    const savedCard = actionEl.closest('.saved-domain-card');
    await dismissSavedDomain(savedCard);
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    removeDeferredItemFromDOM(item);
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return getGroupActionId(g) === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      document.querySelectorAll(`.active-section .mission-card[data-domain-id="${domainId}"]`).forEach(c => {
        animateCardOut(c);
      });
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? t('homepages') : (group.label || friendlyDomain(group.domain));
    showToast(t('closedFrom', urls.length, groupLabel));

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Save all tabs in a domain group for later ----
  if (action === 'defer-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return getGroupActionId(g) === domainId;
    });
    if (!group) return;

    try {
      const savedCount = await saveTabsForLater(group.tabs);
      const closedCount = await closeTabsByIds(group.tabs);

      if (closedCount > 0 && card) {
        playCloseSound();
        document.querySelectorAll(`.active-section .mission-card[data-domain-id="${domainId}"]`).forEach(c => {
          animateCardOut(c);
        });
      }

      const idx = domainGroups.indexOf(group);
      if (idx !== -1) domainGroups.splice(idx, 1);

      showToast(t('savedTabsForLaterToast', savedCount));
      setTimeout(() => renderStaticDashboard(), 220);

      const statTabs = document.getElementById('statTabs');
      if (statTabs) statTabs.textContent = openTabs.length;
      checkAndShowEmptyState();
    } catch (err) {
      console.error('[tab-out] Failed to save tabs:', err);
      showToast(t('failedToSave'));
    }
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate') || badge.textContent.includes('重复')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast(t('closedDuplicatesToast'));
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    if (!window.confirm(t('confirmCloseAllOpenTabs'))) return;

    const allUrls = openTabs
      .filter(t => t.url && !isBrowserInternalUrl(t.url))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('.active-section .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast(t('allTabsClosed'));
    return;
  }

  // ---- Clear ALL saved-for-later tabs ----
  if (action === 'clear-all-saved-tabs') {
    const { active } = await getSavedTabs();
    if (active.length === 0) return;
    if (!window.confirm(t('confirmClearAllSavedTabs'))) return;

    await dismissSavedTabs(active.map(tab => tab.id));
    document.querySelectorAll('#openTabsMissions2 .mission-card').forEach(c => animateCardOut(c));
    showToast(t('savedTabsCleared'));
    setTimeout(() => renderStaticDashboard(), 220);
    return;
  }

  // ---- Save ALL open tabs for later, then close them ----
  if (action === 'defer-all-open-tabs') {
    const realTabs = getRealTabs();
    if (realTabs.length === 0) return;

    try {
      const savedCount = await saveTabsForLater(realTabs);
      const closedCount = await closeTabsByIds(realTabs);

      if (closedCount > 0) {
        playCloseSound();
        document.querySelectorAll('.active-section .mission-card').forEach(c => {
          shootConfetti(
            c.getBoundingClientRect().left + c.offsetWidth / 2,
            c.getBoundingClientRect().top  + c.offsetHeight / 2
          );
          animateCardOut(c);
        });
      }

      domainGroups = [];
      showToast(t('savedTabsForLaterToast', savedCount));
      setTimeout(() => renderStaticDashboard(), 220);

      const statTabs = document.getElementById('statTabs');
      if (statTabs) statTabs.textContent = openTabs.length;
      checkAndShowEmptyState();
    } catch (err) {
      console.error('[tab-out] Failed to save tabs:', err);
      showToast(t('failedToSave'));
    }
    return;
  }
});

document.addEventListener('submit', handleSearchSubmit);

document.addEventListener('dragover', event => {
  const strip = event.target.closest('#shortcutStrip');
  if (!strip || !activeShortcutDrag) return;
  event.preventDefault();

  if (activeShortcutDrag.type === 'group') {
    const draggingRow = strip.querySelector('.shortcut-group-row.dragging');
    const targetRows = [...strip.querySelectorAll('.shortcut-group-row:not(.dragging)')];
    if (!draggingRow || !targetRows.length) return;

    const reference = targetRows.reduce((closest, row) => {
      const rect = row.getBoundingClientRect();
      const offset = event.clientY - rect.top - rect.height / 2;
      if (offset >= 0 || Math.abs(offset) >= Math.abs(closest.offset)) return closest;
      return { row, offset };
    }, { row: null, offset: Number.NEGATIVE_INFINITY });

    strip.insertBefore(draggingRow, reference.row || null);
    return;
  }

  if (activeShortcutDrag.type !== 'shortcut') return;

  const targetRow = event.target.closest('.shortcut-group-row') || strip.querySelector('.shortcut-group-row');
  const targetList = targetRow?.querySelector('.shortcut-group-list');
  const dragging = strip.querySelector('.shortcut-item.dragging');
  if (!targetList || !dragging) return;

  const reference = getShortcutDropReference(targetList, event.clientX, event.clientY);
  if (!reference?.item) {
    targetList.appendChild(dragging);
  } else if (reference.before) {
    targetList.insertBefore(dragging, reference.item);
  } else {
    targetList.insertBefore(dragging, reference.item.nextSibling);
  }
});

document.addEventListener('drop', async event => {
  const strip = event.target.closest('#shortcutStrip');
  if (!strip || !activeShortcutDrag) return;
  event.preventDefault();

  if (activeShortcutDrag.type === 'group') {
    const orderedRows = [...strip.querySelectorAll('.shortcut-group-row[data-group-index]')];
    const dropIndex = orderedRows.findIndex(row => row.classList.contains('dragging'));
    if (dropIndex !== -1) {
      await reorderSearchShortcutGroups(activeShortcutDrag.groupIndex, dropIndex);
    }
  } else if (activeShortcutDrag.type === 'shortcut') {
    const dragging = strip.querySelector('.shortcut-item.dragging');
    const targetRow = dragging?.closest('.shortcut-group-row');
    const targetGroupIndex = Number.parseInt(targetRow?.dataset.groupIndex || '-1', 10);
    const orderedItems = targetRow ? [...targetRow.querySelectorAll('.shortcut-item[data-shortcut-index]')] : [];
    const dropIndex = orderedItems.findIndex(item => item.classList.contains('dragging'));
    if (dropIndex !== -1 && Number.isInteger(targetGroupIndex)) {
      await moveSearchShortcut(
        activeShortcutDrag.groupIndex,
        activeShortcutDrag.shortcutIndex,
        targetGroupIndex,
        dropIndex
      );
    }
  }

  if (activeShortcutDrag) {
    activeShortcutDrag = null;
    suppressShortcutClick = true;
    setTimeout(() => {
      suppressShortcutClick = false;
    }, 0);
  }
});

document.addEventListener('keydown', async event => {
  if (event.key !== 'Escape') return;
  closeShortcutGroupMenus();
  closeShortcutModal();
  closeShortcutGroupModal();
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${t('noResults')}</div>`;
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[SETTINGS_KEY]?.newValue) {
    appSettings = { ...DEFAULT_SETTINGS, ...changes[SETTINGS_KEY].newValue };
    if (!isSettingsOpen()) draftSettings = { ...appSettings };
    refreshLocalizedUI();
  }

  if (changes[SHORTCUTS_KEY]?.newValue) {
    searchShortcutGroups = normalizeShortcutGroups(changes[SHORTCUTS_KEY].newValue);
    renderSearchShortcuts();
    refreshShortcutIcons();
  }
});

chrome.runtime?.onMessage?.addListener((message) => {
  if (message?.type !== 'TAB_OUT_REFRESH_TABS') return false;

  refreshDashboardFromBackground();
  return false;
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard().then(notifyDashboardReady);
