# BrowseRail

BrowseRail puts your bookmarks in customizable bars, with configurable colors, layout, folder menus, and shortcuts.

**This project is heavily vibe-coded. Things may break in unexpected ways.**

## Modes

- **Native mode:** displays bars in separate desktop windows, attached to a browser window or floating freely. Requires the desktop app. Currently supports Windows only.
- **Browser mode:** injects bars into web pages through the extension or a standalone userscript. Works without the desktop app. When using the extension, grant website permissions in its **Instance** tab before using it.

## Bookmarks

- **Browser bookmarks:** use existing bookmarks and folders. Flatten a folder to place its bookmarks directly on the bar.
- **Static bookmarks:** save names and URLs in the extension.
- **Temporary bookmarks:** hold a button to save the current page.
- **Dynamic bookmarks:** update the saved URL through URL matching, regex rewrites, or external extensions and userscripts.

## Advanced usage

- [Update bookmarks via External API](docs/external-bookmarks.md)
- [Custom bar CSS](docs/custom-css.md)
- [Bar stylesheet](packages/menu-ui/src/css/bar.css)

## Installation

### Extension

- Download and install the extension for Chrome or Firefox from [Releases](https://github.com/melon-masou/BrowseRail/releases).
- For Native mode, download and run the Windows desktop app.
- Open the extension settings, create a menu, and add bookmarks or folders.

### Userscript

- Install a userscript manager and `BrowseRail-<version>.user.js` from [Releases](https://github.com/melon-masou/BrowseRail/releases).
- Open a web page and select **Open settings** from BrowseRail’s menu in the userscript manager. Create a menu and add custom bookmarks.

The userscript runs independently of the extension and desktop app, storing settings separately. Browser bookmarks and browser/desktop shortcuts are unavailable in userscript version.

## Usage

- Left-click a bookmark to open it in the current tab; right-click to open it in a new tab.
- Hover over a folder to expand it.
- Hold a temporary bookmark button to save the current page.
- Enable **Edit mode** in the settings or from context menu to adjust bar positions, sizes, spacing.

## Development

    pnpm install
    pnpm check
    pnpm test
    pnpm build

    # Build only the extension and its workspace dependencies:
    pnpm build:extension
    # Build only the standalone userscript:
    pnpm build:userscript
    # Build only the Windows executable:
    pnpm build:windows
