import type { TranscriptSegment } from "@notetaker/core";

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  /** Wall-clock anchor for the session (epoch ms). */
  sessionStartedAt?: number;
  /** When false, show paused state instead of "waiting for speech". */
  listening?: boolean;
  /** Ms after which a new utterance starts a new line (default 4s). */
  mergeGapMs?: number;
  /** "stage" = demo-style monospace canvas; "review" = denser list. */
  variant?: "stage" | "review";
}

interface MergedLine {
  key: string;
  speakerId: string;
  speakerLabel?: string;
  startMs: number;
  endMs: number;
  text: string;
}

function formatRelativeMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatWallTime(sessionStartedAt: number | undefined, relativeMs: number): string {
  const relative = formatRelativeMs(relativeMs);
  if (!sessionStartedAt) return relative;
  const wall = new Date(sessionStartedAt + relativeMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${wall} (${relative})`;
}

/** Combine nearby same-speaker chunks into readable paragraphs. */
function mergeForDisplay(segments: TranscriptSegment[], mergeGapMs: number): MergedLine[] {
  const lines: MergedLine[] = [];

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;

    const last = lines[lines.length - 1];
    const sameSpeaker = last?.speakerId === seg.speakerId;
    const closeInTime = last && seg.startMs - last.endMs <= mergeGapMs;

    if (last && sameSpeaker && closeInTime) {
      last.text = `${last.text} ${text}`;
      last.endMs = Math.max(last.endMs, seg.endMs);
    } else {
      lines.push({
        key: seg.id,
        speakerId: seg.speakerId,
        speakerLabel: seg.speakerLabel,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text,
      });
    }
  }

  return lines;
}

function emptyTranscriptMessage(listening: boolean): string {
  if (!listening) {
    return "Listening is paused. Press Start in the sidebar to transcribe.";
  }
  return "Waiting for speech…";
}

export function TranscriptPanel({
  segments,
  sessionStartedAt,
  listening = false,
  mergeGapMs = 4_000,
  variant = "review",
}: TranscriptPanelProps) {
  const lines = mergeForDisplay(segments, mergeGapMs);
  const isStage = variant === "stage";

  if (lines.length === 0) {
    return (
      <p className={isStage ? "live-stage-empty" : ""} style={
        isStage ? undefined : { color: "var(--text-muted)", fontSize: 13, padding: "16px 0" }
      }>
        {emptyTranscriptMessage(listening)}
      </p>
    );
  }

  if (isStage) {
    return (
      <div className="transcript-stage">
        {lines.map((line) => (
          <div key={line.key} className="transcript-stage-line">
            <span className="transcript-stage-time">{formatRelativeMs(line.startMs)}</span>
            <span className="transcript-stage-speaker">{line.speakerLabel ?? line.speakerId}</span>
            <span className="transcript-stage-text">{line.text}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {lines.map((line) => (
        <div key={line.key} className="transcript-segment">
          <span className="transcript-time">{formatWallTime(sessionStartedAt, line.startMs)}</span>
          <span className="transcript-speaker">{line.speakerLabel ?? line.speakerId}</span>
          <span className="transcript-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
