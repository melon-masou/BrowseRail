import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [{
    name: "settings-environment",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        // Bind the bundled UI to the iframe without compiling strings at runtime.
        chunk.code = `(function (window) {
          const { document, navigator, localStorage, CSSStyleSheet, DOMParser, HTMLElement, HTMLInputElement,
            HTMLTextAreaElement, Node, AbortController, URL, Blob, Headers, TextEncoder, WebSocket, crypto } = window;
          const fetch = window.fetch.bind(window), btoa = window.btoa.bind(window),
            setTimeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window),
            structuredClone = window.structuredClone.bind(window);
          ${chunk.code}
          return BrowseRailSettings;
        })`;
      }
    },
  }],
  build: {
    write: false,
    lib: { entry: fileURLToPath(new URL("src/settings.ts", import.meta.url)), formats: ["iife"], name: "BrowseRailSettings" },
  },
});
