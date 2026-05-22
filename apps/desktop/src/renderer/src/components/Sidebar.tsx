import { useState } from "react";
import type { SessionMeta } from "@notetaker/core";
import { formatSessionDateTime, formatSessionListTitle } from "../utils/sessionDisplay";

type Page = "session" | "review" | "settings" | "onboarding" | "search";

interface SidebarProps {
  listening: boolean;
  onToggleListening: () => void;
  page: Page;
  onNavigate: (page: Page) => void;
  sessions: SessionMeta[];
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export function Sidebar({
  listening,
  onToggleListening,
  page,
  onNavigate,
  sessions,
  onOpenSession,
  onDeleteSession,
}: SidebarProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const handleDelete = (id: string, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (pendingDelete === id) {
      setPendingDelete(null);
      onDeleteSession(id);
    } else {
      setPendingDelete(id);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">NoteTaker</span>
      </div>

      <div className="listening-indicator">
        <div className={`listening-dot ${listening ? "active" : ""}`} />
        <span>{listening ? "Listening" : "Paused"}</span>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: "4px 8px", fontSize: 12 }} onClick={onToggleListening}>
          {listening ? "Pause" : "Start"}
        </button>
      </div>

      <nav style={{ marginTop: 8 }}>
        <button className={`nav-item ${page === "session" ? "active" : ""}`} onClick={() => onNavigate("session")}>
          Live Session
        </button>
        <button className={`nav-item ${page === "search" ? "active" : ""}`} onClick={() => onNavigate("search")}>
          Search
        </button>
        <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}>
          Settings
        </button>
      </nav>

      {sessions.length > 0 && (
        <div style={{ marginTop: 16, padding: "0 16px", flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Recent
          </div>
          {sessions.slice(0, 20).map((s) => {
            const pending = pendingDelete === s.id;
            return (
              <div
                key={s.id}
                className="session-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpenSession(s.id)}
                onMouseLeave={() => pending && setPendingDelete(null)}
              >
                <div className="session-card-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="session-card-title">{formatSessionListTitle(s)}</div>
                    <div className="session-card-meta">{formatSessionDateTime(s.startedAt)}</div>
                  </div>
                  <button
                    type="button"
                    className={`session-card-delete ${pending ? "armed" : ""}`}
                    aria-label={pending ? "Confirm delete" : "Delete session"}
                    title={pending ? "Click again to confirm" : "Delete"}
                    onClick={(evt) => handleDelete(s.id, evt)}
                  >
                    {pending ? "Delete?" : "×"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
