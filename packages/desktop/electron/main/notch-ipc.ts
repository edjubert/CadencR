import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  notchConfigSchema,
  notchFeatureRefSchema,
  notchHotRectSchema,
  notchNotificationSchema,
  notchSnapshotSchema,
} from "../../src/shared/notch";
import { assertTrustedSender } from "./ipc";
import { NotchController } from "./notch-window";

/**
 * Two audiences, two trust checks: the app renderer (`notch:*` host channels)
 * feeds state in, and only the island's own renderer may report its hot rect
 * or ask to open a conversation.
 */
export function registerNotchIpc(getMainWindow: () => BrowserWindow | null): NotchController {
  const controller = new NotchController({ getMainWindow });

  const fromIsland = (event: IpcMainInvokeEvent): void =>
    assertTrustedSender(event, () => controller.window);

  ipcMain.handle("notch:capabilities", (event) => {
    assertTrustedSender(event, getMainWindow);
    return controller.capabilities();
  });
  ipcMain.handle("notch:configure", (event, config: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return controller.configure(notchConfigSchema.parse(config));
  });
  ipcMain.handle("notch:snapshot", (event, snapshot: unknown) => {
    assertTrustedSender(event, getMainWindow);
    controller.pushSnapshot(notchSnapshotSchema.parse(snapshot));
  });
  ipcMain.handle("notch:notify", (event, notification: unknown) => {
    assertTrustedSender(event, getMainWindow);
    controller.pushNotification(notchNotificationSchema.parse(notification));
  });

  ipcMain.handle("notch:ready", (event) => {
    fromIsland(event);
    return controller.markReady();
  });
  ipcMain.handle("notch:hot-rect", (event, rect: unknown) => {
    fromIsland(event);
    controller.setHotRect(notchHotRectSchema.parse(rect));
  });
  ipcMain.handle("notch:open-feature", (event, ref: unknown) => {
    fromIsland(event);
    controller.openFeature(notchFeatureRefSchema.parse(ref));
  });
  ipcMain.handle("notch:dismiss", (event, ref: unknown) => {
    fromIsland(event);
    controller.dismissFeature(notchFeatureRefSchema.parse(ref));
  });

  return controller;
}
