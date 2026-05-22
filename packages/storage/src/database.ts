import type { SqliteDatabase } from "./openDatabase.js";
import { openDatabase } from "./openDatabase.js";
import type {
  MeetingSummary,
  Session,
  SessionMeta,
  TranscriptSegment,
} from "@notetaker/core";
import { newSessionId } from "@notetaker/core";
import { INIT_MIGRATION_SQL } from "./migrations/001_init.js";

export interface DatabaseOptions {
  dbPath: string;
  encryptionKey?: string;
}

export class NoteTakerDatabase {
  private db: SqliteDatabase;

  constructor(opts: DatabaseOptions) {
    this.db = openDatabase({ dbPath: opts.dbPath, encryptionKey: opts.encryptionKey });
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(INIT_MIGRATION_SQL);
  }

  createSession(meta: Partial<SessionMeta> = {}): Session {
    const id = meta.id ?? newSessionId();
    const startedAt = meta.startedAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, started_at, title, app_context, user_notes)
         VALUES (?, ?, ?, ?, '')`,
      )
      .run(id, startedAt, meta.title ?? null, meta.appContext ?? null);
    return this.getSession(id)!;
  }

  closeSession(id: string): Session | null {
    this.db
      .prepare(`UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL`)
      .run(Date.now(), id);
    return this.getSession(id);
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    if (!row) return null;
    const segments = this.getSegments(id);
    return rowToSession(row, segments);
  }

  listSessions(limit = 100, offset = 0): SessionMeta[] {
    const rows = this.db
      .prepare(
        `SELECT id, started_at, ended_at, title, app_context FROM sessions
         ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as SessionRow[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
      title: r.title ?? undefined,
      appContext: r.app_context ?? undefined,
    }));
  }

  searchSessions(query: string, limit = 50): SessionMeta[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT s.id, s.started_at, s.ended_at, s.title, s.app_context
         FROM sessions s
         LEFT JOIN segments seg ON seg.session_id = s.id
         LEFT JOIN segments_fts fts ON fts.rowid = seg.rowid
         WHERE segments_fts MATCH ? OR s.title LIKE ? OR s.user_notes LIKE ?
         ORDER BY s.started_at DESC LIMIT ?`,
      )
      .all(query, `%${query}%`, `%${query}%`, limit) as SessionRow[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
      title: r.title ?? undefined,
      appContext: r.app_context ?? undefined,
    }));
  }

  insertSegment(seg: TranscriptSegment): void {
    this.db
      .prepare(
        `INSERT INTO segments (id, session_id, source_id, start_ms, end_ms, speaker_id, speaker_label, text, lang, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seg.id,
        seg.sessionId,
        seg.sourceId,
        seg.startMs,
        seg.endMs,
        seg.speakerId,
        seg.speakerLabel ?? null,
        seg.text,
        seg.lang,
        seg.confidence ?? null,
      );
  }

  getSegments(sessionId: string): TranscriptSegment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM segments WHERE session_id = ? ORDER BY start_ms ASC`,
      )
      .all(sessionId) as SegmentRow[];
    return rows.map(rowToSegment);
  }

  updateNotes(sessionId: string, notes: string): void {
    this.db
      .prepare(`UPDATE sessions SET user_notes = ? WHERE id = ?`)
      .run(notes, sessionId);
  }

  attachSummary(sessionId: string, summary: MeetingSummary): void {
    this.db
      .prepare(
        `UPDATE sessions SET summary_json = ?, title = COALESCE(title, ?) WHERE id = ?`,
      )
      .run(JSON.stringify(summary), summary.title, sessionId);
  }

  renameSpeaker(sessionId: string, speakerId: string, label: string): void {
    this.db
      .prepare(
        `UPDATE segments SET speaker_label = ? WHERE session_id = ? AND speaker_id = ?`,
      )
      .run(label, sessionId, speakerId);
  }

  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  getOpenSession(): Session | null {
    const row = this.db
      .prepare(`SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`)
      .get() as { id: string } | undefined;
    return row ? this.getSession(row.id) : null;
  }

  close(): void {
    this.db.close();
  }
}

interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  title: string | null;
  app_context: string | null;
  user_notes: string;
  summary_json: string | null;
}

interface SegmentRow {
  id: string;
  session_id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  speaker_id: string;
  speaker_label: string | null;
  text: string;
  lang: string;
  confidence: number | null;
}

function rowToSegment(r: SegmentRow): TranscriptSegment {
  return {
    id: r.id,
    sessionId: r.session_id,
    sourceId: r.source_id,
    speakerId: r.speaker_id,
    speakerLabel: r.speaker_label ?? undefined,
    startMs: r.start_ms,
    endMs: r.end_ms,
    text: r.text,
    lang: r.lang,
    confidence: r.confidence ?? undefined,
  };
}

function rowToSession(row: SessionRow, segments: TranscriptSegment[]): Session {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    title: row.title ?? undefined,
    appContext: row.app_context ?? undefined,
    userNotes: row.user_notes,
    segments,
    summary: row.summary_json
      ? (JSON.parse(row.summary_json) as MeetingSummary)
      : undefined,
  };
}
