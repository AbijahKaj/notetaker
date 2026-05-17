import type { SessionMeta } from "@notetaker/core";

/** Recent list is newest-first; #1 is the most recent session. */
export function formatSessionListTitle(session: SessionMeta, indexInList: number): string {
  const n = indexInList + 1;
  const base = session.title?.trim() || "Untitled session";
  return `#${n} ${base}`;
}

export function formatSessionDateTime(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
