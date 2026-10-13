// Read-only scheduling diagnostic, NOT signature verification or publication authority.
import { readBoundedRegularFile } from "./publication/io.mjs";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 32 * 1024 * 1024;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function parseTime(value) {
  if (typeof value !== "string" || !timestamp.test(value))
    throw new Error("non-canonical UTC timestamp");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value) {
    throw new Error("invalid UTC timestamp");
  }
  return time;
}

export async function checkExpiry(file, { now = Date.now(), warningHours = 72 } = {}) {
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(warningHours) ||
    warningHours < 1 ||
    warningHours > 336
  ) {
    throw new Error("invalid monitoring clock or warning window");
  }
  const bytes = await readBoundedRegularFile(file, MAX_BYTES, "metadata");
  const envelope = JSON.parse(bytes.toString("utf8"));
  if (
    !envelope ||
    typeof envelope !== "object" ||
    !envelope.signed ||
    typeof envelope.signed !== "object" ||
    Array.isArray(envelope.signed) ||
    !envelope.signature ||
    typeof envelope.signature !== "object" ||
    Array.isArray(envelope.signature)
  ) {
    throw new Error("metadata must contain signed payload and signature objects");
  }
  const payload = envelope.signed;
  const generated = parseTime(payload.generated_at);
  const expires = parseTime(payload.expires_at);
  if (expires <= generated || generated > now)
    throw new Error("invalid metadata validity interval");
  const remainingHours = (expires - now) / 3600000;
  return {
    file,
    expires_at: payload.expires_at,
    remaining_hours: remainingHours,
    status:
      remainingHours <= 0 ? "expired" : remainingHours <= warningHours ? "renewal-due" : "healthy",
    authenticated: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const files = process.argv.slice(2);
    if (files.length < 1 || files.length > 3)
      throw new Error("provide 1–3 local metadata snapshots");
    const results = [];
    for (const file of files) results.push(await checkExpiry(file));
    console.log(JSON.stringify({ diagnostic_only: true, results }, null, 2));
    if (results.some((result) => result.status !== "healthy")) process.exitCode = 1;
  } catch (error) {
    console.error(`Metadata expiry monitor failed: ${error.message}`);
    process.exitCode = 1;
  }
}
