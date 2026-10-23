import { browserActions } from "../browser";
import { element } from "../dom";
import { createScope } from "../lifecycle";

export function mountRuntimeControls(initialEnabled: boolean) {
  const scope = createScope();
  const enabledToggle = element<HTMLInputElement>("widget-enabled-toggle");
  const editingToggle = element<HTMLInputElement>("edit-menus-toggle");
  const shortcutsToggle = element<HTMLInputElement>("shortcuts-enabled-toggle");
  let enabled = initialEnabled;
  let shortcutsEnabled = true;
  let editingAvailable = false;
  let editing = false;
  let loading = true;
  let changingEnabled = false;
  let changingEditing = false;
  let changingShortcuts = false;

  function render(): void {
    if (scope.signal.aborted) return;
    enabledToggle.checked = enabled;
    enabledToggle.disabled = loading || changingEnabled;
    editingToggle.checked = enabled && editing;
    editingToggle.disabled = !enabled || !editingAvailable || changingEnabled || changingEditing;
    shortcutsToggle.checked = shortcutsEnabled;
    shortcutsToggle.disabled = loading || changingShortcuts;
  }

  function renderEditingState(state: { enabled: boolean; editing: boolean }): void {
    editingAvailable = state.enabled;
    editing = state.editing;
    render();
  }

  async function refreshEditing(): Promise<void> {
    try {
      renderEditingState(await browserActions.menuEditingState());
    } catch {
      renderEditingState({ enabled: false, editing: false });
    }
  }

  async function refreshRuntime(): Promise<void> {
    try {
      const state = await browserActions.runtimeState();
      enabled = state.enabled;
      shortcutsEnabled = state.shortcutsEnabled;
      loading = false;
      render();
    } catch (error) {
      console.error("BrowseRail runtime state:", error);
    }
  }

  scope.add(browserActions.onRuntimeState(state => {
    enabled = state.enabled;
    shortcutsEnabled = state.shortcutsEnabled;
    render();
  }));
  scope.add(browserActions.onMenuEditingState(renderEditingState));

  enabledToggle.addEventListener("change", async () => {
    const next = enabledToggle.checked;
    changingEnabled = true;
    render();
    try {
      await browserActions.setWidgetEnabled(next);
    } catch (error) {
      console.error("BrowseRail enabled:", error);
    } finally {
      await Promise.all([refreshRuntime(), refreshEditing()]);
      changingEnabled = false;
      render();
    }
  }, { signal: scope.signal });

  editingToggle.addEventListener("change", async () => {
    const next = editingToggle.checked;
    changingEditing = true;
    render();
    try {
      renderEditingState(await browserActions.setMenuEditing(next));
    } catch (error) {
      console.error("BrowseRail editing:", error);
      await refreshEditing();
    } finally {
      changingEditing = false;
      render();
    }
  }, { signal: scope.signal });

  shortcutsToggle.addEventListener("change", async () => {
    const next = shortcutsToggle.checked;
    changingShortcuts = true;
    render();
    try {
      await browserActions.setShortcutsEnabled(next);
    } catch (error) {
      console.error("BrowseRail shortcuts:", error);
    } finally {
      await refreshRuntime();
      changingShortcuts = false;
      render();
    }
  }, { signal: scope.signal });

  render();
  void refreshRuntime();
  void refreshEditing();
  return { render, destroy: scope.destroy };
}
