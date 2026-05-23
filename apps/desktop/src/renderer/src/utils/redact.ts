/**
 * Strip user-specific paths and identifiers from log output before it lands in
 * a GitHub issue. The goal is to keep the technical content useful (file
 * names, function names, module names) without leaking the user's home dir,
 * machine UUID, or anything else that identifies them.
 *
 * If you add a new redactor, also document it in the issue body so the
 * reviewer knows what they're looking at.
 */
export function redactForReport(input: string): string {
  let s = input;

  // /Users/<name>/foo  →  ~/foo
  s = s.replace(/\/Users\/[^/\s'"]+/g, "~");
  // /home/<name>/foo   →  ~/foo
  s = s.replace(/\/home\/[^/\s'"]+/g, "~");
  // C:\Users\<name>\…  →  ~\…
  s = s.replace(/[A-Za-z]:\\Users\\[^\\\s'"]+/g, "~");

  // Mach-O / GUID style: 8-4-4-4-12 hex
  s = s.replace(/\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g, "<uuid>");

  // Bare long hashes (sha-ish), e.g. session IDs or content hashes.
  s = s.replace(/\b[0-9a-f]{32,}\b/g, "<hash>");

  // Email-looking strings.
  s = s.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>");

  // IPv4
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>");

  return s;
}
