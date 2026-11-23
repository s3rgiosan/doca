import { describe, expect, it } from 'vitest';
import type { PortTab, PortWindow } from '@/lib/browser/port';
import { jaccard, planStartupBindings } from '@/lib/binding/startup';
import { managerUrl } from '@/lib/model/manager-url';
import { newWorkspace, tombstone, type SavedTab } from '@/lib/model/workspace';

const base = 'chrome-extension://abc/manager.html';
let nextTab = 1;
const tab = (windowId: number, url: string): PortTab => ({
  id: nextTab++,
  windowId,
  index: 0,
  url,
  title: url,
  pinned: false,
  active: false,
  audible: false,
  discarded: false,
});
const win = (id: number, urls: string[]): PortWindow => ({
  id,
  focused: false,
  minimized: false,
  tabs: urls.map((url, index) => ({ ...tab(id, url), index })),
});
const saved = (urls: string[]): SavedTab[] =>
  urls.map((url, index) => ({ id: `s${index}`, url, finalUrl: url, title: url, pinned: false, index }));
const ws = (id: string, urls: string[] = []) => newWorkspace({ id, name: id, deviceId: 'd', now: 0, tabs: saved(urls) });

describe('jaccard', () => {
  it('gives 0 for two empty sets', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('gives the share of common items', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });
});

describe('planStartupBindings', () => {
  it('binds a window by its manager tab', () => {
    const plan = planStartupBindings([win(1, [managerUrl(base, 'a'), 'https://x.test/'])], [ws('a')], new Set(), base);
    expect([...plan.bindings]).toEqual([[1, 'a']]);
    expect(plan.staleManagerTabs).toEqual([]);
  });

  it('marks a manager tab of a deleted workspace as stale', () => {
    const w = win(1, [managerUrl(base, 'a')]);
    const plan = planStartupBindings([w], [tombstone(ws('a'), 1)], new Set(), base);
    expect(plan.bindings.size).toBe(0);
    expect(plan.staleManagerTabs).toEqual([w.tabs[0]!.id]);
  });

  it('binds the lower window ID when two windows carry the same manager tab', () => {
    const w2 = win(2, [managerUrl(base, 'a')]);
    const w1 = win(1, [managerUrl(base, 'a'), managerUrl(base, 'a')]);
    const plan = planStartupBindings([w2, w1], [ws('a')], new Set(), base);
    expect([...plan.bindings]).toEqual([[1, 'a']]);
    expect(plan.staleManagerTabs.sort()).toEqual([w1.tabs[1]!.id, w2.tabs[0]!.id].sort());
  });

  it('binds by overlap at or above 0.5', () => {
    const plan = planStartupBindings(
      [win(1, ['https://a.test/', 'https://b.test/']), win(2, ['https://c.test/', 'https://z.test/', 'https://y.test/'])],
      [ws('two-thirds', ['https://a.test/', 'https://b.test/', 'https://q.test/']), ws('one-third', ['https://c.test/', 'https://r.test/'])],
      new Set(),
      base,
    );
    expect([...plan.bindings]).toEqual([[1, 'two-thirds']]);
  });

  it('binds at exactly 0.5', () => {
    const plan = planStartupBindings([win(1, ['https://a.test/'])], [ws('a', ['https://a.test/', 'https://b.test/'])], new Set(), base);
    expect([...plan.bindings]).toEqual([[1, 'a']]);
  });

  it('leaves a window unbound when two workspaces tie', () => {
    const plan = planStartupBindings(
      [win(1, ['https://a.test/'])],
      [ws('a', ['https://a.test/']), ws('b', ['https://a.test/'])],
      new Set(),
      base,
    );
    expect(plan.bindings.size).toBe(0);
  });

  it('binds each workspace to one window at most, best score first', () => {
    const plan = planStartupBindings(
      [win(1, ['https://a.test/', 'https://z.test/']), win(2, ['https://a.test/', 'https://b.test/'])],
      [ws('a', ['https://a.test/', 'https://b.test/'])],
      new Set(),
      base,
    );
    expect([...plan.bindings]).toEqual([[2, 'a']]);
  });

  it('skips flagged workspaces in the overlap fallback only', () => {
    const plan = planStartupBindings(
      [win(1, ['https://a.test/']), win(2, [managerUrl(base, 'b')])],
      [ws('a', ['https://a.test/']), ws('b', ['https://b.test/'])],
      new Set(['a', 'b']),
      base,
    );
    expect([...plan.bindings]).toEqual([[2, 'b']]);
  });

  it('leaves the manager tab out of the overlap', () => {
    const plan = planStartupBindings(
      [win(1, [managerUrl(base, 'gone'), 'https://a.test/'])],
      [ws('a', ['https://a.test/'])],
      new Set(),
      base,
    );
    expect([...plan.bindings]).toEqual([[1, 'a']]);
  });
});

describe('planStartupBindings with pinned tabs kept by the window', () => {
  it('leaves pinned tabs out of the overlap', () => {
    const w = win(1, ['https://mail.test/', 'https://chat.test/', 'https://a.test/']);
    w.tabs[0]!.pinned = true;
    w.tabs[1]!.pinned = true;
    expect(planStartupBindings([w], [ws('a', ['https://a.test/'])], new Set(), base, true).bindings.get(1)).toBe('a');
    expect(planStartupBindings([w], [ws('a', ['https://a.test/'])], new Set(), base).bindings.has(1)).toBe(false);
  });
});
