import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nounsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

const packageRoots = new Map();
function packageRoot(path) {
  let dir = existsSync(path) && statSync(path).isDirectory() ? path : dirname(path);
  const visited = [];
  while (!packageRoots.has(dir)) {
    visited.push(dir);
    if (existsSync(resolve(dir, "package.json")) || dirname(dir) === dir) { packageRoots.set(dir, dir); break; }
    dir = dirname(dir);
  }
  const root = packageRoots.get(dir);
  for (const entry of visited) packageRoots.set(entry, root);
  return root;
}

// Workspace packages depend on each other only through package names, so dependencies stay visible in
// package.json. The desktop reads the shared i18n JSON catalogs in place.
const noCrossPackageRelative = {
  meta: {
    type: "problem",
    messages: { crossPackage: "Import another workspace package by its package name instead of \"{{specifier}}\"." },
  },
  create(context) {
    const own = packageRoot(context.filename);
    function check(node) {
      if (node?.type !== "Literal" || typeof node.value !== "string" || !/^\.\.?\//.test(node.value)) return;
      const target = resolve(dirname(context.filename), node.value.split("?")[0]);
      if (/[\\/]packages[\\/]i18n[\\/].+\.json$/.test(target)) return;
      if (packageRoot(target) !== own) context.report({ node, messageId: "crossPackage", data: { specifier: node.value } });
    }
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
      CallExpression(node) {
        const callee = node.callee;
        const isRequire = callee.type === "Identifier" && callee.name === "require";
        const isViModule = callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "vi"
          && callee.property.type === "Identifier" && ["mock", "doMock", "importActual"].includes(callee.property.name);
        if (isRequire || isViModule) check(node.arguments[0]);
      },
    };
  },
};

export default tseslint.config(
  { ignores: ["**/node_modules/", "build/", "**/dist/", "**/target/", "apps/desktop/src-tauri/gen/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nounsanitized.configs.recommended,
  {
    plugins: { workspace: { rules: { "no-cross-package-relative": noCrossPackageRelative } } },
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, ...globals.node } },
    rules: {
      // A leading underscore marks a parameter or binding that is deliberately unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "workspace/no-cross-package-relative": "error",
    },
  },
);
