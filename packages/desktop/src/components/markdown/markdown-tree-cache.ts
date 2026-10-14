import type { ReactElement } from "react";

const MARKDOWN_CACHE_MAX = 200;
const MARKDOWN_CACHE_MAX_WEIGHT = 4 * 1024 * 1024;
const callbackIds = new WeakMap<(command: string) => void, number>();
let nextCallbackId = 1;

interface MarkdownCacheIdentity {
  cacheKey: string;
  content: string;
  sendToTerminal?: (command: string) => void;
}

function callbackIdentity(callback: ((command: string) => void) | undefined): string {
  if (callback === undefined) return "none";
  let id = callbackIds.get(callback);
  if (id === undefined) {
    id = nextCallbackId++;
    callbackIds.set(callback, id);
  }
  return String(id);
}

function identityKey(identity: MarkdownCacheIdentity): string {
  return [identity.cacheKey, callbackIdentity(identity.sendToTerminal)].join("\0");
}

interface MarkdownCacheEntry {
  content: string;
  tree: ReactElement;
  weight: number;
}

class MarkdownTreeCache {
  private readonly entries = new Map<string, MarkdownCacheEntry>();
  private totalWeight = 0;

  getOrCreate(identity: MarkdownCacheIdentity, build: () => ReactElement): ReactElement {
    const key = identityKey(identity);
    const cached = this.entries.get(key);
    if (cached?.content === identity.content) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.tree;
    }
    if (cached) this.delete(key, cached);
    const fresh = build();
    const weight = identity.content.length * 2;
    if (weight > MARKDOWN_CACHE_MAX_WEIGHT) return fresh;
    while (
      this.entries.size >= MARKDOWN_CACHE_MAX ||
      this.totalWeight + weight > MARKDOWN_CACHE_MAX_WEIGHT
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) this.delete(oldestKey, oldest);
    }
    this.entries.set(key, { content: identity.content, tree: fresh, weight });
    this.totalWeight += weight;
    return fresh;
  }

  private delete(key: string, entry: MarkdownCacheEntry): void {
    this.entries.delete(key);
    this.totalWeight -= entry.weight;
  }

  clear(): void {
    this.entries.clear();
    this.totalWeight = 0;
  }

  size(): number {
    return this.entries.size;
  }

  weight(): number {
    return this.totalWeight;
  }

  has(identity: MarkdownCacheIdentity): boolean {
    return this.entries.get(identityKey(identity))?.content === identity.content;
  }
}

export const markdownTreeCache = new MarkdownTreeCache();

/** Test helpers — not exported from the package barrel. */
export const __markdownCacheTestHelpers = {
  size: (): number => markdownTreeCache.size(),
  weight: (): number => markdownTreeCache.weight(),
  maxWeight: MARKDOWN_CACHE_MAX_WEIGHT,
  clear: (): void => markdownTreeCache.clear(),
  has: (identity: MarkdownCacheIdentity): boolean => markdownTreeCache.has(identity),
};
