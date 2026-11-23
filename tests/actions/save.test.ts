import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { flushDue, saveWindow } from '@/lib/actions/save';
import { createFromWindow } from '@/lib/actions/window';
import { managerUrl } from '@/lib/model/manager-url';
import { newWorkspace } from '@/lib/model/workspace';
import { setSettings } from '@/lib/store/device';
import { markDirty, nextDue } from '@/lib/store/dirty';
import { bindWindow, markStartupDone, setRestoring } from '@/lib/store/session';
import { getWorkspace, putWorkspace } from '@/lib/store/workspaces';
import { createFakePort, FAKE_MANAGER_BASE as base } from '../helpers/fake-port';

async function boundWindow() {
  await putWorkspace(newWorkspace({ id: 'a', name: 'A', deviceId: 'd', now: 0 }), 1);
  const port = createFakePort();
  const win = await port.createWindow(managerUrl(base, 'a'));
  await port.createTab({ windowId: win.id, url: 'https://x.test/', active: false });
  await bindWindow(win.id, 'a');
  return { port, windowId: win.id };
}

describe('saveWindow', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('saves nothing before startup binding is done', async () => {
    const { port, windowId } = await boundWindow();
    await saveWindow(port, windowId, 5);
    expect((await getWorkspace('a'))!.tabs).toEqual([]);
  });

  it('writes only when the tabs changed', async () => {
    const { port, windowId } = await boundWindow();
    await markStartupDone();
    await saveWindow(port, windowId, 5);
    const first = (await getWorkspace('a'))!;
    expect(first.tabs.map((t) => t.url)).toEqual(['https://x.test/']);
    await saveWindow(port, windowId, 6);
    expect((await getWorkspace('a'))!.rev).toBe(first.rev);
    await port.createTab({ windowId, url: 'https://y.test/', active: false });
    await saveWindow(port, windowId, 7);
    expect((await getWorkspace('a'))!.rev).toBe(first.rev + 1);
  });
});

describe('saveWindow with keepPinnedTabs', () => {
  const keepPinned = (on: boolean) => setSettings({ suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: on });
  const urls = async (wsId: string) => (await getWorkspace(wsId))!.tabs.map((t) => t.url);

  async function windowWithPinned() {
    const port = createFakePort();
    const win = await port.createWindow('https://a1.test/');
    const mail = await port.createTab({ windowId: win.id, url: 'https://mail.test/', pinned: true, active: false });
    return { port, windowId: win.id, mailId: mail.id };
  }

  beforeEach(async () => {
    fakeBrowser.reset();
    await markStartupDone();
    await keepPinned(true);
  });

  it('does not save pinned tabs', async () => {
    const { port, windowId } = await windowWithPinned();
    const a = await createFromWindow(port, windowId, 'A', 2);
    expect(await urls(a)).toEqual(['https://a1.test/']);
  });

  it('drops saved pinned tabs from the workspace', async () => {
    await keepPinned(false);
    const { port, windowId } = await windowWithPinned();
    const a = await createFromWindow(port, windowId, 'A', 2);
    expect(await urls(a)).toContain('https://mail.test/');
    await keepPinned(true);
    await saveWindow(port, windowId, 5);
    expect(await urls(a)).toEqual(['https://a1.test/']);
  });

  it('saves a tab after it is unpinned', async () => {
    const { port, windowId, mailId } = await windowWithPinned();
    const a = await createFromWindow(port, windowId, 'A', 2);
    port.windows.flatMap((w) => w.tabs).find((t) => t.id === mailId)!.pinned = false;
    await saveWindow(port, windowId, 5);
    expect(await urls(a)).toContain('https://mail.test/');
  });
});

describe('saveWindow during a restore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('saves nothing until the restore guard ends or expires', async () => {
    const { port, windowId } = await boundWindow();
    await markStartupDone();
    await setRestoring('a', 0);
    await saveWindow(port, windowId, 1000);
    expect((await getWorkspace('a'))!.tabs).toEqual([]);
    await saveWindow(port, windowId, 60_000);
    expect((await getWorkspace('a'))!.tabs).toHaveLength(1);
  });

  it('saves the other workspaces and marks a failed one due again', async () => {
    const { port, windowId } = await boundWindow();
    await putWorkspace(newWorkspace({ id: 'b', name: 'B', deviceId: 'd', now: 0 }), 1);
    const other = await port.createWindow(managerUrl(base, 'b'));
    await port.createTab({ windowId: other.id, url: 'https://y.test/', active: false });
    await bindWindow(other.id, 'b');
    await markStartupDone();
    await markDirty('a', 0);
    await markDirty('b', 0);
    const getWindow = port.getWindow.bind(port);
    port.getWindow = async (id) => {
      if (id === windowId) {
        throw new Error('boom');
      }
      return getWindow(id);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await flushDue(port, 1000);
    warn.mockRestore();
    expect((await getWorkspace('b'))!.tabs).toHaveLength(1);
    expect(await nextDue()).toBe(2000);
  });
});

describe('flushDue', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('saves the bound window of each due workspace', async () => {
    const { port } = await boundWindow();
    await markStartupDone();
    await markDirty('a', 0);
    await flushDue(port, 500);
    expect((await getWorkspace('a'))!.tabs).toEqual([]);
    await flushDue(port, 1000);
    expect((await getWorkspace('a'))!.tabs).toHaveLength(1);
  });
});
