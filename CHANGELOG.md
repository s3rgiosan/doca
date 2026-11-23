# Changelog

All notable changes to Doca will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A **Keep pinned tabs** setting keeps pinned tabs open when the window switches to another workspace. Doca then does not save pinned tabs in a workspace.

## [1.1.0] - 2026-11-19

### Added

- In the Doca tab, a card beside a sidebar workspace lists its saved tabs when you rest the pointer on the workspace or move the keyboard focus to it.

## [1.0.3] - 2026-11-17

### Changed

- The README explains the permissions that Doca asks for, and lists the tab search, Select all, the popup tab list and Ctrl-click or Cmd-click to open a workspace in a new window.

### Fixed

- Import gives new IDs to workspaces and tabs whose IDs are not valid or repeat in the file, so a crafted file cannot overwrite the workspace list or another imported workspace.
- Import skips tabs whose address cannot be reopened safely, such as `javascript:` and `data:` addresses, and rejects files with more than 500 workspaces or a workspace with more than 1000 tabs.
- Doca checks the settings before it saves them.
- A workspace assigned to a window keeps all its saved tabs while the missing tabs open.
- When the save of one workspace fails, the other workspaces still save, and the failed save runs again.
- A workspace that fails to open in a new window no longer blocks its saves for a minute.
- The `doca` address bar keyword waits for Doca to start, so it does not open a second window for a workspace that is already open.
- **Move to…** a new workspace no longer leaves an empty workspace when no selected tab can move.
- A suspended tab keeps its saved identity when the browser gives it a new tab ID.
- In **Move to…**, the highlighted workspace stays in place when the tab list refreshes. Enter on a closed list opens it.
- The Doca tab and the popup show an error when they cannot load, and an older load no longer replaces a newer one.
- An error from creating a workspace no longer shows in the Rename dialog, and page errors clear when you change the selection or the search.
- Clicking a tab that has just closed shows a message.
- Favicons load only from secure or inline sources, with no referrer.
- Short addresses keep look-alike international domain names in their `xn--` form and remove hidden direction characters.
- A tab with no title and no address shows "Untitled tab".

### Security

- The release workflow pins its actions to commit SHAs and no longer replaces a published zip.

## [1.0.2] - 2026-11-17

### Added

- Each release has the extension zip, built and tested from the tagged code. The README explains how to install Doca from it.

## [1.0.1] - 2026-11-17

### Added

- The pinned Doca tab shows the initials of its workspace on the workspace colour, so you can see the workspace of a window from its tab strip.
- The Doca tab search has a Clear button, and the Escape key clears the search.
- A Select all checkbox shows when at least one tab is selected. It selects or clears all the tabs that the search shows.
- The current workspace stays in the sidebar while you search, shown muted when its name does not match.

### Changed

- The interface has a new flat and square look with the Geist typeface, custom checkboxes and menus, and colours that meet WCAG 2.2 AA contrast.
- The tab list fills the width of the page and uses a larger text size.
- A tab shows its title with a short address after it. A tab with no real title shows its short address as the title.
- The page heading and the selection bar stay at the top while the tab list scrolls. The bar keeps its height, so the list does not move when you select a tab.
- The sidebar keeps its brand and New workspace button in place while the workspace list scrolls.
- The workspace pickers look like dropdowns, with a down arrow, and do not take the focus when the popup opens.
- Workspace names sort in number order, so "Project 2" comes before "Project 10".
- The extension has new icons, with a separate icon for the toolbar.
- Doca supports Chromium-based browsers from version 111. It is tested in Chrome and Brave.

### Fixed

- The workspace menu opens fully, and the sidebar no longer cuts it off.
- The focus ring of the workspace menu button shows fully at the edge of the sidebar.

## [1.0.0] - 2026-11-13

### Added

- Each workspace owns one browser window, with a pinned Doca tab at the first position that lists your workspaces and the tabs of the window.
- Workspaces are stored only in the browser, work offline and need no account.
- A workspace has one of 8 colours, picked in the New workspace and Edit workspace dialogs, and shown as a dot in the sidebar, the page heading and the workspace pickers.
- The Doca tab switches between workspaces in the same window, and opens a workspace in a second window from its menu or with a modifier click.
- The toolbar popup, opened with the `Alt+Shift+W` shortcut, moves the current tab to an existing or a new workspace, or saves all the tabs of a window that has no workspace.
- Tabs move to another workspace from the Doca tab with the Move to picker or by drag and drop onto the sidebar.
- A message with an Undo button shows after tabs move or a workspace is deleted. Deleting the workspace of the current window closes its Doca tab and has no undo.
- The `doca` address bar keyword switches to a workspace by name.
- The Doca tab shows an empty state with a New workspace button when no workspace exists, and a loading state while it loads.
- The tab suspender discards idle tabs after a number of minutes that you set for all workspaces, and skips the active tab, pinned tabs, tabs that play sound, the Doca tab and hosts on the allowlist.
- Settings are in the Doca tab and on the extension settings page. They ask Save changes? when you close them with unsaved edits, and the settings page warns before you leave it.
- Export writes all workspaces to a JSON file, and import adds the workspaces of such a file without replacing any workspace.
- Workspaces return to their windows after a browser restart, and a workspace that opens loads its first tab and keeps the other tabs suspended until you click them.
- The interface follows the light or dark colour scheme of the system.

[Unreleased]: https://github.com/s3rgiosan/Doca/compare/1.1.0...HEAD
[1.1.0]: https://github.com/s3rgiosan/Doca/compare/1.0.3...1.1.0
[1.0.3]: https://github.com/s3rgiosan/Doca/compare/1.0.2...1.0.3
[1.0.2]: https://github.com/s3rgiosan/Doca/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/s3rgiosan/Doca/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/s3rgiosan/Doca/releases/tag/1.0.0
