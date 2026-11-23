import { describe, expect, it } from 'vitest';
import { captureTabs, sameTabs, type LiveTab } from '@/lib/model/capture';
import type { SavedTab } from '@/lib/model/workspace';

const base = 'chrome-extension://abc/manager.html';
const manager: LiveTab = { id: 1, index: 0, url: `${base}?ws=w1`, title: 'W1', pinned: true };
const live = (id: number, index: number, url: string, title = `T${id}`): LiveTab => ({ id, index, url, title, pinned: false });
const saved = (id: string, url: string, index: number, finalUrl = url): SavedTab => ({ id, url, finalUrl, title: id, pinned: false, index });

function ids() {
  let n = 0;
  return () => `new${++n}`;
}

describe('captureTabs', () => {
  it('drops the manager tab and indexes the rest from 0', () => {
    const result = captureTabs([manager, live(2, 1, 'https://a.test/'), live(3, 2, 'https://b.test/')], [], new Map(), base, ids());
    expect(result.tabs.map((t) => [t.id, t.index])).toEqual([
      ['new1', 0],
      ['new2', 1],
    ]);
    expect(result.tabIds).toEqual([
      [2, 'new1'],
      [3, 'new2'],
    ]);
  });

  it('keeps the saved ID and the original URL of a mapped tab', () => {
    const previous = [saved('s1', 'https://a.test/start', 0)];
    const result = captureTabs([live(2, 0, 'https://a.test/end')], previous, new Map([[2, 's1']]), base, ids());
    expect(result.tabs[0]).toMatchObject({ id: 's1', url: 'https://a.test/start', finalUrl: 'https://a.test/end' });
  });

  it('matches by normalized URL when the map is empty, one saved tab per live tab', () => {
    const previous = [saved('s1', 'https://a.test/', 0), saved('s2', 'https://a.test/', 1), saved('s3', 'https://x.test/', 2, 'https://b.test/#top')];
    const result = captureTabs(
      [live(7, 0, 'https://A.test/'), live(8, 1, 'https://a.test/'), live(9, 2, 'https://b.test/')],
      previous,
      new Map(),
      base,
      ids(),
    );
    expect(result.tabs.map((t) => t.id)).toEqual(['s1', 's2', 's3']);
  });

  it('ignores a mapped ID that is not in the previous list', () => {
    const result = captureTabs([live(2, 0, 'https://a.test/')], [], new Map([[2, 'gone']]), base, ids());
    expect(result.tabs[0]!.id).toBe('new1');
  });
});

describe('captureTabs skipPinned', () => {
  it('leaves out pinned tabs with skipPinned', () => {
    const tabs = [manager, { ...live(2, 1, 'https://mail.test/'), pinned: true }, live(3, 2, 'https://a.test/')];
    const skipped = captureTabs(tabs, [], new Map(), base, ids(), { skipPinned: true });
    expect(skipped.tabs.map((t) => [t.url, t.index])).toEqual([['https://a.test/', 0]]);
    expect(skipped.tabIds).toEqual([[3, 'new1']]);
    const all = captureTabs(tabs, [], new Map(), base, ids());
    expect(all.tabs.map((t) => t.url)).toEqual(['https://mail.test/', 'https://a.test/']);
  });
});

describe('sameTabs', () => {
  it('compares the saved fields in order', () => {
    const a = [saved('s1', 'https://a.test/', 0)];
    expect(sameTabs(a, [{ ...a[0]! }])).toBe(true);
    expect(sameTabs(a, [{ ...a[0]!, title: 'Changed' }])).toBe(false);
    expect(sameTabs(a, [])).toBe(false);
  });
});

describe('captureTabs reservation', () => {
  it('does not let an earlier URL match take a saved tab that a later tab owns', () => {
    const previous = [saved('s1', 'https://a.test/', 0), saved('s2', 'https://a.test/', 1)];
    const result = captureTabs(
      [live(7, 0, 'https://a.test/'), live(8, 1, 'https://a.test/')],
      previous,
      new Map([[8, 's1']]),
      base,
      ids(),
    );
    expect(result.tabs.map((t) => t.id)).toEqual(['s2', 's1']);
  });
});
