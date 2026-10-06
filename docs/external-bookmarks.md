# Bookmark updates via API

Create a dynamic bookmark, select **API update**, assign a URL matching rule, and copy its UID.
Updates save an HTTP(S) URL matching that rule without opening it.

## Extensions

In **Instance**, enable **Allow extensions to access the API**, add the sender's extension ID to the allowlist, and save.
Send from the calling extension's background script (Chrome example; use `browser` in Firefox):

```js
const result = await chrome.runtime.sendMessage("BROWSERAIL_EXTENSION_ID", {
  type: "bookmark.update",
  payload: { uid: "BOOKMARK_UID", url: "https://example.com/page" }
});
if (!result.ok) console.error(result.error);
```

## Userscripts

In **Instance**, enable **Allow userscripts to access the API**, copy the token, save, and grant access to the source website. Refresh the page. Native mode also works.
This Tampermonkey script saves the GitHub repository owner's profile URL. Set the bookmark's URL rule to `github.com` and fill in `TOKEN` and `UID`:

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

  const TOKEN = "INSTANCE_TOKEN";
  const UID = "BOOKMARK_UID";

  function update() {
    const match = location.href.match(
      /^https:\/\/github\.com\/([^/?#]+)\/[^/?#]+(?:[/?#].*)?$/
    );
    if (!match) return;

    document.dispatchEvent(new CustomEvent(`browserail:${TOKEN}`, {
      detail: JSON.stringify({
        type: "bookmark.update",
        payload: { uid: UID, url: `https://github.com/${match[1]}` }
      })
    }));
  }

  window.addEventListener("urlchange", update);
  update();
})();
```

No acknowledgment or retry. Keep the token in the isolated script, outside the page DOM and localStorage.
