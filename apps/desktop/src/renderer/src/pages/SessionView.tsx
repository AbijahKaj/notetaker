import { useState, useEffect } from "react";
import type { Session, TranscriptSegment } from "@notetaker/core";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { api } from "../desktop";

interface SessionViewProps {
  session: Session | null;
  segments: TranscriptSegment[];
  listening: boolean;
  onNotesChange: (notes: string) => void;
  onSessionEnded: () => void;
}

export function SessionView({ session, segments, listening, onNotesChange, onSessionEnded }: SessionViewProps) {
  const [notes, setNotes] = useState(session?.userNotes ?? "");
  const [notesTimer, setNotesTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    setNotes(session?.userNotes ?? "");
  }, [session?.id]);

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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          {session ? "Active Session" : listening ? "Listening — waiting for speech" : "Not listening"}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {session && <span className="badge badge-success">Recording</span>}
          {session && (
            <button className="btn btn-ghost" onClick={endSession} disabled={ending}>
              {ending ? "Ending…" : "End session"}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, height: "calc(100vh - 120px)" }}>
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12 }}>
            Your Notes
          </h2>
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder={
              session
                ? "Take rough notes during the meeting…"
                : listening
                  ? "Listening — notes save when speech starts a session…"
                  : "Press Start in the sidebar to begin listening…"
            }
            disabled={!session}
            style={{ flex: 1, minHeight: 0 }}
          />
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12 }}>
            Live Transcript
          </h2>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <TranscriptPanel
              segments={segments}
              sessionStartedAt={session?.startedAt}
              listening={listening}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
