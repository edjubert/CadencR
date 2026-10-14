import type { DownloadItem, Session, WebContents } from "electron";
import type { BrowserProfile } from "./browser-profiles";
import type { ManagedTab } from "./browser-tab-events";

export interface BrowserDownloadSource {
  tabId: string;
  scopeId: number;
  profile: BrowserProfile;
  webContents: WebContents;
}

type DownloadCallback = (
  event: Electron.Event,
  item: DownloadItem,
  initiatingContents: WebContents,
) => void;

/** Installs one fail-closed listener per Browser-owned session and tracks live scoped sources. */
export class BrowserDownloadSources {
  private readonly sources = new Map<number, BrowserDownloadSource>();
  private readonly watchedSessions = new WeakSet<Session>();

  constructor(private readonly onDownload: DownloadCallback) {}

  watch(tab: ManagedTab): void {
    const scopeId = tab.metadata.scopeId;
    const webContentsId = tab.webContents.id;
    if (scopeId !== null) {
      this.sources.set(webContentsId, {
        tabId: tab.metadata.id,
        scopeId,
        profile: tab.profile,
        webContents: tab.webContents,
      });
    }
    tab.webContents.once("destroyed", () => {
      if (this.sources.get(webContentsId)?.webContents === tab.webContents) {
        this.sources.delete(webContentsId);
      }
    });
    this.watchSession(tab.webContents.session);
  }

  get(initiatingContents: WebContents): BrowserDownloadSource | undefined {
    const source = this.sources.get(initiatingContents.id);
    return source?.webContents === initiatingContents ? source : undefined;
  }

  private watchSession(target: Session): void {
    if (this.watchedSessions.has(target)) return;
    this.watchedSessions.add(target);
    target.on("will-download", this.onDownload);
  }
}
