# BrowseRail

BrowseRail is an external bookmark panel for browsers. It can be placed anywhere on your desktop or attached to a browser window, without modifying the page itself.

**This project is heavily vibe-coded. Things may break in unexpected ways.**

## Installation

BrowseRail consists of a browser extension and a desktop app. The extension manages bookmarks and configuration, while the desktop app displays the panels as separate desktop windows.

1. Download ans install the BrowseRail extension for your browser from [Releases](https://github.com/melon-masou/BrowseRail/releases).
2. For native mode, download and run the BrowseRail desktop app.
    > Native mode currently supports Windows only.
3. Open the extension settings to create a menu and select the bookmarks or folders you want to display.

## Development

    pnpm install
    pnpm check
    pnpm test
    pnpm build

    # When building the Windows executable from WSL, use the xwin build directly:
    pnpm build:windows