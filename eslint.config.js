import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nounsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/", "build/", "**/dist/", "**/target/", "apps/desktop/src-tauri/gen/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nounsanitized.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, ...globals.node } },
    rules: {
      // A leading underscore marks a parameter or binding that is deliberately unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
