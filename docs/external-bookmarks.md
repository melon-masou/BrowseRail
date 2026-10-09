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

In **Instance** tab, enable **Allow interaction with userscripts**. Access to the source website should also be granted.
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

  const TOKEN = "INSTANCE_TOKEN";  // Replace with the token from: Instance tab -> Allow interaction with userscripts -> Allowlist
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

# External actions

In **Custom bookmarks → External actions**, add an action and bind it to a URL rule or **All URLs**. Add it to a menu or a shortcut like any custom bookmark. It acts only on the active tab, and only when that page matches the rule. Sending is checked; the reply or the page's handling is not.

Leave **Data** empty to send `null`.

## Dispatch an event

Needs **Allow interaction with userscripts** in the **Instance** tab and access to the website. The default event name is `browserail:run:${token}`, where `${token}` becomes the instance token. Any other name works too, but without the token the page itself can listen to the event. `event.detail` is the data string as written, or `null`.

```js
// ==UserScript==
// @name         BrowseRail - run commands
// @match        https://example.com/*
// @sandbox      DOM
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const TOKEN = "INSTANCE_TOKEN";  // Same token as above

  document.addEventListener(`browserail:run:${TOKEN}`, event => {
    if (event.detail === "translate") {
      // ...
    }
  });
})();
```

## Call an extension

Set the target extension's ID. **Data** must be JSON; the extension receives it parsed through `onMessageExternal`:

```js
chrome.runtime.onMessageExternal.addListener((message, sender) => {
  if (sender.id !== "BROWSERAIL_EXTENSION_ID") return;
  // message is the action's data, for example { "command": "translate" }
});
```
