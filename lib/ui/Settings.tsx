import { useEffect, useId, useState } from 'preact/hooks';
import { sendMessage } from '../messages';
import { getSettings } from '../store/device';
import { Icon } from './Icon';
import { HardDrive, Pin, Timer } from './icons';
import { formValues, hasUnsavedChanges, type SettingsForm } from './settings-form';
import { useAction } from './useAction';
import './settings.css';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Section = 'suspender' | 'pinned' | 'backup';

const SECTIONS = [
  { id: 'suspender', label: 'Tab suspender', icon: Timer },
  { id: 'pinned', label: 'Pinned tabs', icon: Pin },
  { id: 'backup', label: 'Backup', icon: HardDrive },
] as const;

interface Props {
  /** The level of the section heading. The page sets it below its own headings. */
  headingLevel: 2 | 3;
  /** Gets true when the settings fields have changes that are not saved, and false after a save. */
  onDirtyChange?(dirty: boolean): void;
  /** Gets the save function, so that the page can save before it closes the settings. It resolves to true on success. */
  saveRef?: { current: (() => Promise<boolean>) | null };
}

/**
 * The suspender settings, the pinned tab setting and the backup in two panes: the sections on the left, the selected section
 * on the right. The settings page and the Doca tab both show it.
 */
export function Settings(props: Props) {
  const [section, setSection] = useState<Section>('suspender');
  const [globalMinutes, setGlobalMinutes] = useState('20');
  const [allowlist, setAllowlist] = useState('');
  const [keepPinnedTabs, setKeepPinnedTabs] = useState(false);
  // The form as it was last loaded from storage. Null until the first load ends.
  const [stored, setStored] = useState<SettingsForm | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const minutesId = useId();
  const Heading = `h${props.headingLevel}` as 'h2' | 'h3';
  const allowlistId = useId();

  /** Reads the stored values. With `keepEdits`, the fields keep their text. */
  const load = async (keepEdits = false) => {
    const settings = await getSettings();
    const form: SettingsForm = {
      globalMinutes: String(settings.suspendAfterMinutes),
      allowlist: settings.allowlist.join('\n'),
      keepPinnedTabs: settings.keepPinnedTabs,
    };
    setStored(form);
    if (keepEdits) {
      return;
    }
    setGlobalMinutes(form.globalMinutes);
    setAllowlist(form.allowlist);
    setKeepPinnedTabs(form.keepPinnedTabs);
  };

  useEffect(() => {
    load().catch(() => report(false, 'Doca could not load the settings.'));
  }, []);

  const dirty = stored !== null && hasUnsavedChanges({ globalMinutes, allowlist, keepPinnedTabs }, stored);
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty]);

  const report = (ok: boolean, text: string) => {
    setStatus(ok ? text : '');
    setError(ok ? '' : text);
  };

  /** Saves the settings fields. A failed save keeps the fields as they are, so no edit is lost. */
  const save = async (): Promise<boolean> => {
    const saved = await run(async () => {
      const reply = await sendMessage({ type: 'set-settings', settings: formValues({ globalMinutes, allowlist, keepPinnedTabs }) });
      report(reply.ok, reply.ok ? 'Settings saved.' : reply.error);
      if (reply.ok) {
        try {
          await load();
        } catch {
          report(false, 'Settings saved, but Doca could not reload them.');
        }
      }
      return reply.ok;
    });
    return saved === true;
  };
  if (props.saveRef) {
    props.saveRef.current = save;
  }

  const exportFile = () =>
    run(async () => {
      const reply = await sendMessage({ type: 'export' });
      if (!reply.ok) {
        report(false, reply.error);
        return;
      }
      const url = URL.createObjectURL(new Blob([reply.value as string], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `doca-export-${today()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      report(true, 'Export downloaded.');
    });

  const importFile = (file: File | undefined) =>
    run(async () => {
      if (!file) {
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        report(false, 'Doca could not read this file.');
        return;
      }
      const reply = await sendMessage({ type: 'import', text });
      report(reply.ok, reply.ok ? `Imported ${String(reply.value)} workspaces.` : reply.error);
      try {
        await load(true);
      } catch {
        report(false, 'Doca could not reload the settings.');
      }
    });

  return (
    <div class="settings">
      <nav class="settings-nav" aria-label="Settings sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            class={`plain settings-nav-item${item.id === section ? ' selected' : ''}`}
            aria-current={item.id === section ? 'true' : undefined}
            onClick={() => setSection(item.id)}
          >
            <Icon icon={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>
      <div class="settings-content">
        {section === 'suspender' && (
          <section aria-labelledby={`${minutesId}-title`}>
            <Heading id={`${minutesId}-title`}>Tab suspender</Heading>
            <label for={minutesId}>Suspend a tab after it is idle for (minutes, 0 means never)</label>
            <input id={minutesId} type="number" min="0" value={globalMinutes} onInput={(event) => setGlobalMinutes(event.currentTarget.value)} />
            <label for={allowlistId}>Never suspend these hosts (one per line; a host also covers its subdomains)</label>
            <textarea id={allowlistId} rows={3} value={allowlist} onInput={(event) => setAllowlist(event.currentTarget.value)} />
            <button class="primary" disabled={busy} onClick={() => void save()}>
              Save settings
            </button>
          </section>
        )}

        {section === 'pinned' && (
          <section aria-labelledby={`${minutesId}-pinned`}>
            <Heading id={`${minutesId}-pinned`}>Pinned tabs</Heading>
            <label class="check">
              <input type="checkbox" checked={keepPinnedTabs} onChange={(event) => setKeepPinnedTabs(event.currentTarget.checked)} />
              Keep pinned tabs open when the window switches workspace
            </label>
            <p class="muted">Pinned tabs then belong to the window and are not saved in a workspace.</p>
            <button class="primary" disabled={busy} onClick={() => void save()}>
              Save settings
            </button>
          </section>
        )}

        {section === 'backup' && (
          <section aria-labelledby={`${minutesId}-backup`}>
            <Heading id={`${minutesId}-backup`}>Backup</Heading>
            <p class="muted">Your workspaces are stored only in this browser. Export them to keep a copy. Import adds workspaces and never replaces one.</p>
            <div class="row">
              <button class="primary" disabled={busy} onClick={() => void exportFile()}>
                Export
              </button>
              <label class={`file${busy ? ' disabled' : ''}`}>
                Import
                <input
                  class="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void importFile(input.files?.[0]).then(() => (input.value = ''));
                  }}
                />
              </label>
            </div>
          </section>
        )}

        <div role="status">{status && <p>{status}</p>}</div>
        <div role="alert">{error && <p class="error">{error}</p>}</div>
      </div>
    </div>
  );
}
