import type { SessionMeta } from "@notetaker/core";

/** Use the summarizer-supplied title if present, else a short date label. */
export function formatSessionListTitle(session: SessionMeta): string {
  const title = session.title?.trim();
  if (title) return title;
  return new Date(session.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
