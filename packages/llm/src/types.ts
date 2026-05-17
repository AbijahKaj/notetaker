import type { MeetingSummary, SessionMeta, TranscriptSegment } from "@notetaker/core";

export interface SummarizeInput {
  transcript: TranscriptSegment[];
  userNotes: string;
  meta: SessionMeta;
}

export interface Summarizer {
  summarize(input: SummarizeInput): Promise<MeetingSummary>;
  test(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}

export const SUMMARIZE_SYSTEM_PROMPT = `You are a meeting notes assistant. Given a transcript and optional user scratch notes, produce a structured meeting summary.

Return JSON with these fields:
- title: concise meeting title
- summary: markdown summary paragraph(s)
- keyPoints: array of key discussion points
- decisions: array of decisions made
- actionItems: array of {owner?, task, due?}
- openQuestions: array of unresolved questions
- followUpEmailDraft: a professional follow-up email draft`;

export function buildUserPrompt(input: SummarizeInput): string {
  const lines: string[] = [];
  lines.push(`Meeting started: ${new Date(input.meta.startedAt).toISOString()}`);
  if (input.meta.appContext) lines.push(`Context: ${input.meta.appContext}`);
  lines.push("");

  if (input.userNotes.trim()) {
    lines.push("## User scratch notes");
    lines.push(input.userNotes);
    lines.push("");
  }

  lines.push("## Transcript");
  for (const seg of input.transcript) {
    const speaker = seg.speakerLabel ?? seg.speakerId;
    lines.push(`[${formatMs(seg.startMs)}] ${speaker}: ${seg.text}`);
  }

  return lines.join("\n");
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function parseSummaryJson(raw: string): MeetingSummary {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as MeetingSummary;
  return {
    title: parsed.title ?? "Meeting Notes",
    summary: parsed.summary ?? "",
    keyPoints: parsed.keyPoints ?? [],
    decisions: parsed.decisions ?? [],
    actionItems: parsed.actionItems ?? [],
    openQuestions: parsed.openQuestions ?? [],
    followUpEmailDraft: parsed.followUpEmailDraft ?? "",
  };
}
