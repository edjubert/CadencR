import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { createLowlight, common } from "lowlight";
import ini from "highlight.js/lib/languages/ini";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";

const HIGHLIGHT_CACHE_MAX_WEIGHT = 4 * 1024 * 1024;

interface HighlightEntry {
  node: ReactNode;
  weight: number;
}

/**
 * Weight-bounded LRU for settled syntax trees. Weight estimates the retained
 * UTF-8 strings plus per-node object overhead; a single oversized tree is
 * returned to the caller but never allowed to displace the whole cache.
 */
class HighlightCache {
  private readonly entries = new Map<string, HighlightEntry>();
  private totalWeight = 0;

  constructor(private readonly maxWeight: number) {}

  get(key: string): ReactNode | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.node;
  }

  set(key: string, node: ReactNode, weight: number): void {
    const replaced = this.entries.get(key);
    if (replaced !== undefined) {
      this.entries.delete(key);
      this.totalWeight -= replaced.weight;
    }
    if (weight > this.maxWeight) return;
    while (this.totalWeight + weight > this.maxWeight) this.evictOldest();
    this.entries.set(key, { node, weight });
    this.totalWeight += weight;
  }

  clear(): void {
    this.entries.clear();
    this.totalWeight = 0;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  snapshot(): { size: number; weight: number } {
    return { size: this.entries.size, weight: this.totalWeight };
  }

  private evictOldest(): void {
    const oldestKey = this.entries.keys().next().value;
    if (oldestKey === undefined) return;
    const oldest = this.entries.get(oldestKey);
    this.entries.delete(oldestKey);
    if (oldest !== undefined) this.totalWeight -= oldest.weight;
  }
}

/** UTF-8 byte length without allocating a `Uint8Array` for every token. */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

interface TreeNodeLike {
  type?: unknown;
  tagName?: unknown;
  value?: unknown;
  properties?: unknown;
  children?: unknown;
}

const RETAINED_REACT_NODE_BYTES = 192;

/**
 * `toJsxRuntime` maps each HAST element to a retained React element plus props.
 * Counting source HAST nodes and charging 192 bytes per node conservatively
 * models those two objects without walking React internals such as `_owner`.
 */
function estimateTreeWeight(root: unknown): number {
  const pending: unknown[] = [root];
  let weight = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    const node = value as TreeNodeLike;
    weight += RETAINED_REACT_NODE_BYTES;
    if (typeof node.type === "string") weight += utf8Bytes(node.type);
    if (typeof node.tagName === "string") weight += utf8Bytes(node.tagName);
    if (typeof node.value === "string") weight += utf8Bytes(node.value);
    if (node.properties !== null && typeof node.properties === "object") {
      for (const property of Object.values(node.properties)) {
        if (typeof property === "string") weight += utf8Bytes(property);
        else if (Array.isArray(property)) {
          for (const item of property) if (typeof item === "string") weight += utf8Bytes(item);
        }
      }
    }
    if (Array.isArray(node.children)) pending.push(...node.children);
  }
  return weight;
}

const lowlight = createLowlight(common);
lowlight.register("toml", ini);
const settledCache = new HighlightCache(HIGHLIGHT_CACHE_MAX_WEIGHT);

export interface HighlightOptions {
  /** Only settled code may enter the module-level cache. */
  cache?: boolean;
}

export function highlightCode(
  lang: string,
  code: string,
  { cache = true }: HighlightOptions = {},
): ReactNode {
  const key = `${lang}\0${code}`;
  if (cache) {
    const cached = settledCache.get(key);
    if (cached !== undefined) return cached;
  }
  try {
    const tree = lowlight.highlight(lang, code);
    const result = toJsxRuntime(tree, { Fragment, jsx, jsxs });
    if (cache) settledCache.set(key, result, utf8Bytes(key) + estimateTreeWeight(tree));
    return result;
  } catch {
    return null;
  }
}

/** Test helpers — not exported from the package barrel. */
export const __highlightCacheTestHelpers = {
  budget: HIGHLIGHT_CACHE_MAX_WEIGHT,
  clear: (): void => settledCache.clear(),
  snapshot: (): { size: number; weight: number } => settledCache.snapshot(),
  estimateWeight: (lang: string, code: string, tree: unknown): number =>
    utf8Bytes(`${lang}\0${code}`) + estimateTreeWeight(tree),
  create: (maxWeight: number): HighlightCache => new HighlightCache(maxWeight),
};
