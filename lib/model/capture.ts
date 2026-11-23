import { parseManagerUrl } from './manager-url';
import { normalizeUrl, type SavedTab } from './workspace';

export interface LiveTab {
  id: number;
  index: number;
  url: string;
  title: string;
  pinned: boolean;
}

export interface CaptureResult {
  tabs: SavedTab[];
  /** Browser tab ID to saved tab ID, for every tab in `tabs`. */
  tabIds: Array<[number, string]>;
}

/** Options for `captureTabs`. */
export interface CaptureOptions {
  /** When true, pinned tabs are left out, because they belong to the window. */
  skipPinned?: boolean;
}

/**
 * Turns the tabs of a window into a saved list. The manager tab is left out. With `skipPinned`, pinned
 * tabs are left out too.
 * A tab keeps its saved ID when the tab map names it. After a restart the map is empty, so a tab then
 * claims the first unclaimed saved tab with the same normalized URL.
 */
export function captureTabs(
  live: LiveTab[],
  previous: SavedTab[],
  tabMap: Map<number, string>,
  managerBase: string,
  newId: () => string,
  options: CaptureOptions = {},
): CaptureResult {
  const byId = new Map(previous.map((tab) => [tab.id, tab]));
  // Saved tabs named by the map are reserved first, so a URL match cannot take them from their own tab.
  const reserved = new Set<string>();
  for (const tab of live) {
    const mappedId = tabMap.get(tab.id);
    if (mappedId !== undefined && byId.has(mappedId)) {
      reserved.add(mappedId);
    }
  }
  const claimed = new Set<string>();
  const tabs: SavedTab[] = [];
  const tabIds: Array<[number, string]> = [];
  const ordered = [...live].sort((a, b) => a.index - b.index);

  for (const tab of ordered) {
    const managerWs = parseManagerUrl(managerBase, tab.url);
    if (managerWs !== null || (options.skipPinned && tab.pinned)) {
      continue;
    }
    const match = findSaved(tab, byId, previous, tabMap, claimed, reserved);
    const id = match ? match.id : newId();
    claimed.add(id);
    tabs.push({
      id,
      url: match ? match.url : tab.url,
      // A tab that has not committed yet has no URL, so the saved URL stays.
      finalUrl: tab.url || (match ? match.finalUrl : ''),
      title: tab.title,
      pinned: tab.pinned,
      index: tabs.length,
    });
    tabIds.push([tab.id, id]);
  }
  return { tabs, tabIds };
}

function findSaved(
  tab: LiveTab,
  byId: Map<string, SavedTab>,
  previous: SavedTab[],
  tabMap: Map<number, string>,
  claimed: Set<string>,
  reserved: Set<string>,
): SavedTab | undefined {
  const mappedId = tabMap.get(tab.id);
  const mapped = mappedId === undefined ? undefined : byId.get(mappedId);
  if (mapped && !claimed.has(mapped.id)) {
    return mapped;
  }
  const url = normalizeUrl(tab.url);
  return previous.find(
    (saved) => !claimed.has(saved.id) && !reserved.has(saved.id) && (normalizeUrl(saved.url) === url || normalizeUrl(saved.finalUrl) === url),
  );
}

export function sameTabs(a: SavedTab[], b: SavedTab[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((tab, i) => {
    const other = b[i]!;
    return (
      tab.id === other.id &&
      tab.finalUrl === other.finalUrl &&
      tab.title === other.title &&
      tab.pinned === other.pinned &&
      tab.index === other.index
    );
  });
}
