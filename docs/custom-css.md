# Custom CSS

Add CSS in **Menus → Global CSS**, then set **CSS class** in menu or item settings.

[Bar stylesheet](../packages/menu-ui/src/css/bar.css): selectors and variables.

## Example of an icon-only bar

This example replaces button labels with colored icons and removes the bar background.

- In the extension settings, open **Menus**, click **Global CSS**, add an entry, and paste the CSS below.
- Open the target menu's settings and set **CSS class** to `icon-bar`.
- Buttons use the bookmark icon by default. To change one, set its **CSS class** to `icon-folder`, `icon-home`, `icon-grid`, or `icon-settings`.

```css
&.icon-bar {
  /* Hide the bar frame and button fills. */
  --bar-background: transparent;
  --bar-border: 0;
  --bar-backdrop-filter: none;
  --bar-shadow: none;
  --bar-button-background: transparent;

  /* SVG masks icons*/
  --icon-bookmark: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M6%203h12v18l-6-4-6%204z%22%2F%3E%3C%2Fsvg%3E");
  --icon-folder: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M2%206a2%202%200%200%201%202-2h5l3%203h8a2%202%200%200%201%202%202v11a2%202%200%200%201-2%202H4a2%202%200%200%201-2-2z%22%2F%3E%3C%2Fsvg%3E");
  --icon-home: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M12%202%201%2011h3v11h6v-8h4v8h6V11h3z%22%2F%3E%3C%2Fsvg%3E");
  --icon-grid: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M3%203h7v7H3zM14%203h7v7h-7zM3%2014h7v7H3zM14%2014h7v7h-7z%22%2F%3E%3C%2Fsvg%3E");
  --icon-settings: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M9%203h6l1%203%203%201%202%205-2%205-3%201-1%203H9l-1-3-3-1-2-5%202-5%203-1zM15%2012a3%203%200%201%200-6%200a3%203%200%201%200%206%200z%22%2F%3E%3C%2Fsvg%3E");

  /* Default icon; item classes below override it. */
  --icon: var(--icon-bookmark);

  .menu-button.icon-bookmark { --icon: var(--icon-bookmark); }
  .menu-button.icon-folder { --icon: var(--icon-folder); }
  .menu-button.icon-home { --icon: var(--icon-home); }
  .menu-button.icon-grid { --icon: var(--icon-grid); }
  .menu-button.icon-settings { --icon: var(--icon-settings); }

  .menu-button-label { visibility: hidden; }

  /* Center each icon, scale it with the button, and use the button color. */
  .menu-button[data-uid][data-kind]::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    bottom: auto;
    width: 60%;
    height: 60%;
    transform: translate(-50%, -50%);
    background: var(--button-accent);
    mask: var(--icon) center / contain no-repeat;
  }
}
```
