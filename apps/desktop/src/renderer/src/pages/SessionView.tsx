import { useState, useEffect, useRef } from "react";
import type { Session, TranscriptSegment } from "@notetaker/core";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { api } from "../desktop";

interface SessionViewProps {
  session: Session | null;
  segments: TranscriptSegment[];
  listening: boolean;
  showLiveTranscript?: boolean;
  onNotesChange: (notes: string) => void;
  onSessionEnded: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function SessionView({
  session,
  segments,
  listening,
  showLiveTranscript = true,
  onNotesChange,
  onSessionEnded,
}: SessionViewProps) {
  const [notes, setNotes] = useState(session?.userNotes ?? "");
  const [notesTimer, setNotesTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [ending, setEnding] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [now, setNow] = useState(Date.now());
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNotes(session?.userNotes ?? "");
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.id]);

  // Auto-stick to the bottom as new segments arrive.
  useEffect(() => {
    const node = transcriptScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [segments.length]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    if (notesTimer) clearTimeout(notesTimer);
    const t = setTimeout(() => onNotesChange(value), 500);
    setNotesTimer(t);
  };

  const endSession = async () => {
    setEnding(true);
    await api().invoke("sessions:endActive");
    setEnding(false);
    onSessionEnded();
  };

  const elapsedMs = session ? Math.max(0, now - session.startedAt) : 0;
  const recording = Boolean(session);

  const statusLabel = recording
    ? "recording"
    : listening
      ? "listening · waiting for speech"
      : "paused";

  return (
    <div className="live-stage">
      <header className="live-stage-header">
        <span className="live-stage-title">NoteTaker · Live transcript</span>
        <div className={`live-stage-status ${recording ? "recording" : listening ? "listening" : "paused"}`}>
          <span className="live-stage-status-dot" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <div className="live-stage-body" ref={transcriptScrollRef}>
        {showLiveTranscript ? (
          <TranscriptPanel
            segments={segments}
            sessionStartedAt={session?.startedAt}
            listening={listening}
            variant="stage"
          />
        ) : (
          <p className="live-stage-empty">
            Live transcript hidden. Transcription still runs while listening is on.
          </p>
        )}
      </div>

      {showNotes && (
        <div className="live-stage-notes">
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder={
              session
                ? "Take rough notes during the meeting…"
                : "Notes save once speech starts a session."
            }
            disabled={!session}
          />
        </div>
      )}

      <footer className="live-stage-footer">
        <div className="live-stage-footer-left">
          <button
            type="button"
            className="live-stage-pill"
            onClick={() => setShowNotes((v) => !v)}
            title="Toggle notes"
          >
            {showNotes ? "HIDE NOTES" : "NOTES"}
          </button>
          {!recording && (
            <span className="live-stage-hint">
              {listening ? "WAITING FOR SPEECH" : "PRESS START IN THE SIDEBAR"}
            </span>
          )}
        </div>
        <div className="live-stage-footer-right">
          {recording && (
            <button
              type="button"
              className="live-stage-end"
              onClick={endSession}
              disabled={ending}
            >
              {ending ? "ending…" : "end session"}
            </button>
          )}
          <span className="live-stage-elapsed">{formatElapsed(elapsedMs)}</span>
        </div>
      </footer>
    </div>
  );
}
