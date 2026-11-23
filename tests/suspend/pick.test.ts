import { describe, expect, it } from 'vitest';
import type { PortTab } from '@/lib/browser/port';
import { pickTabsToDiscard, type SuspendContext } from '@/lib/suspend/pick';

const base = 'chrome-extension://abc/manager.html';
const MIN = 60_000;
const now = 100 * MIN;
let nextId = 1;
const tab = (over: Partial<PortTab> = {}): PortTab => ({
  id: nextId++,
  windowId: 1,
  index: 0,
  url: 'https://a.test/',
  title: 'A',
  pinned: false,
  active: false,
  audible: false,
  discarded: false,
  lastAccessed: now - 30 * MIN,
  ...over,
});
const ctx = (over: Partial<SuspendContext> = {}): SuspendContext => ({
  now,
  managerBase: base,
  settings: { suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: false },
  ...over,
});

describe('pickTabsToDiscard', () => {
  it('picks an idle tab past the timeout and skips a recent one', () => {
    const idle = tab();
    const recent = tab({ lastAccessed: now - 5 * MIN });
    expect(pickTabsToDiscard([idle, recent], ctx())).toEqual([idle.id]);
  });

  it('skips active, pinned, audible, discarded, manager and unknown-time tabs', () => {
    const tabs = [
      tab({ active: true }),
      tab({ pinned: true }),
      tab({ audible: true }),
      tab({ discarded: true }),
      tab({ url: `${base}?ws=a` }),
      tab({ lastAccessed: undefined }),
    ];
    expect(pickTabsToDiscard(tabs, ctx())).toEqual([]);
  });

  it('never discards when the timeout is 0', () => {
    const t = tab({ lastAccessed: 0 });
    expect(pickTabsToDiscard([t], ctx({ settings: { suspendAfterMinutes: 0, allowlist: [], keepPinnedTabs: false } }))).toEqual([]);
  });

  it('skips allowlisted hosts and their subdomains only', () => {
    const sub = tab({ url: 'https://docs.example.com/x' });
    const exact = tab({ url: 'https://example.com/' });
    const other = tab({ url: 'https://badexample.com/' });
    const result = pickTabsToDiscard([sub, exact, other], ctx({ settings: { suspendAfterMinutes: 20, allowlist: ['example.com'], keepPinnedTabs: false } }));
    expect(result).toEqual([other.id]);
  });

  it('never discards a tab whose address is still pending', () => {
    expect(pickTabsToDiscard([tab({ pending: true })], ctx())).toEqual([]);
  });
});
