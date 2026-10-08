# BrowseRail

BrowseRail puts your bookmarks in customizable bars, with configurable colors, layout, folder menus, and shortcuts.

**This project is heavily vibe-coded. Things may break in unexpected ways.**

## Modes

- **Native mode:** displays bars in separate desktop windows, attached to a browser window or floating freely. Requires the desktop app. Currently supports Windows only.
- **Browser mode:** injects bars into web pages. Works without the desktop app. Grant website permissions in the extension’s **Instance** tab before using it.

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

- Download and install the extension for Chrome or Firefox from [Releases](https://github.com/melon-masou/BrowseRail/releases).
- For Native mode, download and run the Windows desktop app.
- Open the extension settings, create a menu, and add bookmarks or folders.

## Usage

- Left-click a bookmark to open it in the current tab; right-click to open it in a new tab.
- Hover over a folder to expand it.
- Hold a temporary bookmark button to save the current page.
- Enable **Edit mode** in the extension settings or from the extension icon’s context menu to adjust bar positions, sizes, spacing, and settings.

## Development

    pnpm install
    pnpm check
    pnpm test
    pnpm build

    # Rebuild the extension and its workspace dependencies:
    pnpm build:extension

    # Build the Windows executable from WSL:
    pnpm build:windows
