import type { TranscriptSegment } from "@notetaker/core";

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function TranscriptPanel({ segments }: TranscriptPanelProps) {
  if (segments.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 0" }}>
        Waiting for speech…
      </p>
    );
  }

  return (
    <div>
      {segments.map((seg) => (
        <div key={seg.id} className="transcript-segment">
          <span className="transcript-time">{formatMs(seg.startMs)}</span>
          <span className="transcript-speaker">{seg.speakerLabel ?? seg.speakerId}</span>
          <span className="transcript-text">{seg.text}</span>
        </div>
      ))}
    </div>
  );
}
