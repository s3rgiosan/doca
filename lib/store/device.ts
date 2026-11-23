import { storage } from 'wxt/utils/storage';
import { serial } from './queue';

export interface Settings {
  /** Minutes before an idle tab is suspended. 0 means never. */
  suspendAfterMinutes: number;
  /** Hosts whose tabs are never suspended. A host also covers its subdomains. */
  allowlist: string[];
  /** When true, pinned tabs belong to the window. They stay open on a workspace switch and are not saved in a workspace. */
  keepPinnedTabs: boolean;
}

const MAX_SUSPEND_MINUTES = 525_600;
const MAX_ALLOWLIST_ENTRIES = 1000;
const MAX_ALLOWLIST_ENTRY_LENGTH = 253;

const DEFAULT_SETTINGS: Settings = { suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: false };

const deviceIdItem = storage.defineItem<string>('local:device.id');
const settingsItem = storage.defineItem<Settings>('local:device.settings', { fallback: DEFAULT_SETTINGS });
const skipItem = storage.defineItem<string[]>('local:device.skipFallback', { fallback: [] });

export function getDeviceId(): Promise<string> {
  return serial(async () => {
    const existing = await deviceIdItem.getValue();
    if (existing) {
      return existing;
    }
    const id = crypto.randomUUID();
    await deviceIdItem.setValue(id);
    return id;
  });
}

/** Settings stored by an older version can miss a field, so each missing field gets its default. */
export async function getSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Throws an Error when the value is not a valid `Settings`. Returns a copy that has only the known fields.
 * A missing `keepPinnedTabs` is false.
 */
export function validateSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The settings are not an object.');
  }
  const { suspendAfterMinutes, allowlist, keepPinnedTabs = false } = value as Record<string, unknown>;
  if (typeof suspendAfterMinutes !== 'number' || !Number.isInteger(suspendAfterMinutes) || suspendAfterMinutes < 0 || suspendAfterMinutes > MAX_SUSPEND_MINUTES) {
    throw new Error(`The suspend time must be a whole number of minutes from 0 to ${MAX_SUSPEND_MINUTES}.`);
  }
  if (!Array.isArray(allowlist) || allowlist.length > MAX_ALLOWLIST_ENTRIES) {
    throw new Error(`The allowlist must be a list of at most ${MAX_ALLOWLIST_ENTRIES} hosts.`);
  }
  if (!allowlist.every((entry) => typeof entry === 'string' && entry.length <= MAX_ALLOWLIST_ENTRY_LENGTH)) {
    throw new Error(`Each allowlist entry must be text of at most ${MAX_ALLOWLIST_ENTRY_LENGTH} characters.`);
  }
  if (typeof keepPinnedTabs !== 'boolean') {
    throw new Error('The keep pinned tabs setting must be true or false.');
  }
  return { suspendAfterMinutes, allowlist: [...(allowlist as string[])], keepPinnedTabs };
}

export function setSettings(settings: Settings): Promise<void> {
  const valid = validateSettings(settings);
  return serial(() => settingsItem.setValue(valid));
}

/** Workspaces that the startup overlap fallback must skip, because the user unbound their window. */
export async function getSkipFallback(): Promise<Set<string>> {
  return new Set(await skipItem.getValue());
}

export function setSkipFallback(wsId: string, skip: boolean): Promise<void> {
  return serial(async () => {
    const ids = new Set(await skipItem.getValue());
    if (skip) {
      ids.add(wsId);
    } else {
      ids.delete(wsId);
    }
    await skipItem.setValue([...ids]);
  });
}
