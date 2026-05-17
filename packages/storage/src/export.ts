import type { Session } from "@notetaker/core";

export class ExportService {
  toMarkdown(session: Session): string {
    const lines: string[] = [];
    const title = session.title ?? `Session ${new Date(session.startedAt).toLocaleString()}`;
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`**Started:** ${new Date(session.startedAt).toISOString()}`);
    if (session.endedAt) {
      lines.push(`**Ended:** ${new Date(session.endedAt).toISOString()}`);
    }
    if (session.appContext) {
      lines.push(`**Context:** ${session.appContext}`);
    }
    lines.push("");

    if (session.userNotes.trim()) {
      lines.push("## Your Notes");
      lines.push("");
      lines.push(session.userNotes);
      lines.push("");
    }

    if (session.summary) {
      lines.push("## Summary");
      lines.push("");
      lines.push(session.summary.summary);
      lines.push("");

      if (session.summary.keyPoints.length) {
        lines.push("### Key Points");
        for (const p of session.summary.keyPoints) lines.push(`- ${p}`);
        lines.push("");
      }

      if (session.summary.decisions.length) {
        lines.push("### Decisions");
        for (const d of session.summary.decisions) lines.push(`- ${d}`);
        lines.push("");
      }

      if (session.summary.actionItems.length) {
        lines.push("### Action Items");
        for (const a of session.summary.actionItems) {
          const owner = a.owner ? ` (${a.owner})` : "";
          const due = a.due ? ` — due ${a.due}` : "";
          lines.push(`- [ ] ${a.task}${owner}${due}`);
        }
        lines.push("");
      }

      if (session.summary.followUpEmailDraft) {
        lines.push("### Follow-up Email Draft");
        lines.push("");
        lines.push(session.summary.followUpEmailDraft);
        lines.push("");
      }
    }

    if (session.segments.length) {
      lines.push("## Transcript");
      lines.push("");
      for (const seg of session.segments) {
        const speaker = seg.speakerLabel ?? seg.speakerId;
        const ts = formatMs(seg.startMs);
        lines.push(`**[${ts}] ${speaker}:** ${seg.text}`);
      }
    }

    return lines.join("\n");
  }

  toJson(session: Session): string {
    return JSON.stringify(session, null, 2);
  }

  toSrt(session: Session): string {
    const lines: string[] = [];
    session.segments.forEach((seg, i) => {
      const speaker = seg.speakerLabel ?? seg.speakerId;
      lines.push(String(i + 1));
      lines.push(`${formatSrt(seg.startMs)} --> ${formatSrt(seg.endMs)}`);
      lines.push(`[${speaker}] ${seg.text}`);
      lines.push("");
    });
    return lines.join("\n");
  }
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}`;
}

function formatSrt(ms: number): string {
  const total = Math.floor(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const msRem = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(msRem).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
