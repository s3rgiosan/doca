import { parseManagerUrl } from '../model/manager-url';
import type { Workspace } from '../model/workspace';

export interface SidebarGroups {
  /** Workspaces with a window on this device. */
  open: Workspace[];
  closed: Workspace[];
  /** Ids of the shown workspaces that do not match the query. Only the current workspace can be one. */
  unmatched: Set<string>;
}

const byName = (a: Workspace, b: Workspace) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Groups the workspaces by whether they are open. The workspace `currentId` stays in the list when it does not match. */
export function sidebarGroups(workspaces: Workspace[], bound: Set<string>, query: string, currentId?: string): SidebarGroups {
  const text = query.trim().toLowerCase();
  const matches = (ws: Workspace) => ws.name.toLowerCase().includes(text);
  const shown = workspaces.filter((ws) => matches(ws) || ws.id === currentId).sort(byName);
  return {
    open: shown.filter((ws) => bound.has(ws.id)),
    closed: shown.filter((ws) => !bound.has(ws.id)),
    unmatched: new Set(shown.filter((ws) => !matches(ws)).map((ws) => ws.id)),
  };
}

export function filterTabs<T extends { title: string; url: string }>(tabs: T[], query: string): T[] {
  const text = query.trim().toLowerCase();
  if (text === '') {
    return tabs;
  }
  return tabs.filter((tab) => tab.title.toLowerCase().includes(text) || tab.url.toLowerCase().includes(text));
}

/** The text that names a tab: its title, or its URL when the title is empty. */
export function tabLabel(tab: { title: string; url: string }): string {
  return tab.title.trim() === '' ? tab.url : tab.title;
}

/** The tabs of a workspace window, without its manager tab. */
export function withoutManager<T extends { url: string }>(tabs: T[], managerBase: string): T[] {
  return tabs.filter((tab) => parseManagerUrl(managerBase, tab.url) === null);
}

/** What the main area of the manager page shows. */
export type MainView = 'workspace' | 'no-workspaces' | 'deleted';

/**
 * Picks the main view for the page of workspace `wsId`. With no workspace at all, the page offers to
 * make one, also when its own workspace was deleted.
 */
export function mainView(workspaces: Workspace[], wsId: string): MainView {
  const live = workspaces.filter((ws) => !ws.deleted);
  if (live.some((ws) => ws.id === wsId)) {
    return 'workspace';
  }
  return live.length === 0 ? 'no-workspaces' : 'deleted';
}
