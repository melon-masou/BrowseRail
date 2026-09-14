# BrowseRail

BrowseRail provides external bookmark controls attached to browser windows without modifying page DOM.

## Language

**Browser Instance**:
One independently running extension instance. A browser launched with a different user data directory has a separate Browser Instance.
_Avoid_: Browser process, browser brand

**Bound Window**:
The top-level browser window associated with one Panel and the exclusive target of its Actions.
_Avoid_: Current browser, active browser

**Panel**:
A logical collection of independently placed Menus attached to one Bound Window.
_Avoid_: Overlay, sidebar

**Menu**:
A configured row or column of Menu Items with its own Placement inside a Panel.
_Avoid_: Toolbar, menu window

**Menu Item**:
A bookmark or Bookmark Folder reference included in one Menu.
_Avoid_: Button configuration, layout cell

**Placement**:
A Menu's anchor, offset from that anchor, width, and height relative to its Bound Window.
_Avoid_: Margin, corner

**Customize Mode**:
A Desktop-owned editing state for changing one Menu's Placement before submitting it to its Browser Instance.
_Avoid_: Edit page, layout mode

**Attachment Mode**:
The rule that selects which browser windows in a Browser Instance receive Panels.
_Avoid_: Window mode, display mode

**Action**:
An extension-owned operation referenced by an opaque UID and invoked for one Bound Window.
_Avoid_: Command, link

**Bookmark Folder**:
A bookmark container rendered as a cascading Popup from a Menu.
_Avoid_: Folder action

**Popup**:
A temporary cascading surface opened from one Bookmark Folder and owned by its Menu.
_Avoid_: Native menu, submenu window
