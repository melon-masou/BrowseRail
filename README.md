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

When building the Windows executable from WSL, use the xwin build directly:

```sh
pnpm build:windows
```

Do not use Windows-native Cargo from WSL: reading the repository through the WSL/UNC filesystem makes compilation substantially slower. The xwin build writes the executable to `build/desktop/BrowseRail.exe`.
