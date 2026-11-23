# Local release: manual checks

Do these checks in Chrome and in Brave. Load the build from `.output/chrome-mv3` as described in `README.md`. Write "pass" or "fail" in each browser column, and add notes for each failure.

| # | Check | Chrome | Brave | Notes |
|---|---|---|---|---|
| 1 | Workspaces survive a browser restart with no Google or GitHub account. | | | |
| 2 | A restored workspace with 30 tabs opens with all tabs but one discarded (check `chrome://discards`). | | | |
| 3 | Every bound window gets its binding back after a browser restart. | | | |
| 4 | Switching focuses the right window, including a minimized window. | | | |
| 5 | After a workspace's window closes and the browser restarts, a window with some of the same URLs does not bind to that workspace. | | | |
| 6 | **Move to…** an open workspace moves the tabs into its window. **Move to…** a closed workspace adds the tabs to it and closes them here. Dragging a tab onto a workspace in the sidebar moves it. | | | |
| 7 | Memory of the Doca tab with 10 windows open (Task Manager). | | | |
| 8 | Memory drops on 30 idle tabs after the timeout. Active, pinned and audible tabs, the Doca tab and allowlisted hosts are not discarded. | | | |
| 9 | An export from one browser imports into the other with the same workspaces and tabs. | | | |
| 10 | The `Alt+Shift+W` shortcut opens the popup, and the popup moves the current tab. The `doca` address bar keyword switches workspaces. | | | |
| 11 | Switching workspace in the Doca tab keeps one window. The old workspace's tabs, including a tab opened just before the switch, are all there when you switch back. | | | |
| 12 | **New workspace** and **Rename** set a name and one of 8 colours. The dot shows in the sidebar, the page heading and the pickers. | | | |
| 13 | After a delete or a move, **Undo** brings back the workspace or the tabs. Deleting the workspace of the current window closes the Doca tab with no undo. | | | |
| 14 | Settings with unsaved edits ask **Save changes?** in the Doca tab. The settings page asks before it closes. | | | |
| 15 | Resting the pointer on a sidebar workspace, other than the current one, shows a card with its saved tabs. The card stays open while the pointer moves onto it, and `Escape`, a click or a scroll closes it. Keyboard focus on the workspace opens it too. | | | |
| 16 | With **Keep pinned tabs** on, switching workspace keeps the pinned tabs open and opens no second copy of them. The Doca tab and the popup list them under **Pinned in this window**. With the setting off, pinned tabs close and come back with their workspace. | | | |
