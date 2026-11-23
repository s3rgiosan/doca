# Keep pinned tabs open on a workspace switch

## Intent

The user pins tabs such as mail and chat that they want in every workspace. Today a switch closes every tab of the old workspace, pinned tabs included, so those tabs close and reload on each switch. With this change, pinned tabs stay open in the window when the window switches to another workspace.

## Goals

- A new setting, **Keep pinned tabs**, off by default. It sits in Settings next to the tab suspender and the allowlist.
- With the setting on, a pinned tab belongs to the window, not to a workspace:
  - A switch in the same window keeps every pinned tab open.
  - A save skips pinned tabs, so no workspace collects them.
  - A new workspace made from a window (`createFromWindow`) skips pinned tabs too.
- With the setting off, Doca behaves as it does today.

## Non-goals

- A shared list of pinned tabs that every window opens. **Open in new window** gives a window without the pinned tabs of other windows.
- Doca does not save pinned tabs anywhere when the setting is on. Closing the window loses them. Browser session restore still brings them back after a restart.
- No change to **Move to…** or drag and drop. A pinned tab can still move to another workspace.

## Anti-goals

- Duplicate pinned tabs after a switch.
- A change in behaviour for users who do not turn the setting on.

## Approaches

- **A. Pinned tabs belong to the window (picked).** Small change in the switch and save paths, no new stored data, nothing to keep in step between windows.
- **B. One shared pinned list for all workspaces.** Every window gets the pinned tabs, and the list survives a closed window. Doca has to keep the list in step across windows and can open the same tab in two windows. Much more code and many more edge cases.

The user picked A.

## Design

- `Settings` in `lib/store/device.ts` gets `keepPinnedTabs: boolean`. Settings stored by an older version have no such field, so a missing field reads as `false`. `validateSettings`, the settings form (`lib/ui/settings-form.ts`, `lib/ui/Settings.tsx`) and `hasUnsavedChanges` cover the new field.
- `captureTabs` gets an option to skip pinned live tabs. `saveWindow` and `createFromWindow` pass the setting to it.
- `switchWindow`, with the setting on:
  - `sourceTabsToClose` leaves pinned tabs out, so they stay open.
  - From the saved tabs of the target workspace, a pinned saved tab whose normalized URL is already open in the window does not open again. Other saved tabs open as today.
- Rollback after a failed switch keeps working: it closes only the tabs that the switch created.

## Consequences of the setting (my calls, for review)

- With the setting on, the first save of a workspace drops its saved pinned tabs from its list, because the tabs now belong to the window.
- A pinned saved tab of the target workspace that is not open yet opens pinned and then belongs to the window.
- Unpinning a tab makes it part of the current workspace at the next save. Pinning a tab takes it out of the workspace at the next save.
- Turning the setting off makes the pinned tabs of a window part of the workspace that the window shows, at the next save.

## Left to the builder

- The exact label and help text of the setting.
- Tests for the switch, the save and the settings validation, in the style of `tests/actions/switch.test.ts` and `tests/actions/save.test.ts`.
- A README line in the Settings section and a CHANGELOG entry.
