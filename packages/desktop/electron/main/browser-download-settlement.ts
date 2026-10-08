import type { BrowserDownloadRecord } from "./browser-download-record";

const CANCEL_SETTLE_TIMEOUT_MS = 2_000;

/** Cancel native items, force-finalize silent ones, then prove every lease settled. */
export async function settleBrowserDownloadRecords(
  records: BrowserDownloadRecord[],
  finalize: (record: BrowserDownloadRecord, error?: unknown) => void,
): Promise<void> {
  for (const record of records) {
    try {
      record.cancelNative();
    } catch (error) {
      finalize(record, error);
    }
  }
  const settlement = Promise.all(records.map((record) => record.terminal)).then(() => undefined);
  await Promise.race([settlement, delay(CANCEL_SETTLE_TIMEOUT_MS)]);
  for (const record of records) {
    if (!record.finalizing) finalize(record);
  }
  await Promise.race([settlement, delay(CANCEL_SETTLE_TIMEOUT_MS)]);
  const remaining = records.filter((record) => !record.settled);
  if (remaining.length > 0) {
    throw new Error(`Timed out settling ${remaining.length} Browser download(s).`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
