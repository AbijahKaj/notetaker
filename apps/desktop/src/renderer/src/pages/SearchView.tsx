import { useState } from "react";
import type { SessionMeta } from "@notetaker/core";
import { api } from "../desktop";
import { formatSessionDateTime, formatSessionListTitle } from "../utils/sessionDisplay";

interface SearchViewProps {
  onOpenSession: (id: string) => void;
}

export function SearchView({ onOpenSession }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionMeta[]>([]);

  const search = async () => {
    if (!query.trim()) return;
    const res = await api().invoke("sessions:search", query.trim());
    setResults(res);
  };

  return (
    <div>
      <h1 className="page-title">Search</h1>
      <div className="search-bar" style={{ display: "flex", gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcripts and notes…"
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="btn btn-primary" onClick={search}>Search</button>
      </div>

      {results.map((s) => (
        <button
          key={s.id}
          className="session-card"
          style={{ width: "100%", textAlign: "left" }}
          onClick={() => onOpenSession(s.id)}
        >
          <div className="session-card-title">{formatSessionListTitle(s)}</div>
          <div className="session-card-meta">
            {formatSessionDateTime(s.startedAt)}
            {s.appContext ? ` · ${s.appContext}` : ""}
          </div>
        </button>
      ))}

      {results.length === 0 && query && (
        <p style={{ color: "var(--text-muted)" }}>No results for "{query}"</p>
      )}
    </div>
  );
}
