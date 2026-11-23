import type { BrowserPort, PortTab } from '../browser/port';
import { managerTabWorkspace, managerUrl, parseManagerUrl } from '../model/manager-url';
import { normalizeUrl, type SavedTab } from '../model/workspace';
import { getSettings, getSkipFallback, setSkipFallback } from '../store/device';
import { markDirty } from '../store/dirty';
import {
  bindWindow,
  forgetTabIds,
  getBindings,
  getTabMap,
  isRestoring,
  isStartupDone,
  setNotOpened,
  setRestoring,
} from '../store/session';
import { getWorkspace } from '../store/workspaces';
import { addToSavedList } from './move';
import { ensureManagerTab, openSavedTabs, suspendOpenedTabs, switchToWorkspace } from './open';
import { saveWindow } from './save';

/**
 * Shows another workspace in this window. The current workspace is saved first, and its tabs close
 * only after that save succeeds. A workspace that is open in another window gets the focus instead.
 * A window with no workspace keeps its tabs, and the workspace opens in a new window.
 *
 * When the window keeps its pinned tabs, the pinned tabs stay open. A pinned saved tab of the new
 * workspace does not open when a pinned tab with the same address is already open.
 *
 * When a step fails before the old tabs close, the window shows the old workspace again and the new
 * tabs close. When a step fails after that, the window keeps the new workspace. In both cases the
 * error goes to the caller.
 */
export async function switchWindow(port: BrowserPort, windowId: number, targetWsId: string, now: number): Promise<void> {
  const target = await getWorkspace(targetWsId);
  if (!target || target.deleted) {
    throw new Error('This workspace does not exist.');
  }
  const bindings = await getBindings();
  const sourceWsId = bindings.get(windowId);
  if (sourceWsId === targetWsId) {
    return;
  }
  const win = await port.getWindow(windowId);
  if (sourceWsId === undefined || !win) {
    await switchToWorkspace(port, targetWsId);
    return;
  }
  for (const [otherWindow, wsId] of bindings) {
    if (wsId === targetWsId && otherWindow !== windowId && (await port.getWindow(otherWindow)) !== null) {
      await port.focusWindow(otherWindow);
      return;
    }
  }

  // A save that cannot run would lose the tabs of the current workspace, so the switch stops.
  const startupDone = await isStartupDone();
  const sourceOpening = await isRestoring(sourceWsId, now);
  if (!startupDone || sourceOpening) {
    throw new Error('This workspace is still opening. Try again in a moment.');
  }
  await saveWindow(port, windowId, now);

  const { keepPinnedTabs } = await getSettings();
  const current = (await port.getWindow(windowId))?.tabs ?? win.tabs;
  const managerId = current.find((tab) => parseManagerUrl(port.managerBase, tab.url) === sourceWsId)?.id;
  const targetSkipped = (await getSkipFallback()).has(targetWsId);
  const createdIds: number[] = [];
  let sourceClosed = false;
  await setRestoring(targetWsId, now);
  try {
    await bindWindow(windowId, targetWsId);
    await setSkipFallback(sourceWsId, true);
    await setSkipFallback(targetWsId, false);

    // The window keeps its manager tab, which loads the other workspace.
    const targetUrl = managerUrl(port.managerBase, targetWsId);
    if (managerId !== undefined) {
      await port.navigateTab(managerId, targetUrl);
    } else {
      await port.createTab({ windowId, url: targetUrl, index: 0, pinned: true, active: false });
    }
    const toOpen = keepPinnedTabs ? withoutOpenPinned(target.tabs, current, port.managerBase) : target.tabs;
    const { opened, failed } = await openSavedTabs(port, windowId, toOpen, true);
    createdIds.push(...opened.map((entry) => entry.tab.id));
    await setNotOpened(targetWsId, failed, true);

    // The old tabs close before the wait for the new addresses, so a change in an old tab cannot reach the new workspace.
    const closing = await sourceTabsToClose(port, windowId, sourceWsId, new Set(createdIds), keepPinnedTabs, now);
    await removeLiveTabs(port, windowId, closing);
    sourceClosed = true;
    await forgetTabIds(closing);
    await suspendOpenedTabs(port, opened);
  } catch (error) {
    if (!sourceClosed) {
      await rollBack(port, { windowId, sourceWsId, targetWsId, managerId, createdIds, targetSkipped });
    }
    throw error;
  } finally {
    await logFailure(`clear the restore flag of ${targetWsId}`, () => setRestoring(targetWsId, null));
    await logFailure(`schedule a save of ${targetWsId}`, () => markDirty(targetWsId, now));
  }
}

/**
 * Returns the saved tabs without each pinned saved tab whose address is already open in a pinned tab
 * of the window. The manager tab does not count.
 */
function withoutOpenPinned(saved: SavedTab[], live: PortTab[], managerBase: string): SavedTab[] {
  const openPinned = new Set(
    live.filter((tab) => tab.pinned && managerTabWorkspace(managerBase, tab) === null).map((tab) => normalizeUrl(tab.url)),
  );
  return saved.filter((tab) => !tab.pinned || !openPinned.has(normalizeUrl(tab.finalUrl || tab.url)));
}

/**
 * Returns the IDs of the old workspace's tabs that are still in the window. A tab that is not in the
 * old workspace's saved list opened after the save, so it is added to that list first. A tab with no
 * address cannot be saved, so it stays in the window. With `keepPinned`, pinned tabs stay in the window.
 */
async function sourceTabsToClose(
  port: BrowserPort,
  windowId: number,
  sourceWsId: string,
  keep: Set<number>,
  keepPinned: boolean,
  now: number,
): Promise<number[]> {
  const tabs = ((await port.getWindow(windowId))?.tabs ?? []).filter(
    (tab) => !keep.has(tab.id) && !(keepPinned && tab.pinned) && managerTabWorkspace(port.managerBase, tab) === null,
  );
  const savedIds = new Set(((await getWorkspace(sourceWsId))?.tabs ?? []).map((tab) => tab.id));
  const tabMap = await getTabMap();
  const isSaved = (tab: PortTab) => savedIds.has(tabMap.get(tab.id) ?? '');
  const late = tabs.filter((tab) => !isSaved(tab) && tab.url !== '');
  if (late.length > 0) {
    await addToSavedList(sourceWsId, late, now);
  }
  return tabs.filter((tab) => isSaved(tab) || tab.url !== '').map((tab) => tab.id);
}

/**
 * Closes the tabs that are still in the window. The browser closes no tab when one ID is already
 * closed, so each attempt reads the window again. One retry covers a tab that closes between the
 * read and the call.
 */
async function removeLiveTabs(port: BrowserPort, windowId: number, tabIds: number[]): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const live = new Set(((await port.getWindow(windowId))?.tabs ?? []).map((tab) => tab.id));
    const open = tabIds.filter((id) => live.has(id));
    if (open.length === 0) {
      return;
    }
    try {
      await port.removeTabs(open);
      return;
    } catch (error) {
      if (attempt >= 1) {
        throw error;
      }
    }
  }
}

interface RollBackState {
  windowId: number;
  sourceWsId: string;
  targetWsId: string;
  managerId: number | undefined;
  createdIds: number[];
  targetSkipped: boolean;
}

/**
 * Shows the old workspace again after a switch failed before the old tabs closed. The new tabs
 * close, because the saved list of the new workspace still holds them. Each step runs even when
 * an earlier step fails.
 */
async function rollBack(port: BrowserPort, state: RollBackState): Promise<void> {
  const { windowId, sourceWsId, targetWsId, managerId, createdIds, targetSkipped } = state;
  await logFailure('close the tabs of the new workspace', () => removeLiveTabs(port, windowId, createdIds));
  await logFailure(`bind window ${windowId} to ${sourceWsId} again`, () => bindWindow(windowId, sourceWsId));
  await logFailure(`restore the fallback flag of ${sourceWsId}`, () => setSkipFallback(sourceWsId, false));
  await logFailure(`restore the fallback flag of ${targetWsId}`, () => setSkipFallback(targetWsId, targetSkipped));
  if (managerId !== undefined) {
    await logFailure('point the manager tab at the old workspace', async () => {
      const tab = (await port.getWindow(windowId))?.tabs.find((t) => t.id === managerId);
      const shown = tab ? managerTabWorkspace(port.managerBase, tab) : null;
      if (tab && shown !== sourceWsId) {
        await port.navigateTab(managerId, managerUrl(port.managerBase, sourceWsId));
      }
    });
  }
  await logFailure(`check the manager tab of window ${windowId}`, () => ensureManagerTab(port, windowId, sourceWsId));
}

async function logFailure(action: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn(`Doca could not ${action}`, error);
  }
}
