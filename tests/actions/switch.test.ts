import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveWindow } from '@/lib/actions/save';
import { switchWindow } from '@/lib/actions/switch';
import { createFromWindow } from '@/lib/actions/window';
import { parseManagerUrl } from '@/lib/model/manager-url';
import { newWorkspace, normalizeUrl, type SavedTab } from '@/lib/model/workspace';
import { getSkipFallback, setSettings } from '@/lib/store/device';
import { nextDue } from '@/lib/store/dirty';
import { isRestoring, markStartupDone, setRestoring, windowForWorkspace } from '@/lib/store/session';
import { getWorkspace, putWorkspace } from '@/lib/store/workspaces';
import { createFakePort, FAKE_MANAGER_BASE as base, type FakePort } from '../helpers/fake-port';

const keepPinned = (on: boolean) => setSettings({ suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: on });

/** A window with `https://a1.test/` and a pinned `https://mail.test/`, saved as workspace A. */
async function windowWithMail(port: FakePort) {
  const win = await port.createWindow('https://a1.test/');
  const mail = await port.createTab({ windowId: win.id, url: 'https://mail.test/', pinned: true, active: false });
  const a = await createFromWindow(port, win.id, 'A', 2);
  return { win: win.id, mailId: mail.id, a };
}

async function windowWith(port: FakePort, urls: string[]) {
  const win = await port.createWindow(urls[0]!);
  for (const url of urls.slice(1)) {
    await port.createTab({ windowId: win.id, url, active: false });
  }
  return win.id;
}
const tabsIn = async (port: FakePort, windowId: number) => (await port.getWindow(windowId))!.tabs;
const savedTab = (id: string, url: string, pinned = false, index = 0): SavedTab => ({ id, url, finalUrl: url, title: id, pinned, index });
const closedB = () =>
  putWorkspace(
    newWorkspace({
      id: 'b',
      name: 'B',
      deviceId: 'd',
      now: 0,
      tabs: [savedTab('b1', 'https://b1.test/', false, 0), savedTab('b2', 'https://b2.test/', true, 1)],
    }),
    1,
  );

describe('switchWindow', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await markStartupDone();
  });

  it('saves the current workspace, then shows the other workspace in the same window', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/', 'https://a2.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    // A tab opened after the last save is saved by the switch.
    await port.createTab({ windowId: win, url: 'https://a3.test/', active: false });

    await switchWindow(port, win, 'b', 5);

    expect(port.windows).toHaveLength(1);
    const tabs = await tabsIn(port, win);
    expect(parseManagerUrl(base, tabs[0]!.url)).toBe('b');
    expect(tabs[0]!.pinned).toBe(true);
    expect(tabs.slice(1).map((t) => t.url).sort()).toEqual(['https://b1.test/', 'https://b2.test/']);
    expect(tabs.find((t) => t.url === 'https://b2.test/')!.pinned).toBe(true);
    expect((await getWorkspace(a))!.tabs.map((t) => t.url)).toEqual(['https://a1.test/', 'https://a2.test/', 'https://a3.test/']);
    expect(await windowForWorkspace('b')).toBe(win);
    expect(await windowForWorkspace(a)).toBeNull();
    expect((await getSkipFallback()).has(a)).toBe(true);
  });

  it('keeps the same manager tab and opens no second one', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/']);
    await createFromWindow(port, win, 'A', 2);
    const managerId = (await tabsIn(port, win))[0]!.id;
    const created = port.calls.length;

    await switchWindow(port, win, 'b', 5);

    const tabs = await tabsIn(port, win);
    expect(tabs[0]!.id).toBe(managerId);
    expect(parseManagerUrl(base, tabs[0]!.url)).toBe('b');
    expect(port.calls.slice(created).filter((call) => call.includes('manager.html'))).toEqual([`navigateTab ${managerId} ${base}?ws=b`]);
  });

  it('leaves only the manager tab for an empty workspace', async () => {
    await putWorkspace(newWorkspace({ id: 'e', name: 'E', deviceId: 'd', now: 0 }), 1);
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/']);
    await createFromWindow(port, win, 'A', 2);
    await switchWindow(port, win, 'e', 5);
    const tabs = await tabsIn(port, win);
    expect(tabs.map((t) => parseManagerUrl(base, t.url))).toEqual(['e']);
  });

  it('focuses the window of a workspace that is open in another window', async () => {
    const port = createFakePort();
    const winA = await windowWith(port, ['https://a1.test/']);
    await createFromWindow(port, winA, 'A', 2);
    const winB = await windowWith(port, ['https://b1.test/']);
    const b = await createFromWindow(port, winB, 'B', 2);
    const before = (await tabsIn(port, winA)).map((t) => t.url);

    await switchWindow(port, winA, b, 5);

    expect(port.windows).toHaveLength(2);
    expect(port.windows.find((w) => w.id === winB)!.focused).toBe(true);
    expect((await tabsIn(port, winA)).map((t) => t.url)).toEqual(before);
  });

  it('opens a new window from a window with no workspace', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://x.test/']);
    await switchWindow(port, win, 'b', 5);
    expect(port.windows).toHaveLength(2);
    expect((await tabsIn(port, win)).map((t) => t.url)).toEqual(['https://x.test/']);
  });

  it('changes nothing when the current workspace cannot be saved', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    await port.createTab({ windowId: win, url: 'https://a2.test/', active: false });
    const before = (await tabsIn(port, win)).map((t) => t.url);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'));

    await expect(switchWindow(port, win, 'b', 5)).rejects.toThrow('quota');

    spy.mockRestore();
    expect((await tabsIn(port, win)).map((t) => t.url)).toEqual(before);
    expect(await windowForWorkspace(a)).toBe(win);
  });

  it('refuses while the current workspace is still opening', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    await setRestoring(a, 4);
    await expect(switchWindow(port, win, 'b', 5)).rejects.toThrow('still opening');
    expect(await windowForWorkspace(a)).toBe(win);
  });

  it('does nothing for the workspace the window already shows', async () => {
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    const before = (await tabsIn(port, win)).map((t) => t.url);
    await switchWindow(port, win, a, 5);
    expect((await tabsIn(port, win)).map((t) => t.url)).toEqual(before);
  });
});

describe('switchWindow pinned tabs', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await markStartupDone();
  });

  it('closes pinned tabs with the setting off', async () => {
    await closedB();
    const port = createFakePort();
    const { win, a } = await windowWithMail(port);

    await switchWindow(port, win, 'b', 5);

    expect((await tabsIn(port, win)).map((t) => t.url)).not.toContain('https://mail.test/');
    expect((await getWorkspace(a))!.tabs.find((t) => t.url === 'https://mail.test/')?.pinned).toBe(true);
  });
});

describe('switchWindow with keepPinnedTabs', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await markStartupDone();
    await keepPinned(true);
  });

  it('keeps pinned tabs open', async () => {
    await closedB();
    const port = createFakePort();
    const { win, mailId } = await windowWithMail(port);

    await switchWindow(port, win, 'b', 5);

    const tabs = await tabsIn(port, win);
    const mail = tabs.find((t) => t.id === mailId);
    expect(mail?.url).toBe('https://mail.test/');
    expect(mail?.pinned).toBe(true);
    expect(tabs.map((t) => t.url)).not.toContain('https://a1.test/');
    expect(tabs.map((t) => t.url)).toEqual(expect.arrayContaining(['https://b1.test/', 'https://b2.test/']));
    expect(tabs.find((t) => t.url === 'https://b2.test/')!.pinned).toBe(true);
  });

  it('does not open a saved pinned tab that is already open', async () => {
    await putWorkspace(
      newWorkspace({
        id: 'b',
        name: 'B',
        deviceId: 'd',
        now: 0,
        tabs: [savedTab('b1', 'https://b1.test/', false, 0), savedTab('bm', 'https://MAIL.test/#inbox', true, 1)],
      }),
      1,
    );
    const port = createFakePort();
    const { win, mailId } = await windowWithMail(port);

    await switchWindow(port, win, 'b', 5);

    const mails = (await tabsIn(port, win)).filter((t) => normalizeUrl(t.url) === 'https://mail.test/');
    expect(mails.map((t) => t.id)).toEqual([mailId]);
  });

  it('does not open a saved pinned tab whose first address is open', async () => {
    const redirected: SavedTab = { ...savedTab('bm', 'https://mail.test/', true, 1), finalUrl: 'https://mail.test/u/0/' };
    await putWorkspace(newWorkspace({ id: 'b', name: 'B', deviceId: 'd', now: 0, tabs: [savedTab('b1', 'https://b1.test/', false, 0), redirected] }), 1);
    const port = createFakePort();
    const { win, mailId } = await windowWithMail(port);

    await switchWindow(port, win, 'b', 5);

    const mails = (await tabsIn(port, win)).filter((t) => t.url.startsWith('https://mail.test/'));
    expect(mails.map((t) => t.id)).toEqual([mailId]);
  });

  it('keeps pinned tabs when the switch rolls back', async () => {
    await closedB();
    const port = createFakePort();
    const { win } = await windowWithMail(port);
    const removeTabs = port.removeTabs.bind(port);
    let calls = 0;
    port.removeTabs = async (ids) => {
      calls += 1;
      if (calls <= 2) {
        throw new Error('Tabs cannot be edited right now');
      }
      await removeTabs(ids);
    };

    await expect(switchWindow(port, win, 'b', 5)).rejects.toThrow('cannot be edited');

    const urls = (await tabsIn(port, win)).map((t) => t.url);
    expect(urls).toEqual(expect.arrayContaining(['https://a1.test/', 'https://mail.test/']));
    expect(urls.filter((url) => url.startsWith('https://b'))).toEqual([]);
  });
});

describe('switchWindow when a step fails', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await markStartupDone();
  });

  const urlsOf = async (wsId: string) => (await getWorkspace(wsId))!.tabs.map((t) => t.url);

  /** Runs `during` once, when the switch creates its first tab for workspace B. */
  function onFirstTargetTab(port: FakePort, during: () => Promise<void>) {
    const createTab = port.createTab.bind(port);
    let done = false;
    port.createTab = async (p) => {
      const tab = await createTab(p);
      if (!done && p.url.startsWith('https://b')) {
        done = true;
        await during();
      }
      return tab;
    };
  }

  it('closes the old tabs when the user closes one of them during the switch', async () => {
    await closedB();
    const port = createFakePort({ commitLater: true });
    const win = await windowWith(port, ['https://a1.test/', 'https://a2.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    const a2 = (await tabsIn(port, win)).find((t) => t.url === 'https://a2.test/')!;
    onFirstTargetTab(port, () => port.removeTabs([a2.id]));

    await switchWindow(port, win, 'b', 5);

    const tabs = await tabsIn(port, win);
    expect(tabs.map((t) => parseManagerUrl(base, t.url) ?? t.url)).toEqual(['b', 'https://b1.test/', 'https://b2.test/']);
    expect(await windowForWorkspace('b')).toBe(win);
    expect(await isRestoring('b', 6)).toBe(false);
    expect(await nextDue()).not.toBeNull();
    await saveWindow(port, win, 7);
    expect(await urlsOf('b')).toEqual(['https://b1.test/', 'https://b2.test/']);
    expect(await urlsOf(a)).toEqual(['https://a1.test/', 'https://a2.test/']);
  });

  it('closes the old tabs when one closes just before the close call', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/', 'https://a2.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    const removeTabs = port.removeTabs.bind(port);
    let first = true;
    port.removeTabs = async (ids) => {
      if (first) {
        first = false;
        // The user closes a tab after Doca read the window.
        await removeTabs([ids[0]!]);
      }
      await removeTabs(ids);
    };

    await switchWindow(port, win, 'b', 5);

    expect((await tabsIn(port, win)).map((t) => parseManagerUrl(base, t.url) ?? t.url)).toEqual(['b', 'https://b1.test/', 'https://b2.test/']);
    expect(await urlsOf(a)).toEqual(['https://a1.test/', 'https://a2.test/']);
  });

  it('closes the old tabs before it waits for the new addresses', async () => {
    await closedB();
    const port = createFakePort({ commitLater: true });
    const win = await windowWith(port, ['https://a1.test/', 'https://a2.test/']);
    await createFromWindow(port, win, 'A', 2);
    const waitForUrl = port.waitForUrl.bind(port);
    const seen: string[][] = [];
    port.waitForUrl = async (tabId, timeoutMs) => {
      seen.push((await tabsIn(port, win)).map((t) => t.url));
      return waitForUrl(tabId, timeoutMs);
    };

    await switchWindow(port, win, 'b', 5);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.flat().filter((url) => url.startsWith('https://a'))).toEqual([]);
  });

  it('keeps a tab that opens during the switch in the old workspace', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    onFirstTargetTab(port, async () => {
      await port.createTab({ windowId: win, url: 'https://a-late.test/', active: false });
    });

    await switchWindow(port, win, 'b', 5);

    expect((await tabsIn(port, win)).map((t) => t.url)).not.toContain('https://a-late.test/');
    expect(await urlsOf(a)).toEqual(['https://a1.test/', 'https://a-late.test/']);
    await saveWindow(port, win, 7);
    expect(await urlsOf('b')).toEqual(['https://b1.test/', 'https://b2.test/']);
  });

  it('goes back to the old workspace when the manager tab cannot change', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/', 'https://a2.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    const before = (await tabsIn(port, win)).map((t) => t.url);
    const navigateTab = port.navigateTab.bind(port);
    let calls = 0;
    port.navigateTab = async (tabId, url) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('navigate failed');
      }
      await navigateTab(tabId, url);
    };

    await expect(switchWindow(port, win, 'b', 5)).rejects.toThrow('navigate failed');

    expect((await tabsIn(port, win)).map((t) => t.url)).toEqual(before);
    expect(await windowForWorkspace(a)).toBe(win);
    expect(await windowForWorkspace('b')).toBeNull();
    expect(await isRestoring('b', 6)).toBe(false);
    expect((await getSkipFallback()).has(a)).toBe(false);
    await saveWindow(port, win, 7);
    expect(await urlsOf(a)).toEqual(['https://a1.test/', 'https://a2.test/']);
    expect(await urlsOf('b')).toEqual(['https://b1.test/', 'https://b2.test/']);
  });

  it('closes the new tabs and goes back when the old tabs cannot close', async () => {
    await closedB();
    const port = createFakePort();
    const win = await windowWith(port, ['https://a1.test/', 'https://a2.test/']);
    const a = await createFromWindow(port, win, 'A', 2);
    const before = (await tabsIn(port, win)).map((t) => t.url);
    const removeTabs = port.removeTabs.bind(port);
    let calls = 0;
    port.removeTabs = async (ids) => {
      calls += 1;
      if (calls <= 2) {
        throw new Error('Tabs cannot be edited right now');
      }
      await removeTabs(ids);
    };

    await expect(switchWindow(port, win, 'b', 5)).rejects.toThrow('cannot be edited');

    expect((await tabsIn(port, win)).map((t) => t.url)).toEqual(before);
    expect(await windowForWorkspace(a)).toBe(win);
    expect(await isRestoring('b', 6)).toBe(false);
    await saveWindow(port, win, 7);
    expect(await urlsOf(a)).toEqual(['https://a1.test/', 'https://a2.test/']);
    expect(await urlsOf('b')).toEqual(['https://b1.test/', 'https://b2.test/']);
  });
});
