/** Whether an address denotes a web page eligible for Browser history. */
export function isHttpBrowserUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
