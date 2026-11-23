import type { Settings as SettingsValues } from '../store/device';

/** The text in the fields of the settings form. */
export interface SettingsForm {
  globalMinutes: string;
  /** One host per line. */
  allowlist: string;
  keepPinnedTabs: boolean;
}

/** The global timeout that an empty or invalid field saves. */
export const DEFAULT_MINUTES = 20;

/** Returns the minutes in the text, or null when the text is empty or invalid. */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** One host per line, trimmed and lowercased. Empty lines are dropped. */
export function parseAllowlist(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '');
}

/** Returns the values that a save writes for the form. */
export function formValues(form: SettingsForm): SettingsValues {
  return {
    suspendAfterMinutes: parseMinutes(form.globalMinutes) ?? DEFAULT_MINUTES,
    allowlist: parseAllowlist(form.allowlist),
    keepPinnedTabs: form.keepPinnedTabs,
  };
}

/**
 * True when a save of the form writes other values than a save of the stored form. Edits that save
 * the same values, such as extra spaces or an empty line, are not changes.
 */
export function hasUnsavedChanges(form: SettingsForm, stored: SettingsForm): boolean {
  const next = formValues(form);
  const before = formValues(stored);
  if (next.suspendAfterMinutes !== before.suspendAfterMinutes || next.keepPinnedTabs !== before.keepPinnedTabs) {
    return true;
  }
  return next.allowlist.join('\n') !== before.allowlist.join('\n');
}
