// Start-page help lives with the translations and is rendered as DOM elements.
import type { Lang } from "./lang";

interface HelpSection {
  readonly title: string;
  readonly items: readonly (string | { readonly label: string; readonly text: string })[];
}

export const helpDoc: Record<Lang, readonly HelpSection[]> = {
  "en": [
    {
      "title": "Choose an embedding mode",
      "items": [
        {
          "label": "Native mode",
          "text": ": shows the bar in a separate desktop window, attached to a browser window or floating freely. Currently Windows only; requires the desktop app."
        },
        {
          "label": "Browser mode",
          "text": ": the extension injects the bar into web pages. No desktop app required; grant permission in the Instance tab before use."
        }
      ]
    },
    {
      "title": "Add bookmarks",
      "items": [
        {
          "label": "Browser bookmarks",
          "text": ": use existing bookmarks and folders. Flatten a folder to show its bookmarks directly on the bar."
        },
        {
          "label": "Static bookmarks",
          "text": ": set a name and URL without adding them to browser bookmarks."
        },
        {
          "label": "Dynamic bookmarks",
          "text": ": update the saved URL through URL matching, regex rewrites, or the external API."
        },
        {
          "label": "Temporary bookmarks",
          "text": ": long-press to save the current page's URL."
        }
      ]
    },
    {
      "title": "How to use",
      "items": [
        "Create bookmarks in the Custom bookmarks tab, then add them to a bar in the Menus tab. Browser bookmarks can be added directly from the Menus tab.",
        "Left-click a bookmark to open it in the current tab; right-click to open it in a new tab.",
        "Hover over a folder to expand it. Left-click to pin it temporarily; left-click again or click a bookmark or outside to release it. Right-click to lock it; click the same folder again with either button to unlock.",
        "Long-press a temporary bookmark to save the current page's URL.",
        "Check “Edit mode” in the extension icon's context menu, then left-click the bar to adjust its size and position."
      ]
    }
  ],
  "zh-CN": [
    {
      "title": "选择嵌入模式",
      "items": [
        {
          "label": "Native 模式",
          "text": "：显示为独立的桌面窗口，可依附浏览器窗口或自由悬浮。目前仅支持 Windows，需要运行桌面端。"
        },
        {
          "label": "浏览器模式",
          "text": "：通过扩展注入到网页中，无需桌面端；使用前需在「实例」页授权。"
        }
      ]
    },
    {
      "title": "添加书签",
      "items": [
        {
          "label": "浏览器收藏夹",
          "text": "：使用浏览器已有的书签和文件夹。可摊平文件夹，把其中的书签直接放到栏上。"
        },
        {
          "label": "静态书签",
          "text": "：直接配置名称和网址，无需加入浏览器收藏夹。"
        },
        {
          "label": "动态书签",
          "text": "：通过网址匹配、正则改写或外部接口更新保存的网址。"
        },
        {
          "label": "临时书签",
          "text": "：长按记住当前页面的网址。"
        }
      ]
    },
    {
      "title": "使用方法",
      "items": [
        "在「自定义书签」页添加书签，再到「菜单」页将其添加到栏中。浏览器收藏夹可直接从「菜单」页添加。",
        "左键点击书签在当前标签打开，右键在新标签打开。",
        "悬停文件夹展开，左键点击可临时固定，再次左键点击、点击书签或外部解除。右键点击锁定，再用左键或右键点击同一文件夹解除。",
        "长按临时书签保存当前页面的网址。",
        "在扩展图标的右键菜单中勾选「编辑模式」，再左键点击栏调整大小和位置。"
      ]
    }
  ]
};
