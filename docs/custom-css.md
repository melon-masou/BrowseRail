# Custom CSS

Open **Menus → Custom CSS**, add an entry, and paste the CSS. Set **CSS class** in menu or item settings to apply a style.

### Custom SVG icons

The icon picker covers Phosphor and Lucide. Custom CSS can add icons they don't have, such as a site logo. Icons show in every **Bar style** except **Text**, and in custom styles that set `--bar-icon-display`. A custom icon replaces the one chosen in the picker.

Set an item's **CSS class** to `icon-browserail`, or the menu's **CSS class** to `smile-bar`.

```css
& {
  --icon-browserail: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%2296%2096%20320%20320%22%20fill%3D%22black%22%3E%3Cpath%20d%3D%22M154%20112h64v288l-32-24-32%2024zM294%20112h64v288l-32-24-32%2024z%22%2F%3E%3C%2Fsvg%3E");
  --icon-smile: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22black%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M12%202a10%2010%200%201%200%200%2020a10%2010%200%201%200%200-20zM8.5%207.5a1.5%201.5%200%201%200%200%203a1.5%201.5%200%201%200%200-3zM15.5%207.5a1.5%201.5%200%201%200%200%203a1.5%201.5%200%201%200%200-3zM7%2013.5h10a5%205%200%200%201-10%200z%22%2F%3E%3C%2Fsvg%3E");
}


/* Item class: replaces one button's icon. 
  --icon-text: "" drops the text or name prefix.
*/
.menu-button.icon-browserail { --icon: var(--icon-browserail); --icon-text: ""; }
.menu-button.icon-smile { --icon: var(--icon-smile); --icon-text: ""; }
/* Menu class: replaces every button's icon in the bar; an item class still wins. */
&.smile-bar { --icon: var(--icon-smile); --icon-text: ""; }
```

## Example: round buttons

Custom CSS can add bar styles beyond the built-in presets. Refer to `.bar-text`, `.bar-text-icon`, `.bar-text-color-icon`, `.bar-icons` and `.bar-tiles` in [bar.css](../packages/menu-ui/src/css/bar.css) for implementations of the presets.

This is an example of custom bar style. Paste this CSS and set the menu's **CSS class** to `round-tiles`.

```css
&.round-tiles {
  /* No frame; clicks between buttons reach the page. */
  --bar-background: transparent;
  --bar-backdrop-filter: none;
  --bar-border: 0;
  --bar-shadow: none;
  --bar-background-pointer-events: none;

  /* Scale circles and their icons with the configured button dimensions. */
  --round-button-size: calc(min(var(--config-bar-item-width), var(--config-bar-item-height)) * 0.85);
  --bar-icon-display: inline-grid;
  --icon-size: calc(var(--round-button-size) * 0.6);
  --icon-font-size: calc(var(--round-button-size) * 0.58);
  --bar-button-hover-filter: brightness(1.25);

  .menu-button {
    width: var(--round-button-size);
    height: var(--round-button-size);
    place-self: center;
    justify-content: center;
    padding: 0;
    border-radius: 50%;
    background: var(--button-norm-fill, var(--default-button-fill));
    --icon-color: currentColor;

    /* Replace text and the colored edge with the icon slot. */
    .menu-button-label { display: none; }
    &::before { content: none; }
  }

  /* Pinned folders retain their marker. */
  .menu-button[data-folder]:not([data-pin])::after { display: none; }
}
```
