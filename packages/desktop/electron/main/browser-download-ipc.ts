import { ipcMain, type BrowserWindow } from "electron";
import { z } from "zod";
import { requiredNumber } from "./browser-arg-validation";
import type { BrowserManager } from "./browser-manager";
import { assertTrustedSender } from "./ipc";

const downloadIdSchema = z.string().uuid();

export function registerBrowserDownloadIpc(
  manager: BrowserManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("browser:list-downloads", (event, scopeId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return manager.downloads.list(requiredNumber(scopeId, "scope id"));
  });
  ipcMain.handle("browser:list-download-counts", (event) => {
    assertTrustedSender(event, getMainWindow);
    return manager.downloads.activeCountsByScope();
  });
  ipcMain.handle("browser:pause-download", (event, scopeId: unknown, id: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return manager.downloads.pause(requiredNumber(scopeId, "scope id"), downloadIdSchema.parse(id));
  });
  ipcMain.handle("browser:resume-download", (event, scopeId: unknown, id: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return manager.downloads.resume(
      requiredNumber(scopeId, "scope id"),
      downloadIdSchema.parse(id),
    );
  });
  ipcMain.handle("browser:cancel-download", (event, scopeId: unknown, id: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return manager.downloads.cancel(
      requiredNumber(scopeId, "scope id"),
      downloadIdSchema.parse(id),
    );
  });
  ipcMain.handle("browser:reveal-download", (event, scopeId: unknown, id: unknown) => {
    assertTrustedSender(event, getMainWindow);
    manager.downloads.reveal(requiredNumber(scopeId, "scope id"), downloadIdSchema.parse(id));
  });
  ipcMain.handle("browser:clear-downloads", (event, scopeId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return manager.downloads.clearFinished(requiredNumber(scopeId, "scope id"));
  });
}
