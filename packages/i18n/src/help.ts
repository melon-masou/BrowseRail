// Long-form "Start" help shown on the options page. Kept in the i18n package so
// it lives with the translations, but as one marked-up document per language
// rather than many scattered message keys. The markup is trusted static HTML.

import type { Lang } from ".";

export const helpDoc: Record<Lang, string> = {
  en: `
<div class="help-doc">
  <h2>Choose an embedding mode</h2>
  <ul>
    <li><strong>Native mode</strong>: shows the bar in a separate desktop window, attached to a browser window or floating freely. Currently Windows only; requires the desktop app.</li>
    <li><strong>Browser mode</strong>: the extension injects the bar into web pages. No desktop app required; grant permission in the Instance tab before use.</li>
  </ul>

  <h2>Add bookmarks</h2>
  <ul>
    <li><strong>Browser bookmarks</strong>: use existing bookmarks and folders. Flatten a folder to show its bookmarks directly on the bar.</li>
    <li><strong>Static bookmarks</strong>: set a name and URL without adding them to browser bookmarks.</li>
    <li><strong>Dynamic bookmarks</strong>: when you visit a page, a custom function runs to update the bookmark's saved URL.</li>
    <li><strong>Temporary bookmarks</strong>: long-press to save the current page's URL.</li>
  </ul>

  <h2>How to use</h2>
  <ul>
    <li>Create bookmarks in the Custom bookmarks tab, then add them to a bar in the Menus tab. Browser bookmarks can be added directly from the Menus tab.</li>
    <li>Left-click a bookmark to open it in the current tab; right-click to open it in a new tab. These are reversed when configured to open in a new tab.</li>
    <li>Hover over a folder to expand it.</li>
    <li>Long-press a temporary bookmark to save the current page's URL.</li>
    <li>Check “Edit menus” in the extension icon's context menu, then left-click the bar to adjust its size and position.</li>
  </ul>
</div>
`,
  "zh-CN": `
<div class="help-doc">
  <h2>选择嵌入模式</h2>
  <ul>
    <li><strong>Native 模式</strong>：显示为独立的桌面窗口，可依附浏览器窗口或自由悬浮。目前仅支持 Windows，需要运行桌面端。</li>
    <li><strong>浏览器模式</strong>：通过扩展注入到网页中，无需桌面端；使用前需在「实例」页授权。</li>
  </ul>

  <h2>添加书签</h2>
  <ul>
    <li><strong>浏览器收藏夹</strong>：使用浏览器已有的书签和文件夹。可摊平文件夹，把其中的书签直接放到栏上。</li>
    <li><strong>静态书签</strong>：直接配置名称和网址，无需加入浏览器收藏夹。</li>
    <li><strong>动态书签</strong>：访问网页时运行自定义函数，更新书签保存的网址。</li>
    <li><strong>临时书签</strong>：长按记住当前页面的网址。</li>
  </ul>

  <h2>使用方法</h2>
  <ul>
    <li>在「自定义书签」页添加书签，再到「菜单」页将其添加到栏中。浏览器收藏夹可直接从「菜单」页添加。</li>
    <li>左键点击书签在当前标签打开，右键在新标签打开；配置为新标签打开时，两者互换。</li>
    <li>悬停文件夹展开。</li>
    <li>长按临时书签保存当前页面的网址。</li>
    <li>在扩展图标的右键菜单中勾选「编辑菜单」，再左键点击栏调整大小和位置。</li>
  </ul>
</div>
`,
};
