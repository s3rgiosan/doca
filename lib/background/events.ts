import { ensureManagerTab } from '../actions/open';
import { openMissingTabs } from '../actions/window';
import type { BrowserPort, PortTab } from '../browser/port';
import { planStartupBindings } from '../binding/startup';
import { parseManagerUrl } from '../model/manager-url';
import { pickTabsToDiscard } from '../suspend/pick';
import { getSettings, getSkipFallback, setSkipFallback } from '../store/device';
import { markDirty } from '../store/dirty';
import {
  bindWindow,
  forgetTabIds,
  getBindings,
  getTabMap,
  isStartupDone,
  markStartupDone,
  setTabIds,
  unbindWindow,
  windowForWorkspace,
} from '../store/session';
import { getWorkspace, listWorkspaces } from '../store/workspaces';

/** Schedules a save of the window's workspace. Nothing is saved before startup binding is done. */
export async function onTabChanged(_port: BrowserPort, windowId: number, now: number): Promise<void> {
  const startupDone = await isStartupDone();
  if (!startupDone) {
    return;
  }
  const wsId = (await getBindings()).get(windowId);
  if (wsId !== undefined) {
    await markDirty(wsId, now);
  }
}

/**
 * A tab that closes with its window does not change the saved list. A bound window that lost its
 * manager tab gets it back.
 */
export async function onTabRemoved(
  port: BrowserPort,
  tabId: number,
  info: { windowId: number; isWindowClosing: boolean },
  now: number,
): Promise<void> {
  await forgetTabIds([tabId]);
  if (info.isWindowClosing) {
    return;
  }
  const wsId = (await getBindings()).get(info.windowId);
  if (wsId === undefined) {
    return;
  }
  await ensureManagerTab(port, info.windowId, wsId);
  await onTabChanged(port, info.windowId, now);
}

/**
 * A manager tab dragged to another window goes back to its own window. When that window is closed,
 * the rules for a new manager tab apply. Other tabs save the new window.
 */
export async function onTabAttached(port: BrowserPort, tabId: number, newWindowId: number, now: number): Promise<void> {
  const tab = (await port.getWindow(newWindowId))?.tabs.find((t) => t.id === tabId);
  const wsId = tab ? parseManagerUrl(port.managerBase, tab.url) : null;
  if (!tab || wsId === null) {
    await onTabChanged(port, newWindowId, now);
    return;
  }
  const home = await windowForWorkspace(wsId);
  if (home !== null && home !== newWindowId && (await port.getWindow(home)) !== null) {
    await port.moveTabs([tabId], home, 0);
    await ensureManagerTab(port, home, wsId);
    return;
  }
  await onManagerTabSeen(port, tab);
}

/**
 * Closing a window keeps the workspace and its saved list. The startup overlap fallback then skips
 * the workspace, so a later window with some of the same URLs does not take it over. The window is
 * gone when this runs, so a tab change that is still in the save debounce is not saved.
 */
export async function onWindowRemoved(windowId: number): Promise<void> {
  const wsId = (await getBindings()).get(windowId);
  await unbindWindow(windowId);
  if (wsId !== undefined) {
    await setSkipFallback(wsId, true);
  }
}

/**
 * A manager tab that shows up in an unbound window binds that window, for example after the browser
 * restores a closed window. A manager tab for a workspace that another window owns is removed. A
 * window that already shows the workspace keeps one manager tab.
 */
export async function onManagerTabSeen(port: BrowserPort, tab: PortTab): Promise<void> {
  const wsId = parseManagerUrl(port.managerBase, tab.url);
  if (wsId === null) {
    return;
  }
  // One read of the bindings. openWorkspace binds the new window while this runs, and a second read
  // would show the tab's own window as the home of another window.
  const bindings = await getBindings();
  const windowWs = bindings.get(tab.windowId);
  if (windowWs === wsId) {
    // A reopened manager tab can be a second one in the window, so the extra copy is removed.
    await ensureManagerTab(port, tab.windowId, wsId);
    return;
  }
  const ws = await getWorkspace(wsId);
  const home = [...bindings].find(([, bound]) => bound === wsId)?.[0] ?? null;
  const homeIsOpen = home !== null && home !== tab.windowId && (await port.getWindow(home)) !== null;
  if (!ws || ws.deleted || homeIsOpen || windowWs !== undefined) {
    await port.removeTabs([tab.id]);
    return;
  }
  await bindWindow(tab.windowId, wsId);
  await ensureManagerTab(port, tab.windowId, wsId);
}

/**
 * Binds windows after a browser start, then allows saves. A failure on one tab or window is logged
 * and does not stop the startup, because saves wait for it.
 */
export async function runStartup(port: BrowserPort, now: number): Promise<void> {
  const windows = await port.getWindows();
  const workspaces = await listWorkspaces({ includeDeleted: true });
  const { keepPinnedTabs } = await getSettings();
  const plan = planStartupBindings(windows, workspaces, await getSkipFallback(), port.managerBase, keepPinnedTabs);
  for (const [windowId, wsId] of plan.bindings) {
    await bindWindow(windowId, wsId);
  }
  for (const tabId of plan.staleManagerTabs) {
    await logFailure(`remove the stale manager tab ${tabId}`, () => port.removeTabs([tabId]));
  }
  const byId = new Map(workspaces.map((ws) => [ws.id, ws]));
  for (const [windowId, wsId] of plan.bindings) {
    await logFailure(`add the manager tab to window ${windowId}`, () => ensureManagerTab(port, windowId, wsId));
    const ws = byId.get(wsId);
    if (ws && plan.byOverlap.has(windowId)) {
      await logFailure(`merge the saved tabs into window ${windowId}`, () => openMissingTabs(port, windowId, ws));
    }
  }
  await markStartupDone();
  for (const wsId of plan.bindings.values()) {
    await markDirty(wsId, now);
  }
}

/** Discards idle tabs in every window. */
export async function runSuspend(port: BrowserPort, now: number): Promise<void> {
  const windows = await port.getWindows();
  const tabs = windows.flatMap((win) => win.tabs);
  const ids = pickTabsToDiscard(tabs, { now, managerBase: port.managerBase, settings: await getSettings() });
  for (const id of ids) {
    try {
      const discarded = await port.discardTab(id);
      // The discard can give the tab a new ID, so the saved tab ID moves to it.
      if (discarded && discarded.id !== id) {
        const savedId = (await getTabMap()).get(id);
        if (savedId !== undefined) {
          await setTabIds([[discarded.id, savedId]]);
        }
        await forgetTabIds([id]);
      }
    } catch (error) {
      console.warn(`Doca could not suspend tab ${id}`, error);
    }
  }
}

async function logFailure(action: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn(`Doca could not ${action}`, error);
  }
}
