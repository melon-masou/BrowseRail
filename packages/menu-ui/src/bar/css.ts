import type { MenuView } from "@browserail/protocol";

export function createBarCss(root: HTMLElement) {
  const tree = root.getRootNode() as Document | ShadowRoot;
  const scope = crypto.randomUUID();
  const doc = root.ownerDocument;
  let sheets: CSSStyleSheet[] = [];
  let source = "";
  function remove(): void {
    if (!sheets.length) return;
    // Firefox rejects assigning content-script arrays through its page wrapper.
    for (let index = tree.adoptedStyleSheets.length - 1; index >= 0; index--) {
      if (sheets.includes(tree.adoptedStyleSheets[index]!)) tree.adoptedStyleSheets.splice(index, 1);
    }
    sheets = [];
  }
  return {
    update(rail: HTMLElement, menu: Pick<MenuView, "uid" | "globalCss">): void {
      rail.dataset.menuUid = menu.uid;
      rail.dataset.barCss = scope;
      const nextSource = JSON.stringify(menu.globalCss);
      if (nextSource === source) return;
      const next: CSSStyleSheet[] = [];
      const global = Object.keys(menu.globalCss ?? {}).sort().map(key => menu.globalCss![key]);
      for (const css of global) {
        if (!css?.trim()) continue;
        const sheet = new doc.defaultView!.CSSStyleSheet();
        sheet.replaceSync(css);
        // Parse before nesting so stray braces cannot end the bar's selector scope.
        const rules = Array.from(sheet.cssRules, rule => rule.cssText).join("\n");
        sheet.replaceSync(`[data-bar-css="${scope}"] {\n${rules}\n}`);
        next.push(sheet);
      }
      remove(); sheets = next; source = nextSource;
      if (sheets.length) tree.adoptedStyleSheets.push(...sheets);
    },
    destroy(): void { remove(); },
  };
}
