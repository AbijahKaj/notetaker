import type { SessionMeta } from "@notetaker/core";

type Page = "session" | "review" | "settings" | "onboarding" | "search";

interface SidebarProps {
  listening: boolean;
  onToggleListening: () => void;
  page: Page;
  onNavigate: (page: Page) => void;
  sessions: SessionMeta[];
  onOpenSession: (id: string) => void;
}

export function Sidebar({
  listening,
  onToggleListening,
  page,
  onNavigate,
  sessions,
  onOpenSession,
}: SidebarProps) {
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
          {sessions.slice(0, 10).map((s) => (
            <button
              key={s.id}
              className="session-card"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => onOpenSession(s.id)}
            >
              <div className="session-card-title">{s.title ?? "Untitled session"}</div>
              <div className="session-card-meta">
                {new Date(s.startedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
