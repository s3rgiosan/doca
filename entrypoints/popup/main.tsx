import { render } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { toPortTab, type PortTab } from '@/lib/browser/port';
import { parseManagerUrl } from '@/lib/model/manager-url';
import type { Workspace } from '@/lib/model/workspace';
import { sendMessage, type Message, type Reply } from '@/lib/messages';
import { getSettings } from '@/lib/store/device';
import { getBindings } from '@/lib/store/session';
import { listWorkspaces } from '@/lib/store/workspaces';
import type { PickerRow } from '@/lib/ui/picker';
import { splitPinned, tabLabel, withoutManager } from '@/lib/ui/sidebar';
import { useAction } from '@/lib/ui/useAction';
import { Favicon } from '@/lib/ui/Favicon';
import { SuspendedIcon } from '@/lib/ui/SuspendedIcon';
import { WorkspacePicker } from '@/lib/ui/WorkspacePicker';
import '@/lib/ui/theme.css';
import './style.css';

const managerBase = browser.runtime.getURL('/manager.html');

interface State {
  windowId: number;
  tab: PortTab | null;
  /** True when the active tab is the Doca tab. The popup then lists the tabs of the workspace. */
  onManager: boolean;
  /** The tabs of this window, without the Doca tab. */
  windowTabs: PortTab[];
  boundTo: string | undefined;
  workspaces: Workspace[];
  bound: Set<string>;
  /** True when pinned tabs belong to the window, not to the workspace. */
  keepPinnedTabs: boolean;
}

async function loadState(): Promise<State> {
  const win = await browser.windows.getCurrent();
  const [bindings, workspaces, rawTabs, settings] = await Promise.all([
    getBindings(),
    listWorkspaces(),
    browser.tabs.query({ windowId: win.id! }),
    getSettings(),
  ]);
  const tabs = rawTabs.map(toPortTab);
  const active = tabs.find((tab) => tab.active) ?? null;
  return {
    windowId: win.id!,
    tab: active,
    onManager: active !== null && parseManagerUrl(managerBase, active.url) !== null,
    windowTabs: withoutManager(tabs, managerBase),
    boundTo: bindings.get(win.id!),
    workspaces,
    bound: new Set(bindings.values()),
    keepPinnedTabs: settings.keepPinnedTabs,
  };
}

const rowLabel = (row: PickerRow) => (row.kind === 'new' ? `New workspace "${row.name}"` : row.ws.name);

/** Tab rows. A click goes to the tab. */
function TabRows(props: { tabs: PortTab[]; onGo(tabId: number): void }) {
  return (
    <ul class="tab-list">
      {props.tabs.map((tab) => (
        <li key={tab.id}>
          <button class="plain tab-row" title={tab.url} onClick={() => props.onGo(tab.id)}>
            <Favicon src={tab.favIconUrl} />
            <span class="tab-row-title">{tabLabel(tab)}</span>
            {tab.discarded && <SuspendedIcon />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The tabs of the workspace. When the window keeps its pinned tabs, they show first in their own
 * group, because they do not belong to the workspace.
 */
function TabList(props: { name: string; tabs: PortTab[]; keepPinnedTabs: boolean }) {
  const [error, setError] = useState('');
  const pinnedId = useId();
  const workspaceId = useId();
  const { pinned, workspace } = splitPinned(props.tabs, props.keepPinnedTabs);
  const goTo = (tabId: number) => {
    setError('');
    browser.tabs.update(tabId, { active: true }).then(
      () => window.close(),
      () => setError('This tab is not available any more.'),
    );
  };
  return (
    <div class="popup">
      <header class="head">{props.name}</header>
      <div role="alert">{error && <p class="error">{error}</p>}</div>
      {pinned.length > 0 && (
        <section class="tab-group" aria-labelledby={pinnedId}>
          <h2 id={pinnedId} class="group-label">
            Pinned in this window
          </h2>
          <TabRows tabs={pinned} onGo={goTo} />
        </section>
      )}
      <section class="tab-group" aria-labelledby={pinned.length > 0 ? workspaceId : undefined}>
        {pinned.length > 0 && (
          <h2 id={workspaceId} class="group-label">
            In this workspace
          </h2>
        )}
        <TabRows tabs={workspace} onGo={goTo} />
        {workspace.length === 0 && <p class="muted">This workspace has no other tabs.</p>}
      </section>
    </div>
  );
}

function Popup() {
  const [state, setState] = useState<State | null>(null);
  const [target, setTarget] = useState<PickerRow | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [openElsewhere, setOpenElsewhere] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const moveButton = useRef<HTMLButtonElement>(null);
  const [busy, lock] = useAction();
  const workspaceFieldId = useId();
  const saveFieldId = useId();

  useEffect(() => {
    loadState().then(setState, () => setLoadError('Doca could not load your workspaces. Close this popup and open it again.'));
  }, []);

  // After a pick, Enter moves the tab.
  useEffect(() => {
    if (target) {
      moveButton.current?.focus();
    }
  }, [target]);

  if (!state && loadError) {
    return (
      <div class="popup">
        <div role="alert">
          <p class="error">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div class="popup" aria-busy="true">
        <p class="muted">Loading…</p>
      </div>
    );
  }
  if (state.onManager) {
    const name = state.workspaces.find((ws) => ws.id === state.boundTo)?.name ?? 'This window';
    return <TabList name={name} tabs={state.windowTabs} keepPinnedTabs={state.keepPinnedTabs} />;
  }

  /** Sends the message and closes the popup when it succeeds. */
  const run = async (msg: Message, close = true): Promise<Reply | undefined> =>
    lock(async () => {
      setError('');
      const reply = await sendMessage(msg);
      if (!reply.ok) {
        setError(reply.error);
      } else if (close) {
        window.close();
      }
      return reply;
    });

  const { tab } = state;
  const current = state.workspaces.find((ws) => ws.id === state.boundTo);
  // A pinned tab that the window keeps belongs to no workspace.
  const keptByWindow = state.keepPinnedTabs && tab?.pinned === true;

  const moveTab = () => {
    if (!tab || !target) {
      return;
    }
    const msg: Message =
      target.kind === 'new'
        ? { type: 'move-to-new', tabIds: [tab.id], name: target.name }
        : { type: 'move-tabs', tabIds: [tab.id], wsId: target.ws.id };
    void run(msg);
  };

  const saveWindow = async (row: PickerRow) => {
    if (row.kind === 'new') {
      void run({
        type: 'create-from-window',
        windowId: state.windowId,
        name: row.name,
      });
      return;
    }
    const reply = await run({ type: 'assign', windowId: state.windowId, wsId: row.ws.id }, false);
    if (reply?.ok && reply.value === 'open-elsewhere') {
      setOpenElsewhere(row.ws.id);
    } else if (reply?.ok) {
      window.close();
    }
  };

  const moveAllThere = async (wsId: string) => {
    const tabs = await browser.tabs.query({ windowId: state.windowId });
    const tabIds = tabs.filter((t) => parseManagerUrl(managerBase, t.url) === null).map((t) => t.id!);
    void run({ type: 'move-tabs', tabIds, wsId });
  };

  let pickerLabel = '';
  let pickerWorkspace: Workspace | undefined;
  if (target) {
    pickerLabel = rowLabel(target);
    pickerWorkspace = target.kind === 'workspace' ? target.ws : undefined;
  } else if (current && !keptByWindow) {
    pickerLabel = `${current.name} – current`;
    pickerWorkspace = current;
  }

  return (
    <div class={`popup${listOpen ? ' list-open' : ''}`}>
      <header class="head">Manage tab</header>

      {tab && (
        <>
          <div class="tab">
            <Favicon src={tab.favIconUrl} />
            <div class="tab-text">
              <div class="tab-title">{tabLabel(tab)}</div>
              <div class="tab-url">{tab.url}</div>
            </div>
          </div>
          <label class="field-label" for={workspaceFieldId}>
            Workspace
          </label>
          <WorkspacePicker
            inputId={workspaceFieldId}
            disabled={busy}
            workspaces={state.workspaces}
            bound={state.bound}
            currentId={state.boundTo}
            showCurrent
            label={pickerLabel}
            labelWorkspace={pickerWorkspace}
            placeholder="No workspace"
            onPick={setTarget}
            onOpenChange={setListOpen}
          />
          {!target && keptByWindow && <p class="field-hint">This tab is pinned to the window. Pick a workspace to move it there.</p>}
          {!target && current && !keptByWindow && <p class="field-hint">Pick another workspace to move this tab.</p>}
          <div class="actions">
            <button class="secondary" onClick={() => window.close()}>
              Cancel
            </button>
            <button ref={moveButton} class="primary" disabled={!target || busy} onClick={moveTab}>
              Move tab
            </button>
          </div>
        </>
      )}

      <div role="alert">{error && <p class="error">{error}</p>}</div>

      {state.boundTo === undefined && (
        <section>
          <label class="field-label" for={saveFieldId}>
            This window has no workspace
          </label>
          <WorkspacePicker
            inputId={saveFieldId}
            disabled={busy}
            workspaces={state.workspaces}
            bound={state.bound}
            currentId={undefined}
            showCurrent={false}
            label=""
            placeholder="Save all its tabs to…"
            onPick={(row) => void saveWindow(row)}
            onOpenChange={setListOpen}
          />
          {openElsewhere && (
            <p>
              That workspace is open in another window.{' '}
              <button class="primary" disabled={busy} onClick={() => void moveAllThere(openElsewhere)}>
                Move this window's tabs there
              </button>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
