import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { newWorkspace, tombstone } from '@/lib/model/workspace';
import { getDeviceId, getSettings } from '@/lib/store/device';
import { getWorkspace, listWorkspaces, putWorkspace, removeWorkspace } from '@/lib/store/workspaces';

const ws = (id: string) => newWorkspace({ id, name: id.toUpperCase(), deviceId: 'other', now: 0 });

describe('workspace store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('increments rev and stamps the device on each write', async () => {
    const first = await putWorkspace(ws('a'), 10);
    const second = await putWorkspace({ ...first, name: 'Renamed' }, 20);
    expect(first.rev).toBe(1);
    expect(second.rev).toBe(2);
    expect(second.updatedAt).toBe(20);
    expect(second.deviceId).toBe(await getDeviceId());
    expect(await getWorkspace('a')).toEqual(second);
  });

  it('removes a record and its index entry', async () => {
    await putWorkspace(ws('a'), 1);
    await putWorkspace(ws('b'), 1);
    await removeWorkspace('a');
    expect(await getWorkspace('a')).toBeNull();
    expect((await listWorkspaces({ includeDeleted: true })).map((w) => w.id)).toEqual(['b']);
  });

  it('leaves tombstones out of the list unless asked', async () => {
    const a = await putWorkspace(ws('a'), 1);
    await putWorkspace(ws('b'), 1);
    await putWorkspace(tombstone(a, 2), 2);
    expect((await listWorkspaces()).map((w) => w.id)).toEqual(['b']);
    expect((await listWorkspaces({ includeDeleted: true })).map((w) => w.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps every ID when writes run in parallel', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `w${i}`);
    await Promise.all(ids.map((id) => putWorkspace(ws(id), 1)));
    expect(await listWorkspaces()).toHaveLength(20);
  });

  it('returns null for an unknown workspace', async () => {
    expect(await getWorkspace('nope')).toBeNull();
  });
});

describe('device store', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('keeps one device ID', async () => {
    expect(await getDeviceId()).toBe(await getDeviceId());
  });

  it('gives default settings', async () => {
    expect(await getSettings()).toEqual({ suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: false });
  });

  it('reads a missing keepPinnedTabs as false', async () => {
    await storage.setItem('local:device.settings', { suspendAfterMinutes: 5, allowlist: [] });
    expect(await getSettings()).toEqual({ suspendAfterMinutes: 5, allowlist: [], keepPinnedTabs: false });
  });
});
