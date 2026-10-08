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
  --bar-button-padding: 0;

  /* Pass background clicks through in browser mode; buttons remain clickable. */
  --bar-background-pointer-events: none;

  /* Icons fill the button; control the distance between buttons with spacing. */
  --icon-size: 100%;

  /* SVG masks icons*/
  --icon-bookmark: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5%202h14a1%201%200%200%201%201%201v19l-8-5-8%205V3a1%201%200%200%201%201-1z%22%2F%3E%3C%2Fsvg%3E");
  --icon-folder: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M4%204h6l3%203h7a2%202%200%200%201%202%202v9a2%202%200%200%201-2%202H4a2%202%200%200%201-2-2V6a2%202%200%200%201%202-2z%22%2F%3E%3C%2Fsvg%3E");
  --icon-home: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M12%202%202%2011h3v11h5v-7h4v7h5V11h3z%22%2F%3E%3C%2Fsvg%3E");
  --icon-grid: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M2%202h8v8H2zM14%202h8v8h-8zM2%2014h8v8H2zM14%2014h8v8h-8z%22%2F%3E%3C%2Fsvg%3E");
  --icon-settings: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M9%202h6v3l1%20.5%202-2%202.5%202.5-2%202%20.5%201h3v6h-3l-.5%201%202%202-2.5%202.5-2-2-1%20.5v3H9v-3l-1-.5-2%202L3.5%2018l2-2-.5-1H2V9h3l.5-1-2-2L6%203.5l2%202L9%205zM15.5%2012a3.5%203.5%200%201%200-7%200%203.5%203.5%200%201%200%207%200z%22%2F%3E%3C%2Fsvg%3E");

  /* Default icon; item classes below override it. */
  --icon: var(--icon-bookmark);

  .menu-button.icon-bookmark { --icon: var(--icon-bookmark); }
  .menu-button.icon-folder { --icon: var(--icon-folder); }
  .menu-button.icon-home { --icon: var(--icon-home); }
  .menu-button.icon-grid { --icon: var(--icon-grid); }
  .menu-button.icon-settings { --icon: var(--icon-settings); }

  .menu-button-label { visibility: hidden; }

  /* Scale icons with the button, preserve their proportions, and use its color. */
  .menu-button[data-uid][data-kind]::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    bottom: auto;
    width: var(--icon-size);
    height: var(--icon-size);
    transform: translate(-50%, -50%);
    background: var(--button-accent);
    mask: var(--icon) center / contain no-repeat;
  }
}
```
