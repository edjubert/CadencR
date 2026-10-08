import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

interface OriginEntry {
  origin: string;
  visits: number;
  lastVisitedAt: number;
}

interface PersistedOrigins {
  origins: OriginEntry[];
}

const MAX_ORIGINS = 200;

/**
 * Persists the set of origins (`scheme://host[:port]`) the user has navigated
 * to so the address bar can offer them as autocomplete suggestions across
 * sessions. Ranks by a recency-weighted frequency score so the most pertinent
 * sites surface first.
 */
export class BrowserOriginStore {
  private entries: OriginEntry[] | null = null;

  constructor(
    private readonly filePath = defaultOriginStorePath(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Record a navigation. `about:`/`data:` and unparseable URLs are ignored. */
  record(rawUrl: string): void {
    const origin = originOf(rawUrl);
    if (!origin) return;
    const entries = this.load();
    const existing = entries.find((entry) => entry.origin === origin);
    if (existing) {
      existing.visits += 1;
      existing.lastVisitedAt = this.now();
    } else {
      entries.push({ origin, visits: 1, lastVisitedAt: this.now() });
    }
    entries.sort((a, b) => score(b, this.now()) - score(a, this.now()));
    this.entries = entries.slice(0, MAX_ORIGINS);
    this.write({ origins: this.entries });
  }

  /** Origins ranked most-pertinent first. */
  list(): string[] {
    return this.load().map((entry) => entry.origin);
  }

  /** Clear the legacy origin suggestions alongside full-page history. */
  clear(): void {
    this.write({ origins: [] }, true);
    this.entries = [];
  }

  private load(): OriginEntry[] {
    if (this.entries) return this.entries;
    this.entries = this.read();
    return this.entries;
  }

  private read(): OriginEntry[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const origins = (parsed as PersistedOrigins)?.origins;
      if (!Array.isArray(origins)) return [];
      return origins.filter(isOriginEntry);
    } catch {
      return [];
    }
  }

  private write(data: PersistedOrigins, surfaceError = false): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      if (surfaceError) throw error;
      // History is a convenience, not correctness — a write failure must not
      // break navigation. Surface it to the main-process log only.
      console.warn("Browser origin history write failed:", error);
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Frequency, decayed by how many days ago the origin was last visited. */
function score(entry: OriginEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastVisitedAt) / DAY_MS);
  return entry.visits / (1 + ageDays);
}

function originOf(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isOriginEntry(value: unknown): value is OriginEntry {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as OriginEntry).origin === "string" &&
    typeof (value as OriginEntry).visits === "number" &&
    typeof (value as OriginEntry).lastVisitedAt === "number",
  );
}

function defaultOriginStorePath(): string {
  return path.join(app.getPath("userData"), "browser-origins.json");
}
