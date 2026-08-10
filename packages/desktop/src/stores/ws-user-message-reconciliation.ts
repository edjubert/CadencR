import type { AgentBlockData } from "@/components/AgentBlock";
import { applyBlockContentBudget } from "@/lib/block-content-budget";
import { normalizeMessageUuid } from "@/lib/message-uuid";
import { movePendingPromptBlocksToTail } from "./ws-pending-prompts";

export { normalizeMessageUuid } from "@/lib/message-uuid";

export interface CanonicalUserMessage {
  messageId: number;
  messageUuid: string;
  text: string;
  createdAt: string;
  origin?: AgentBlockData["origin"];
  promptDeliveryState?: AgentBlockData["promptDeliveryState"];
}

export function canonicalUserMessageBlock(message: CanonicalUserMessage): AgentBlockData {
  // This is the *only* producer of live `user_message` blocks — `processSdkMessage`
  // never emits one — so the budget has to be applied here too. Without it a
  // just-sent screenshot prompt stays inline in the store for the rest of the
  // session and is only off-loaded on the next hydration. See `block-content-budget`.
  return applyBlockContentBudget({
    id: `msg-${message.messageId}`,
    type: "user_message",
    content: message.text,
    isError: false,
    messageDbId: message.messageId,
    messageUuid: message.messageUuid,
    createdAt: message.createdAt,
    ...(message.origin ? { origin: message.origin } : {}),
    ...(message.promptDeliveryState ? { promptDeliveryState: message.promptDeliveryState } : {}),
  });
}

/** Numeric SQLite cursor carried explicitly or encoded in `msg-<id>`. */
export function blockMessageDbId(block: AgentBlockData): number | null {
  if (typeof block.messageDbId === "number") return block.messageDbId;
  return messageDbIdFromBlockId(block.id);
}

export function messageDbIdFromBlockId(id: string): number | null {
  if (!id.startsWith("msg-")) return null;
  const parsed = Number(id.slice(4));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Upsert one canonical user message without changing its chronological slot.
 * UUID is primary; DB id is the legacy-row fallback.
 */
export function upsertCanonicalUserMessage(
  blocks: AgentBlockData[],
  message: CanonicalUserMessage,
): AgentBlockData[] {
  const incoming = canonicalUserMessageBlock(message);
  const existingIndex = blocks.findIndex((block) => sameMessageIdentity(block, incoming));
  if (existingIndex === -1) {
    return movePendingPromptBlocksToTail(insertByDatabaseOrder(blocks, incoming));
  }

  const existing = blocks[existingIndex];
  const merged = mergeCanonicalUserBlock(existing, incoming);
  if (canonicalBlocksEqual(existing, merged)) return movePendingPromptBlocksToTail(blocks);
  const next = [...blocks];
  next[existingIndex] = merged;
  return movePendingPromptBlocksToTail(next);
}

/** Merge REST/reconnect/pagination blocks into live state without duplicate rows. */
export function mergeCanonicalBlocks(
  existing: AgentBlockData[],
  incoming: AgentBlockData[],
): AgentBlockData[] {
  if (incoming.length === 0) return existing;
  const indexes = buildIdentityIndexes(existing);
  let working = existing;
  let changed = false;
  for (const block of incoming) {
    const matchIndex = findIdentityIndex(indexes, working, block);
    if (matchIndex === -1) {
      if (!changed) working = [...existing];
      changed = true;
      const index = working.length;
      working.push(block);
      registerIdentity(indexes, block, index);
      continue;
    }
    if (block.type !== "user_message") continue;
    const nextBlock = mergeCanonicalUserBlock(working[matchIndex], block);
    if (canonicalBlocksEqual(working[matchIndex], nextBlock)) continue;
    if (!changed) working = [...existing];
    changed = true;
    working[matchIndex] = nextBlock;
    registerIdentity(indexes, nextBlock, matchIndex);
  }
  if (!changed) return movePendingPromptBlocksToTail(existing);
  const additions = working.slice(existing.length);
  const merged =
    additions.length === 0
      ? working
      : mergeAdditionsByDatabaseOrder(working.slice(0, existing.length), additions);
  return movePendingPromptBlocksToTail(merged);
}

export function sameMessageIdentity(left: AgentBlockData, right: AgentBlockData): boolean {
  if (left.messageUuid && right.messageUuid) {
    return normalizeMessageUuid(left.messageUuid) === normalizeMessageUuid(right.messageUuid);
  }
  const leftId = blockMessageDbId(left);
  const rightId = blockMessageDbId(right);
  if (leftId != null && rightId != null) return leftId === rightId;
  return left.id === right.id;
}

function insertByDatabaseOrder(
  blocks: AgentBlockData[],
  incoming: AgentBlockData,
): AgentBlockData[] {
  const messageId = blockMessageDbId(incoming);
  if (messageId == null) return [...blocks, incoming];
  const insertionIndex = blocks.findIndex((block) => {
    const heldId = blockMessageDbId(block);
    return heldId != null && heldId > messageId;
  });
  if (insertionIndex === -1) return [...blocks, incoming];
  return [...blocks.slice(0, insertionIndex), incoming, ...blocks.slice(insertionIndex)];
}

export function mergeCanonicalUserBlock(
  existing: AgentBlockData,
  incoming: AgentBlockData,
): AgentBlockData {
  const promptDeliveryState = laterDeliveryState(
    existing.promptDeliveryState,
    incoming.promptDeliveryState,
  );
  return {
    ...existing,
    ...incoming,
    origin: incoming.origin ?? existing.origin,
    ...(promptDeliveryState ? { promptDeliveryState } : {}),
  };
}

interface IdentityIndexes {
  byUuid: Map<string, number>;
  byDatabaseId: Map<number, number>;
  byBlockId: Map<string, number>;
}

function buildIdentityIndexes(blocks: AgentBlockData[]): IdentityIndexes {
  const indexes: IdentityIndexes = {
    byUuid: new Map(),
    byDatabaseId: new Map(),
    byBlockId: new Map(),
  };
  blocks.forEach((block, index) => registerIdentity(indexes, block, index));
  return indexes;
}

function registerIdentity(indexes: IdentityIndexes, block: AgentBlockData, index: number): void {
  if (block.messageUuid) indexes.byUuid.set(normalizeMessageUuid(block.messageUuid), index);
  const databaseId = blockMessageDbId(block);
  if (databaseId != null) indexes.byDatabaseId.set(databaseId, index);
  indexes.byBlockId.set(block.id, index);
}

function findIdentityIndex(
  indexes: IdentityIndexes,
  blocks: AgentBlockData[],
  incoming: AgentBlockData,
): number {
  const candidates = new Set<number>();
  if (incoming.messageUuid) {
    const byUuid = indexes.byUuid.get(normalizeMessageUuid(incoming.messageUuid));
    if (byUuid != null) candidates.add(byUuid);
  }
  const databaseId = blockMessageDbId(incoming);
  if (databaseId != null) {
    const byDatabaseId = indexes.byDatabaseId.get(databaseId);
    if (byDatabaseId != null) candidates.add(byDatabaseId);
  }
  const byBlockId = indexes.byBlockId.get(incoming.id);
  if (byBlockId != null) candidates.add(byBlockId);
  for (const index of candidates) {
    if (sameMessageIdentity(blocks[index], incoming)) return index;
  }
  return -1;
}

function mergeAdditionsByDatabaseOrder(
  existing: AgentBlockData[],
  additions: AgentBlockData[],
): AgentBlockData[] {
  const ordered = additions
    .map((block, index) => ({ block, index, databaseId: blockMessageDbId(block) }))
    .sort((left, right) => {
      if (left.databaseId == null) return right.databaseId == null ? left.index - right.index : 1;
      if (right.databaseId == null) return -1;
      return left.databaseId - right.databaseId || left.index - right.index;
    });
  const result: AgentBlockData[] = [];
  let additionIndex = 0;
  for (const block of existing) {
    const databaseId = blockMessageDbId(block);
    while (additionIndex < ordered.length) {
      const addition = ordered[additionIndex];
      if (addition.databaseId == null || databaseId == null || addition.databaseId >= databaseId) {
        break;
      }
      result.push(addition.block);
      additionIndex += 1;
    }
    result.push(block);
  }
  while (additionIndex < ordered.length) {
    result.push(ordered[additionIndex].block);
    additionIndex += 1;
  }
  return result;
}

function laterDeliveryState(
  existing: AgentBlockData["promptDeliveryState"],
  incoming: AgentBlockData["promptDeliveryState"],
): AgentBlockData["promptDeliveryState"] {
  if (existing === "received_agent" || incoming === "received_agent") return "received_agent";
  if (existing === "delivery_failed" || incoming === "delivery_failed") return "delivery_failed";
  if (existing === "delivery_unknown" || incoming === "delivery_unknown") {
    return "delivery_unknown";
  }
  return incoming ?? existing;
}

function canonicalBlocksEqual(left: AgentBlockData, right: AgentBlockData): boolean {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.messageDbId === right.messageDbId &&
    left.messageUuid === right.messageUuid &&
    left.createdAt === right.createdAt &&
    originsEqual(left.origin, right.origin) &&
    left.promptDeliveryState === right.promptDeliveryState
  );
}

function originsEqual(left: AgentBlockData["origin"], right: AgentBlockData["origin"]): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.originKind === right.originKind &&
    left.sourceSessionId === right.sourceSessionId &&
    left.sourceFeatureId === right.sourceFeatureId &&
    left.sourceProjectId === right.sourceProjectId &&
    left.sourceMessageId === right.sourceMessageId &&
    left.note === right.note &&
    left.createdAt === right.createdAt
  );
}
