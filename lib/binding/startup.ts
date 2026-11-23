import type { PortWindow } from '../browser/port';
import { parseManagerUrl } from '../model/manager-url';
import { normalizeUrl, type Workspace } from '../model/workspace';

/** The smallest URL overlap that binds a window with no manager tab to a workspace. */
export const OVERLAP_THRESHOLD = 0.5;

export function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return 0;
  }
  let common = 0;
  for (const item of a) {
    if (b.has(item)) {
      common++;
    }
  }
  return common / union;
}

export interface StartupPlan {
  /** Window ID to workspace ID. */
  bindings: Map<number, string>;
  /** Manager tabs to remove: extra ones, and ones that name a deleted, unknown or already bound workspace. */
  staleManagerTabs: number[];
  /** Windows bound by URL overlap. Their saved tabs are merged in, because the window can hold only some of them. */
  byOverlap: Set<number>;
}

/**
 * Decides which window belongs to which workspace after a browser start.
 * A manager tab binds its window first. Windows with no valid manager tab then bind by URL overlap.
 * With `skipPinned`, pinned tabs belong to the window, so the overlap leaves them out.
 */
export function planStartupBindings(
  windows: PortWindow[],
  workspaces: Workspace[],
  skipFallback: Set<string>,
  managerBase: string,
  skipPinned = false,
): StartupPlan {
  const live = new Map(workspaces.filter((ws) => !ws.deleted).map((ws) => [ws.id, ws]));
  const bindings = new Map<number, string>();
  const boundWorkspaces = new Set<string>();
  const staleManagerTabs: number[] = [];
  const ordered = [...windows].sort((a, b) => a.id - b.id);

  for (const win of ordered) {
    for (const tab of win.tabs) {
      const wsId = parseManagerUrl(managerBase, tab.url);
      if (wsId === null) {
        continue;
      }
      const canBind = !bindings.has(win.id) && live.has(wsId) && !boundWorkspaces.has(wsId);
      if (canBind) {
        bindings.set(win.id, wsId);
        boundWorkspaces.add(wsId);
      } else {
        staleManagerTabs.push(tab.id);
      }
    }
  }

  const candidates = [...live.values()].filter((ws) => !boundWorkspaces.has(ws.id) && !skipFallback.has(ws.id));
  const pairs = overlapPairs(
    ordered.filter((win) => !bindings.has(win.id)),
    candidates,
    managerBase,
    skipPinned,
  );
  const byOverlap = new Set<number>();
  for (const pair of pairs) {
    if (!bindings.has(pair.windowId) && !boundWorkspaces.has(pair.wsId)) {
      bindings.set(pair.windowId, pair.wsId);
      boundWorkspaces.add(pair.wsId);
      byOverlap.add(pair.windowId);
    }
  }
  return { bindings, staleManagerTabs, byOverlap };
}

interface Pair {
  windowId: number;
  wsId: string;
  score: number;
}

/** The best workspace of each window, when it reaches the threshold and no other workspace ties it. Highest score first. */
function overlapPairs(windows: PortWindow[], workspaces: Workspace[], managerBase: string, skipPinned: boolean): Pair[] {
  const savedUrls = workspaces.map((ws) => ({
    id: ws.id,
    urls: new Set(ws.tabs.map((tab) => normalizeUrl(tab.finalUrl || tab.url))),
  }));
  const pairs: Pair[] = [];
  for (const win of windows) {
    const urls = new Set(
      win.tabs
        .filter((tab) => parseManagerUrl(managerBase, tab.url) === null && !(skipPinned && tab.pinned))
        .map((tab) => normalizeUrl(tab.url)),
    );
    const scores = savedUrls.map((ws) => ({ wsId: ws.id, score: jaccard(urls, ws.urls) }));
    const best = Math.max(0, ...scores.map((s) => s.score));
    const top = scores.filter((s) => s.score === best);
    if (best >= OVERLAP_THRESHOLD && top.length === 1) {
      pairs.push({ windowId: win.id, wsId: top[0]!.wsId, score: best });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}
