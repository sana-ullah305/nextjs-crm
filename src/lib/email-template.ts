/**
 * Client-safe mirror of the server's template renderer so the compose dialog
 * can preview merge results identically to what the server would send.
 * Tokens are {{name}} with word chars; unknown tokens are removed.
 */
export function renderTemplateClient(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, token: string) => {
    const v = vars[token];
    return v === undefined ? "" : v;
  });
}
