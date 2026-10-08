# Update bookmarks via External API

## Extensions

In **Instance** tab, enable **Allow extensions to access the API** and add the calling extension's ID to the allowlist.

```js
// For Firefox, use browser.runtime.sendMessage(...) instead
const result = await chrome.runtime.sendMessage("BROWSERAIL_EXTENSION_ID", {
  type: "bookmark.update",
  payload: { uid: "BOOKMARK_UID", url: "https://example.com/page" }
});
if (!result.ok) console.error(result.error, result.errmsg);
```

## Userscripts

In **Instance** tab, enable **Allow userscripts to access the API**. Access to the source website should also be granted.
This example updates the bookmark with GitHub repository owner's URL and stores id as `github.author` external variable:

```js
// ==UserScript==
// @name         BrowseRail - GitHub owner
// @version      1.0
// @match        https://github.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        window.onurlchange
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const TOKEN = "INSTANCE_TOKEN";  // Replace with the token from: Instance tab -> Allow userscripts to access the API -> Allowlist
  const UID = "BOOKMARK_UID";      // Replace with the UID from: dynamic bookmark -> API update -> UID

  function send(type, payload) {
    document.dispatchEvent(new CustomEvent(`browserail:${TOKEN}`, {
      detail: JSON.stringify({ type, payload })
    }));
  }

  function update() {
    const match = location.href.match(
      /^https:\/\/github\.com\/([^/?#]+)\/[^/?#]+(?:[/?#].*)?$/
    );
    if (!match) return;

    const author = match[1];
    send("bookmark.update", { uid: UID, url: `https://github.com/${author}` });
    send("data.update", { key: "github.author", data: author });
  }

  window.addEventListener("urlchange", update);
  update();
})();
```
