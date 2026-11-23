# Keep Pinned Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Keep pinned tabs** setting. When it is on, pinned tabs belong to the window, stay open on a workspace switch, and are never saved into a workspace.

**Architecture:** A new boolean in `Settings` (`lib/store/device.ts`). `captureTabs` gets a `skipPinned` option that `saveWindow` and `createFromWindow` set from the setting. `switchWindow` leaves pinned tabs out of the tabs it closes and skips target pinned tabs whose address is already open as a pinned tab.

**Tech Stack:** TypeScript, WXT, Preact, lucide-preact 1.64.0, Vitest with `wxt/testing/fake-browser` and `tests/helpers/fake-port.ts`.

**Spec:** `docs/superpowers/specs/2026-11-23-keep-pinned-tabs-design.md`

## Global Constraints

- The setting is off by default. With it off, every existing test passes unchanged, except the two tests in Task 1 that compare the whole `Settings` object.
- Settings stored by an older version have no `keepPinnedTabs` field. A missing field reads as `false`.
- Code comments and docblocks: ASD-STE100 style, as in the existing files. README and CHANGELOG: short full sentences, as in the existing files.
- Run `npm test` and `npm run build` after each task.
- Commit on `main`. No attribution lines in commit messages.

## Review Focus

1. Settings stored by an older version (no `keepPinnedTabs`): `getSettings()` returns `keepPinnedTabs: false`, and a switch closes pinned tabs as before. Test in Task 1.
2. A pinned live tab and a saved pinned tab of the target differ only in the fragment or the host case: the target tab does not open again (`normalizeUrl`). Test in Task 3.
3. The target has a pinned saved tab that is not open in the window: it opens pinned. Test in Task 3.
4. A switch fails before the old tabs close, with the setting on: the rollback closes only the tabs it created, and the pinned tabs stay. Test in Task 3.
5. A pinned tab is unpinned with the setting on: the next save adds it to the workspace. Test in Task 2.

---

### Task 1: The setting

**Files:**
- Modify: `lib/store/device.ts` (`Settings`, `DEFAULT_SETTINGS`, `getSettings`, `validateSettings`)
- Modify: `lib/ui/settings-form.ts` (`SettingsForm`, `formValues`, `hasUnsavedChanges`)
- Modify: `lib/ui/Settings.tsx`, `lib/ui/icons.ts`
- Test: `tests/ui/settings-form.test.ts`, `tests/messages.test.ts`, `tests/store/workspaces.test.ts`

**Interfaces:**
- Produces: `Settings.keepPinnedTabs: boolean`. `getSettings(): Promise<Settings>` always returns the field. `SettingsForm.keepPinnedTabs: boolean`.

- [ ] **Step 1: Write the failing tests**

In `tests/store/workspaces.test.ts`, change `gives default settings` to expect `{ suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: false }`. Add `reads a missing keepPinnedTabs as false`: write `{ suspendAfterMinutes: 5, allowlist: [] }` with `storage.setItem('local:device.settings', …)` from `wxt/utils/storage`, then expect `getSettings()` to equal `{ suspendAfterMinutes: 5, allowlist: [], keepPinnedTabs: false }`.

In `tests/messages.test.ts`:
- `saves settings` sends `{ suspendAfterMinutes: 30, allowlist: ['example.com'], keepPinnedTabs: true }` and expects the same object back.
- Add `saves settings without keepPinnedTabs as off`: send `{ suspendAfterMinutes: 30, allowlist: [] }` and expect `keepPinnedTabs` to be `false`.
- Add `['keepPinnedTabs not a boolean', { suspendAfterMinutes: 5, allowlist: [], keepPinnedTabs: 'yes' }]` to the `rejects settings with %s` table.

In `tests/ui/settings-form.test.ts`, set `stored` to `{ globalMinutes: '20', allowlist: 'example.test', keepPinnedTabs: false }`. The `formValues` test expects `keepPinnedTabs: false` in its result. Add `is true when keepPinnedTabs changes`: `hasUnsavedChanges({ ...stored, keepPinnedTabs: true }, stored)` is `true`.

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npx vitest run tests/store/workspaces.test.ts tests/messages.test.ts tests/ui/settings-form.test.ts`
Expected: FAIL on the new and changed assertions.

- [ ] **Step 3: Implement**

- `Settings` gets `keepPinnedTabs: boolean` with a docblock. `DEFAULT_SETTINGS` sets it to `false`.
- `getSettings` returns `{ ...DEFAULT_SETTINGS, ...stored }`, so a stored value with no field reads as `false`.
- `validateSettings` accepts `undefined` as `false`, rejects any other non-boolean with `The keep pinned tabs setting must be true or false.`, and returns the field in its copy.
- `SettingsForm` gets `keepPinnedTabs: boolean`. `formValues` copies it. `hasUnsavedChanges` returns `true` when it differs.
- `lib/ui/icons.ts` exports `Pin` from `lucide-preact`.
- `Settings.tsx`: add a section `{ id: 'pinned', label: 'Pinned tabs', icon: Pin }` between `suspender` and `backup`. It has a heading **Pinned tabs**, a checkbox labelled **Keep pinned tabs open when the window switches workspace**, a muted line `Pinned tabs then belong to the window and are not saved in a workspace.`, and a **Save settings** button that calls `save()`. `load` and `save` include the checkbox state.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/store/device.ts lib/ui/settings-form.ts lib/ui/Settings.tsx lib/ui/icons.ts tests/ui/settings-form.test.ts tests/messages.test.ts tests/store/workspaces.test.ts
git commit -m "feat: add keep pinned tabs setting"
```

### Task 2: Saves skip pinned tabs

**Files:**
- Modify: `lib/model/capture.ts` (`captureTabs`)
- Modify: `lib/actions/save.ts` (`saveWindow`), `lib/actions/window.ts` (`createFromWindow`)
- Test: `tests/model/capture.test.ts`, `tests/actions/save.test.ts`

**Interfaces:**
- Consumes: `getSettings()` and `Settings.keepPinnedTabs` from Task 1.
- Produces: `captureTabs(live, previous, tabMap, managerBase, newId, options?: { skipPinned?: boolean }): CaptureResult`. With `skipPinned`, a pinned live tab is left out of `tabs` and `tabIds`.

- [ ] **Step 1: Write the failing tests**

In `tests/model/capture.test.ts`, add `leaves out pinned tabs with skipPinned`: live tabs are the manager, a pinned `https://mail.test/` and an unpinned `https://a.test/`. With `{ skipPinned: true }`, `result.tabs` holds only `https://a.test/` at index 0, and `result.tabIds` has one entry. Without the option, both tabs are captured.

In `tests/actions/save.test.ts`, add a `describe('saveWindow with keepPinnedTabs')` that calls `setSettings({ suspendAfterMinutes: 20, allowlist: [], keepPinnedTabs: true })` in `beforeEach`:
- `does not save pinned tabs`: a window with `https://a1.test/` and a pinned `https://mail.test/` (`createTab({ …, pinned: true })`). After `createFromWindow`, the workspace tabs are `['https://a1.test/']`.
- `drops saved pinned tabs from the workspace`: a workspace saved with the setting off holds a pinned tab. Turn the setting on, call `saveWindow`, and expect the pinned URL to be gone from the workspace.
- `saves a tab after it is unpinned`: a pinned tab is not saved. Set the fake tab's `pinned` to `false`, call `saveWindow`, and expect its URL in the workspace.

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npx vitest run tests/model/capture.test.ts tests/actions/save.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- `captureTabs` skips a tab with `tab.pinned` when `options.skipPinned` is true, in the same loop that skips the manager tab. Update its docblock.
- `saveWindow` and `createFromWindow` read `(await getSettings()).keepPinnedTabs` and pass `{ skipPinned }`. In `saveWindow`, read it before `updateWorkspace`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/model/capture.ts lib/actions/save.ts lib/actions/window.ts tests/model/capture.test.ts tests/actions/save.test.ts
git commit -m "feat: skip pinned tabs in saves when kept by window"
```

### Task 3: The switch keeps pinned tabs

**Files:**
- Modify: `lib/actions/switch.ts` (`switchWindow`, `sourceTabsToClose`)
- Modify: `README.md` (Settings section), `CHANGELOG.md` (new `## [Unreleased]` with `### Added`)
- Test: `tests/actions/switch.test.ts`

**Interfaces:**
- Consumes: `Settings.keepPinnedTabs` from Task 1, `captureTabs` `skipPinned` (through `saveWindow`) from Task 2, `normalizeUrl` from `lib/model/workspace.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/actions/switch.test.ts`, add `describe('switchWindow with keepPinnedTabs')`. `beforeEach` runs `fakeBrowser.reset()`, `markStartupDone()` and sets the setting on. Each test builds window A with `https://a1.test/` and a pinned `https://mail.test/`, then calls `createFromWindow`.
- `keeps pinned tabs open`: switch to `closedB()`. The pinned `https://mail.test/` tab keeps its tab ID and stays pinned. `https://a1.test/` is closed. The `b1` and `b2` tabs are open, and `b2` is pinned.
- `does not open a saved pinned tab that is already open`: workspace B holds a pinned saved tab `https://MAIL.test/#inbox`. After the switch, the window has one tab whose `normalizeUrl` is `https://mail.test/`.
- `keeps pinned tabs when the switch rolls back`: copy the failure setup of `closes the new tabs and goes back when the old tabs cannot close`, which fails after the B tabs open, from the `switchWindow when a step fails` block. After the error, `https://mail.test/` and `https://a1.test/` are open, and no B tab is open.

Add `closes pinned tabs with the setting off` to `describe('switchWindow')`: the same window, setting off. After the switch, `https://mail.test/` is not open, and workspace A holds it with `pinned: true`.

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npx vitest run tests/actions/switch.test.ts`
Expected: FAIL on the three `keepPinnedTabs` tests. The setting-off test PASSES already.

- [ ] **Step 3: Implement**

- `switchWindow` reads `keepPinnedTabs` once, after the early returns.
- When it is on, the tabs to open are `target.tabs` without each pinned saved tab whose `normalizeUrl(saved.finalUrl || saved.url)` equals `normalizeUrl` of a pinned tab in `current` (the manager tab excluded). Pass that list to `openSavedTabs`.
- `sourceTabsToClose` gets a `keepPinned: boolean` parameter. When it is true, the first filter also leaves out pinned tabs. Update its docblock and the `switchWindow` docblock.
- `README.md`, Settings section, add after **Allowlist**: `- **Pinned tabs.** Turn on **Keep pinned tabs** to keep pinned tabs open when the window switches to another workspace. Pinned tabs then belong to the window. Doca does not save them in a workspace. The setting is off by default.`
- `CHANGELOG.md`: add `## [Unreleased]` above `## [1.1.0]`, with `### Added` and one entry: `A **Keep pinned tabs** setting keeps pinned tabs open when the window switches to another workspace. Doca then does not save pinned tabs in a workspace.`

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/switch.ts tests/actions/switch.test.ts README.md CHANGELOG.md docs/superpowers
git commit -m "feat: keep pinned tabs open on workspace switch"
```
