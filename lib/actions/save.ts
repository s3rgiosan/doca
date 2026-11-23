import type { BrowserPort } from '../browser/port';
import { captureTabs, sameTabs, type CaptureResult } from '../model/capture';
import { getSettings } from '../store/device';
import { markDirty, takeDue } from '../store/dirty';
import { getBindings, getNotOpened, getTabMap, isRestoring, isStartupDone, setTabIds, windowForWorkspace } from '../store/session';
import { updateWorkspace } from '../store/workspaces';

/**
 * Saves the tabs of a bound window into its workspace. It does nothing before startup binding is
 * done, while the workspace is being restored, or when the tabs did not change. Saved tabs that could
 * not open stay at the end of the list. When the window keeps its pinned tabs, pinned tabs are not saved.
 */
export async function saveWindow(port: BrowserPort, windowId: number, now: number): Promise<void> {
  const startupDone = await isStartupDone();
  if (!startupDone) {
    return;
  }
  const wsId = (await getBindings()).get(windowId);
  if (wsId === undefined || (await isRestoring(wsId, now))) {
    return;
  }
  const win = await port.getWindow(windowId);
  if (!win) {
    return;
  }
  const tabMap = await getTabMap();
  const notOpened = await getNotOpened(wsId);
  const { keepPinnedTabs } = await getSettings();
  let captured: CaptureResult | null = null;
  await updateWorkspace(
    wsId,
    (ws) => {
      if (ws.deleted) {
        return null;
      }
      captured = captureTabs(win.tabs, ws.tabs, tabMap, port.managerBase, () => crypto.randomUUID(), { skipPinned: keepPinnedTabs });
      const liveIds = new Set(captured.tabs.map((tab) => tab.id));
      const kept = ws.tabs.filter((tab) => notOpened.has(tab.id) && !liveIds.has(tab.id));
      const tabs = [...captured.tabs, ...kept].map((tab, index) => ({ ...tab, index }));
      return sameTabs(tabs, ws.tabs) ? null : { ...ws, tabs };
    },
    now,
  );
  if (captured) {
    await setTabIds((captured as CaptureResult).tabIds);
  }
}

/**
 * Saves every workspace whose debounced save is due. A workspace whose save fails is logged and
 * marked due again, and the other workspaces still save.
 */
export async function flushDue(port: BrowserPort, now: number): Promise<void> {
  for (const wsId of await takeDue(now)) {
    try {
      const windowId = await windowForWorkspace(wsId);
      if (windowId !== null) {
        await saveWindow(port, windowId, now);
      }
    } catch (error) {
      console.warn(`Doca could not save workspace ${wsId}`, error);
      await markDirty(wsId, now);
    }
  }
}
