import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleMessage, type Message } from '@/lib/messages';
import { newWorkspace, WORKSPACE_COLORS, workspaceColor } from '@/lib/model/workspace';
import { getSettings } from '@/lib/store/device';
import { markStartupDone, windowForWorkspace } from '@/lib/store/session';
import { getWorkspace, listWorkspaces, putWorkspace } from '@/lib/store/workspaces';
import { createFakePort } from './helpers/fake-port';

const now = () => 5;

describe('handleMessage', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await putWorkspace(newWorkspace({ id: 'a', name: 'A', deviceId: 'd', now: 0 }), 1);
  });

  it('moves tabs to a new workspace', async () => {
    const port = createFakePort();
    const win = await port.createWindow('https://a.test/');
    const tab = await port.createTab({ windowId: win.id, url: 'https://b.test/', active: false });
    const reply = await handleMessage({ type: 'move-to-new', tabIds: [tab.id], name: 'Fresh' }, port, now);
    expect(reply).toMatchObject({ ok: true, value: { moved: 1 } });
    expect((await listWorkspaces()).map((w) => w.name).sort()).toEqual(['A', 'Fresh']);
  });

  it('switches in place when the message names the window', async () => {
    await markStartupDone();
    const port = createFakePort();
    const win = await port.createWindow('https://x.test/');
    await handleMessage({ type: 'create-from-window', windowId: win.id, name: 'X' }, port, now);
    expect(await handleMessage({ type: 'switch', wsId: 'a', windowId: win.id }, port, now)).toEqual({ ok: true });
    expect(port.windows).toHaveLength(1);
    expect(await windowForWorkspace('a')).toBe(win.id);
  });

  it('creates a workspace in place when the message names the window', async () => {
    await markStartupDone();
    const port = createFakePort();
    const win = await port.createWindow('https://x.test/');
    await handleMessage({ type: 'create-from-window', windowId: win.id, name: 'X' }, port, now);
    const reply = await handleMessage({ type: 'create-empty', name: 'New', windowId: win.id }, port, now);
    expect(port.windows).toHaveLength(1);
    expect(await windowForWorkspace((reply as { value: string }).value)).toBe(win.id);
  });

  it('renames a workspace', async () => {
    expect(await handleMessage({ type: 'rename', wsId: 'a', name: 'B' }, createFakePort(), now)).toEqual({ ok: true });
    expect((await getWorkspace('a'))!.name).toBe('B');
  });

  it('changes the colour with the name and bumps rev', async () => {
    const before = (await getWorkspace('a'))!;
    expect(await handleMessage({ type: 'rename', wsId: 'a', name: 'B', color: 'purple' }, createFakePort(), now)).toEqual({ ok: true });
    const after = (await getWorkspace('a'))!;
    expect(after.color).toBe('purple');
    expect(after.rev).toBe(before.rev + 1);
    expect(after.updatedAt).toBe(5);
  });

  it('keeps the colour when a rename sends none', async () => {
    await handleMessage({ type: 'rename', wsId: 'a', name: 'B', color: 'blue' }, createFakePort(), now);
    await handleMessage({ type: 'rename', wsId: 'a', name: 'C' }, createFakePort(), now);
    expect((await getWorkspace('a'))!.color).toBe('blue');
  });

  it('rejects an unknown colour key and changes nothing', async () => {
    const before = (await getWorkspace('a'))!;
    const bad = { type: 'rename', wsId: 'a', name: 'B', color: 'plaid' } as unknown as Message;
    expect((await handleMessage(bad, createFakePort(), now)).ok).toBe(false);
    expect(await getWorkspace('a')).toEqual(before);
  });

  it('gives a new workspace the first unused colour', async () => {
    const port = createFakePort();
    const used = workspaceColor((await getWorkspace('a'))!);
    const reply = await handleMessage({ type: 'create-empty', name: 'N' }, port, now);
    const created = (await getWorkspace((reply as { value: string }).value))!;
    expect(created.color).toBeDefined();
    expect(created.color).not.toBe(used);
    expect(created.color).toBe(WORKSPACE_COLORS.find((c) => c !== used));
  });

  it('uses the colour that create-empty sends and rejects an unknown one', async () => {
    const port = createFakePort();
    const reply = await handleMessage({ type: 'create-empty', name: 'N', color: 'pink' }, port, now);
    expect((await getWorkspace((reply as { value: string }).value))!.color).toBe('pink');
    const bad = { type: 'create-empty', name: 'M', color: 'plaid' } as unknown as Message;
    expect((await handleMessage(bad, port, now)).ok).toBe(false);
    expect(await listWorkspaces()).toHaveLength(2);
  });

  it('reports an unknown workspace', async () => {
    const reply = await handleMessage({ type: 'switch', wsId: 'missing' }, createFakePort(), now);
    expect(reply.ok).toBe(false);
  });

  it('saves settings', async () => {
    const settings = { suspendAfterMinutes: 30, allowlist: ['example.com'], keepPinnedTabs: true };
    await handleMessage({ type: 'set-settings', settings }, createFakePort(), now);
    expect(await getSettings()).toEqual(settings);
  });

  it('saves settings without keepPinnedTabs as off', async () => {
    const settings = { suspendAfterMinutes: 30, allowlist: [] };
    await handleMessage({ type: 'set-settings', settings } as unknown as Message, createFakePort(), now);
    expect((await getSettings()).keepPinnedTabs).toBe(false);
  });

  it.each([
    ['negative minutes', { suspendAfterMinutes: -1, allowlist: [] }],
    ['fractional minutes', { suspendAfterMinutes: 1.5, allowlist: [] }],
    ['infinite minutes', { suspendAfterMinutes: Infinity, allowlist: [] }],
    ['string minutes', { suspendAfterMinutes: '5', allowlist: [] }],
    ['allowlist not an array', { suspendAfterMinutes: 5, allowlist: 'example.com' }],
    ['allowlist with a number', { suspendAfterMinutes: 5, allowlist: [1] }],
    ['missing allowlist', { suspendAfterMinutes: 5 }],
    ['keepPinnedTabs not a boolean', { suspendAfterMinutes: 5, allowlist: [], keepPinnedTabs: 'yes' }],
    ['null', null],
  ])('rejects settings with %s', async (_label, settings) => {
    const reply = await handleMessage({ type: 'set-settings', settings } as unknown as Message, createFakePort(), now);
    expect(reply.ok).toBe(false);
    expect((await getSettings()).suspendAfterMinutes).toBe(20);
  });

  it('imports a workspace with the ID "index" under a new ID and keeps the list readable', async () => {
    const text = JSON.stringify({
      format: 'doca-export',
      version: 1,
      exportedAt: 1,
      workspaces: [{ id: 'index', name: 'Work', tabs: [{ id: 't', url: 'https://example.com/' }] }],
    });
    const reply = await handleMessage({ type: 'import', text }, createFakePort(), now);
    expect(reply).toEqual({ ok: true, value: 1 });
    const list = await listWorkspaces();
    expect(list.map((w) => w.name).sort()).toEqual(['A', 'Work']);
    expect(list.every((w) => w.id !== 'index')).toBe(true);
  });

  it('exports and imports as a copy when the ID exists', async () => {
    const exported = await handleMessage({ type: 'export' }, createFakePort(), now);
    expect(exported.ok).toBe(true);
    const text = (exported as { value: string }).value;
    const imported = await handleMessage({ type: 'import', text }, createFakePort(), now);
    expect(imported).toEqual({ ok: true, value: 1 });
    expect((await listWorkspaces()).map((w) => w.name).sort()).toEqual(['A', 'A (imported)']);
  });

  it('changes nothing for a bad import', async () => {
    const reply = await handleMessage({ type: 'import', text: '{}' }, createFakePort(), now);
    expect(reply.ok).toBe(false);
    expect(await listWorkspaces()).toHaveLength(1);
  });
});
