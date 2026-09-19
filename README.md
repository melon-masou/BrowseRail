# BrowseRail

BrowseRail is an external bookmark panel for browsers. It can be placed anywhere on your desktop or attached to a browser window, without modifying the page itself.

**This project is heavily vibe-coded. Things may break in unexpected ways.**

## Installation

> Currently Windows only.

1. Download and run the BrowseRail desktop app from [Releases](https://github.com/melon-masou/BrowseRail/releases).
2. Install the BrowseRail extension for your browser.
3. Start BrowseRail and open the extension settings.

## Usage

Open the extension settings to create a menu and select the bookmarks or folders you want to display.

Save the configuration, then place the panel anywhere on your desktop or attach it to a browser window.

## How it works

BrowseRail consists of a browser extension and a desktop app.

The extension manages bookmarks and configuration, while the desktop app displays the panels as separate desktop windows. They communicate locally, so BrowseRail does not inject scripts into or modify the browser page.

## Development

    pnpm install
    pnpm check
    pnpm test
    pnpm build

    # When building the Windows executable from WSL, use the xwin build directly:
    pnpm build:windows