import { registerRuntimeAdapter, type RuntimeAdapter, type RuntimeHost } from "@browserail/runtime-adapter";
import { mountOptionsPage } from "@browserail/browserail/pages/options/page";
import template from "@browserail/browserail/settings-template?raw";
import styles from "@browserail/browserail/settings.css?inline";

// The build wraps this entry in a factory bound to the iframe's document environment.
export async function mount(adapter: RuntimeAdapter, host: RuntimeHost) {
  registerRuntimeAdapter(adapter, host);
  const parsed = new DOMParser().parseFromString(template, "text/html");
  document.head.replaceChildren(...parsed.head.childNodes);
  document.body.replaceChildren(...parsed.body.childNodes);
  document.documentElement.lang = parsed.documentElement.lang;
  for (const image of document.querySelectorAll<HTMLImageElement>('img[src^="/icons/"]'))
    image.src = adapter.resourceUrl(image.getAttribute("src")!.slice(1));
  const notice = document.createElement("p");
  notice.className = "userscript-notice";
  notice.dataset.i18n = "userscript.featureNotice";
  document.getElementById("settings-content")!.prepend(notice);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles + "\n.userscript-notice { margin: 0; padding: 12px 20px; color: #64748b; font-size: 12px; line-height: 1.5; }");
  document.adoptedStyleSheets.push(sheet);
  return mountOptionsPage();
}
