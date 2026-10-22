export function isAllowedRendererUrl(candidateValue: string, expectedValue: string): boolean {
  try {
    const candidate = new URL(candidateValue);
    const expected = new URL(expectedValue);
    const allowedSearch = candidate.search === "" || candidate.search === "?captions=1" || candidate.search === "?visual-support=1";
    return candidate.protocol === expected.protocol
      && candidate.origin === expected.origin
      && candidate.pathname === expected.pathname
      && candidate.username === ""
      && candidate.password === ""
      && candidate.hash === ""
      && allowedSearch;
  } catch {
    return false;
  }
}

export function isAllowedAudioPermission(
  permission: string,
  requestingOrigin: string,
  expectedRendererUrl: string,
  mediaTypes: readonly string[],
): boolean {
  const expected = new URL(expectedRendererUrl);
  const allowedOrigin = expected.protocol === "file:"
    ? requestingOrigin === "file://"
    : (() => {
        try { return new URL(requestingOrigin).origin === expected.origin; }
        catch { return false; }
      })();
  return permission === "media" && allowedOrigin && mediaTypes.length === 1 && mediaTypes[0] === "audio";
}
