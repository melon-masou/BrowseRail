# BrowseRail

BrowseRail is an external bookmark panel for Chrome and Firefox. The extension owns browser state and configuration; the Tauri app renders panels attached to browser windows without touching page DOM.

## Development

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

Run the desktop app with `pnpm tauri dev`. Build either extension target with `pnpm --filter @browserail/extension build:chrome` or `pnpm --filter @browserail/extension build:firefox`.
