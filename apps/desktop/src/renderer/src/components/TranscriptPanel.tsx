import type { TranscriptSegment } from "@notetaker/core";

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  /** Ms after which a new utterance starts a new line (default 4s). */
  mergeGapMs?: number;
}

interface MergedLine {
  key: string;
  speakerId: string;
  speakerLabel?: string;
  startMs: number;
  endMs: number;
  text: string;
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

export function TranscriptPanel({ segments, mergeGapMs = 4_000 }: TranscriptPanelProps) {
  const lines = mergeForDisplay(segments, mergeGapMs);

  if (lines.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 0" }}>
        Waiting for speech…
      </p>
    );
  }

  return (
    <div>
      {lines.map((line) => (
        <div key={line.key} className="transcript-segment">
          <span className="transcript-time">{formatMs(line.startMs)}</span>
          <span className="transcript-speaker">{line.speakerLabel ?? line.speakerId}</span>
          <span className="transcript-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

