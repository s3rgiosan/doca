import { describe, expect, it } from 'vitest';
import { formValues, hasUnsavedChanges, parseAllowlist, parseMinutes, type SettingsForm } from '@/lib/ui/settings-form';

const stored: SettingsForm = { globalMinutes: '20', allowlist: 'example.test', keepPinnedTabs: false };

describe('parseMinutes', () => {
  it('reads whole minutes and treats an empty or invalid field as no value', () => {
    expect(parseMinutes(' 7.4 ')).toBe(7);
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('-1')).toBeNull();
    expect(parseMinutes('abc')).toBeNull();
  });
});

describe('parseAllowlist', () => {
  it('trims, lowercases and drops empty lines', () => {
    expect(parseAllowlist(' Example.TEST \n\nother.test\n')).toEqual(['example.test', 'other.test']);
  });
});

describe('formValues', () => {
  it('saves the default timeout for an empty global field', () => {
    expect(formValues({ ...stored, globalMinutes: '' })).toEqual({ suspendAfterMinutes: 20, allowlist: ['example.test'], keepPinnedTabs: false });
  });
});

describe('hasUnsavedChanges', () => {
  it('is false for the stored form', () => {
    expect(hasUnsavedChanges({ ...stored }, stored)).toBe(false);
  });

  it('is true when the global timeout changes', () => {
    expect(hasUnsavedChanges({ ...stored, globalMinutes: '30' }, stored)).toBe(true);
  });

  it('is true when a host is added', () => {
    expect(hasUnsavedChanges({ ...stored, allowlist: 'example.test\nother.test' }, stored)).toBe(true);
  });

  it('is true when keepPinnedTabs changes', () => {
    expect(hasUnsavedChanges({ ...stored, keepPinnedTabs: true }, stored)).toBe(true);
  });

  it('ignores edits that save the same values', () => {
    const same: SettingsForm = { globalMinutes: ' 20 ', allowlist: '\nEXAMPLE.test \n', keepPinnedTabs: false };
    expect(hasUnsavedChanges(same, stored)).toBe(false);
  });
});
