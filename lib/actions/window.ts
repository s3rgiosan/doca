import type { BrowserPort, PortTab } from '../browser/port';
import { captureTabs } from '../model/capture';
import { parseManagerUrl } from '../model/manager-url';
import { isWorkspaceColor, newWorkspace, nextColor, normalizeUrl, tombstone, type Workspace, type WorkspaceColor } from '../model/workspace';
import { getDeviceId, getSettings, getSkipFallback, setSkipFallback } from '../store/device';
import { markDirty } from '../store/dirty';
import {
  bindWindow,
  forgetDeleted,
  getBindings,
  getDeleted,
  getNotOpened,
  getTabMap,
  rememberDeleted,
  setNotOpened,
  setRestoring,
  setTabIds,
  unbindWindow,
  windowForWorkspace,
} from '../store/session';
import { getWorkspace, listWorkspaces, putWorkspace, removeWorkspace, updateWorkspace } from '../store/workspaces';
import { ensureManagerTab, openSavedTabs, openWorkspace, suspendOpenedTabs } from './open';
import { saveWindow } from './save';
import { switchWindow } from './switch';

/**
 * Saves the tabs of a window as a new workspace and binds the window to it. When the window keeps its
 * pinned tabs, pinned tabs are not saved. Returns the workspace ID.
 */
export async function createFromWindow(
  port: BrowserPort,
  windowId: number,
  name: string,
  now: number,
  color?: WorkspaceColor,
): Promise<string> {
  const chosen = await colorForNew(color);
  const win = await port.getWindow(windowId);
  if (!win) {
    throw new Error(`Window ${windowId} does not exist`);
  }
  const id = crypto.randomUUID();
  const { keepPinnedTabs } = await getSettings();
  const captured = captureTabs(win.tabs, [], await getTabMap(), port.managerBase, () => crypto.randomUUID(), { skipPinned: keepPinnedTabs });
  const ws = newWorkspace({ id, name, deviceId: await getDeviceId(), now, tabs: captured.tabs, color: chosen });
  await putWorkspace(ws, now);
  await setTabIds(captured.tabIds);
  await bindWindow(windowId, id);
  await setSkipFallback(id, false);
  await ensureManagerTab(port, windowId, id);
  return id;
}

/**
 * Creates a workspace with no tabs and returns its ID. With a window, the window switches to it.
 * Without one, it opens in a new window. When no window shows the new workspace after a failure,
 * the workspace is removed and the error goes to the caller.
 */
export async function createEmptyWorkspace(
  port: BrowserPort,
  name: string,
  now: number,
  windowId?: number,
  color?: WorkspaceColor,
): Promise<string> {
  const chosen = await colorForNew(color);
  const id = crypto.randomUUID();
  await putWorkspace(newWorkspace({ id, name, deviceId: await getDeviceId(), now, color: chosen }), now);
  try {
    if (windowId === undefined) {
      await openWorkspace(port, id);
    } else {
      await switchWindow(port, windowId, id, now);
    }
  } catch (error) {
    const shownIn = await windowForWorkspace(id);
    if (shownIn === null) {
      await removeWorkspace(id);
    }
    throw error;
  }
  return id;
}

/**
 * Binds a window to an existing workspace. The window keeps its tabs, and saved tabs that are not in
 * the window open in the background, discarded. Nothing is removed. Saves of the workspace wait
 * until all saved tabs are open.
 */
export async function assignWindow(
  port: BrowserPort,
  windowId: number,
  wsId: string,
  now: number,
): Promise<'assigned' | 'open-elsewhere'> {
  const ws = await getWorkspace(wsId);
  if (!ws || ws.deleted) {
    throw new Error(`Workspace ${wsId} does not exist`);
  }
  const boundWindow = await windowForWorkspace(wsId);
  const openElsewhere = boundWindow !== null && boundWindow !== windowId && (await port.getWindow(boundWindow)) !== null;
  if (openElsewhere) {
    return 'open-elsewhere';
  }
  await setRestoring(wsId, now);
  try {
    await bindWindow(windowId, wsId);
    await setSkipFallback(wsId, false);
    await ensureManagerTab(port, windowId, wsId);
    await openMissingTabs(port, windowId, ws);
  } finally {
    await setRestoring(wsId, null);
  }
  await saveWindow(port, windowId, now);
  return 'assigned';
}

/**
 * Opens the saved tabs of the workspace that the window does not show, in the background. Each tab
 * is discarded after its address commits. Tabs that fail to open stay in the saved list.
 */
export async function openMissingTabs(port: BrowserPort, windowId: number, ws: Workspace): Promise<void> {
  const win = await port.getWindow(windowId);
  if (!win) {
    return;
  }
  const liveUrls = new Set(win.tabs.map((tab) => normalizeUrl(tab.url)));
  const missing = ws.tabs.filter((tab) => !liveUrls.has(normalizeUrl(tab.url)) && !liveUrls.has(normalizeUrl(tab.finalUrl)));
  const { opened, failed } = await openSavedTabs(port, windowId, missing, false);
  await setNotOpened(ws.id, failed, false);
  await suspendOpenedTabs(port, opened);
}

/** Changes the name and, when given, the colour. An unknown colour key changes nothing. */
export async function renameWorkspace(wsId: string, name: string, now: number, color?: WorkspaceColor): Promise<void> {
  if (color !== undefined && !isWorkspaceColor(color)) {
    throw new Error('This colour does not exist.');
  }
  const ws = await getWorkspace(wsId);
  if (!ws || ws.deleted) {
    throw new Error(`Workspace ${wsId} does not exist`);
  }
  await updateWorkspace(
    wsId,
    (current) => (current.deleted ? null : { ...current, name, ...(color === undefined ? {} : { color }) }),
    now,
  );
}

/** Returns the colour that the caller chose, or the first colour that no live workspace uses. An unknown key throws. */
export async function colorForNew(color: WorkspaceColor | undefined): Promise<WorkspaceColor> {
  if (color === undefined) {
    return nextColor(await listWorkspaces());
  }
  if (!isWorkspaceColor(color)) {
    throw new Error('This colour does not exist.');
  }
  return color;
}

/**
 * Deletes the workspace. Its window, if any, is unbound and keeps its tabs open. The record before
 * the delete stays in session storage, so that `restoreWorkspace` can undo the delete.
 */
export async function deleteWorkspace(port: BrowserPort, wsId: string, now: number): Promise<void> {
  const ws = await getWorkspace(wsId);
  if (!ws || ws.deleted) {
    return;
  }
  const windowId = await windowForWorkspace(wsId);
  await rememberDeleted({
    ws,
    windowId,
    skipFallback: (await getSkipFallback()).has(wsId),
    notOpened: [...(await getNotOpened(wsId))],
    deletedAt: now,
  });
  if (windowId !== null) {
    await detachWindow(port, windowId);
  }
  await setSkipFallback(wsId, false);
  await updateWorkspace(wsId, (current) => (current.deleted ? null : tombstone(current, now)), now);
}

/**
 * Restores a deleted workspace with its name, colour and tabs, and returns the
 * ID of the restored workspace. The restored record gets a new ID, so the tombstone of the old ID
 * stays as it is and no merge can pair the two. A window that showed the workspace and still has no
 * workspace is bound again and gets its manager tab back. Otherwise the workspace is restored closed.
 */
export async function restoreWorkspace(port: BrowserPort, wsId: string, now: number): Promise<string> {
  const deleted = await getDeleted(wsId);
  const current = await getWorkspace(wsId);
  if (!deleted || !current || !current.deleted) {
    throw new Error('This workspace can no longer be restored.');
  }
  const id = crypto.randomUUID();
  const restored: Workspace = { ...deleted.ws, id, rev: 0, deleted: false, deletedAt: null };
  await putWorkspace(restored, now);
  await forgetDeleted(wsId);
  if (deleted.notOpened.length > 0) {
    await setNotOpened(id, deleted.notOpened, true);
  }

  const windowId = await freeWindow(port, deleted.windowId);
  if (windowId !== null) {
    await bindWindow(windowId, id);
    await setSkipFallback(id, false);
    await ensureManagerTab(port, windowId, id);
    await markDirty(id, now);
    return id;
  }
  // A workspace whose window closed or now shows another workspace is skipped by the startup
  // overlap fallback, like a workspace whose window the user closed.
  await setSkipFallback(id, deleted.windowId !== null || deleted.skipFallback);
  return id;
}

/** Returns the window when it still exists and shows no workspace, else null. */
async function freeWindow(port: BrowserPort, windowId: number | null): Promise<number | null> {
  if (windowId === null) {
    return null;
  }
  const win = await port.getWindow(windowId);
  const boundTo = (await getBindings()).get(windowId);
  return win && boundTo === undefined ? windowId : null;
}

/** The binding is removed before the manager tab, so the close event does not create the tab again. */
async function detachWindow(port: BrowserPort, windowId: number): Promise<void> {
  await unbindWindow(windowId);
  const win = await port.getWindow(windowId);
  const managers = (win?.tabs ?? []).filter((tab: PortTab) => parseManagerUrl(port.managerBase, tab.url) !== null);
  if (managers.length > 0) {
    await port.removeTabs(managers.map((tab) => tab.id));
  }
}
