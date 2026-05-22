import { useState } from "react";
import type { Session } from "@notetaker/core";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { api } from "../desktop";

interface ReviewViewProps {
  session: Session;
  onBack: () => void;
  onRenameSpeaker: (speakerId: string, label: string) => void;
  onDelete: () => void;
}

export function ReviewView({ session, onBack, onRenameSpeaker, onDelete }: ReviewViewProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const speakers = [...new Set(session.segments.map((s) => s.speakerId))];

  const startRename = (speakerId: string) => {
    const existing = session.segments.find((s) => s.speakerId === speakerId)?.speakerLabel ?? speakerId;
    setRenaming(speakerId);
    setRenameValue(existing);
  };

  const commitRename = () => {
    if (renaming && renameValue.trim()) {
      onRenameSpeaker(renaming, renameValue.trim());
    }
    setRenaming(null);
  };

  const exportSession = async (format: "markdown" | "json" | "srt") => {
    const channel = `export:${format}` as "export:markdown" | "export:json" | "export:srt";
    const content = await api().invoke(channel, session.id);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${session.id}.${format === "markdown" ? "md" : format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <h1 className="page-title" style={{ marginBottom: 0, flex: 1 }}>
          {session.summary?.title ?? session.title ?? "Meeting Review"}
        </h1>
        {confirmDelete ? (
          <>
            <button className="btn btn-danger" onClick={onDelete}>
              Confirm delete
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)} title="Delete this session">
            Delete
          </button>
        )}
      </div>

      {session.summary && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="summary-section">
            <h3>Summary</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{session.summary.summary}</p>
          </div>

          {session.summary.keyPoints.length > 0 && (
            <div className="summary-section">
              <h3>Key Points</h3>
              <ul>{session.summary.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          {session.summary.decisions.length > 0 && (
            <div className="summary-section">
              <h3>Decisions</h3>
              <ul>{session.summary.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}

          {session.summary.actionItems.length > 0 && (
            <div className="summary-section">
              <h3>Action Items</h3>
              <ul>
                {session.summary.actionItems.map((a, i) => (
                  <li key={i}>
                    {a.task}
                    {a.owner ? ` (${a.owner})` : ""}
                    {a.due ? ` — due ${a.due}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {session.summary.followUpEmailDraft && (
            <div className="summary-section">
              <h3>Follow-up Email</h3>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-muted)" }}>
                {session.summary.followUpEmailDraft}
              </pre>
            </div>
          )}
        </div>
      )}

      {session.userNotes && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>Your Notes</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: 13 }}>{session.userNotes}</pre>
        </div>
      )}

      {speakers.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>Speakers</h3>
          {speakers.map((id) => (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              {renaming === id ? (
                <>
                  <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} style={{ width: 160 }} />
                  <button className="btn btn-primary" style={{ padding: "4px 12px" }} onClick={commitRename}>Save</button>
                </>
              ) : (
                <>
                  <span>{session.segments.find((s) => s.speakerId === id)?.speakerLabel ?? id}</span>
                  <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => startRename(id)}>Rename</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>Transcript</h3>
        <TranscriptPanel segments={session.segments} sessionStartedAt={session.startedAt} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => exportSession("markdown")}>Export Markdown</button>
        <button className="btn btn-ghost" onClick={() => exportSession("json")}>Export JSON</button>
        <button className="btn btn-ghost" onClick={() => exportSession("srt")}>Export SRT</button>
      </div>
    </div>
  );
}
