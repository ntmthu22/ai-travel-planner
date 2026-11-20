const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/**
 * Only places and interests may reach a model (CLAUDE.md, R5). Interests are free text typed by
 * users, so an email address or a known name inside one is replaced before it is used.
 */
export function sanitizeInterest(text: string, redactTerms: string[]): string {
  let out = text.replace(EMAIL, "[redacted]");
  for (const term of redactTerms) {
    if (term.length < 2) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "[redacted]");
  }
  return out.trim().slice(0, 40);
}
