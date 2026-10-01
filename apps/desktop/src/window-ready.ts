import { getCurrentWindow } from "@tauri-apps/api/window";

export async function showWindowWhenReady(): Promise<void> {
  await document.fonts.ready;
  await getCurrentWindow().show();
}
