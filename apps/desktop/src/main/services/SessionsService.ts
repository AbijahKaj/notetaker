import {
  TypedEmitter,
  createLogger,
  newSegmentId,
  type TranscriptSegment,
  type Session,
  type SessionMeta,
  type MeetingSummary,
  type PipelineEvents,
} from "@notetaker/core";
import type { StorageService } from "./StorageService.js";
import type { PreferencesService } from "./PreferencesService.js";
import type { SpeechService } from "./SpeechService.js";

const log = createLogger("sessions");

export class SessionsService extends TypedEmitter<Pick<PipelineEvents, "session:opened" | "session:closed">> {
  private storage: StorageService;
  private prefs: PreferencesService;
  private speech: SpeechService | null;
  private activeSessionId: string | null = null;
  private sessionEpochMs = 0;
  private lastActivityMs = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storage: StorageService, prefs: PreferencesService, speech?: SpeechService) {
    super();
    this.storage = storage;
    this.prefs = prefs;
    this.speech = speech ?? null;
    this.recoverCrashedSessions();
  }

  private recoverCrashedSessions(): void {
    const open = this.storage.getDb().getOpenSession();
    if (open) {
      this.storage.getDb().closeSession(open.id);
    }
  }

  /** Opens a session when listening starts so timestamps align with the audio timeline. */
  beginListeningSession(startedAt: number): Session {
    if (this.activeSessionId) {
      const existing = this.storage.getDb().getSession(this.activeSessionId);
      if (existing) return existing;
    }

    const open = this.storage.getDb().getOpenSession();
    if (open) {
      this.activeSessionId = open.id;
      this.sessionEpochMs = open.startedAt;
      this.startIdleTimer();
      return open;
    }

    const session = this.storage.getDb().createSession({
      appContext: "listening",
      startedAt,
    });
    this.activeSessionId = session.id;
    this.sessionEpochMs = startedAt;
    this.lastActivityMs = Date.now();
    this.speech?.setSessionId(session.id);
    this.startIdleTimer();
    this.emit("session:opened", session);
    log.info("session opened for listening", { id: session.id });
    return session;
  }

  async absorbSegment(seg: Omit<TranscriptSegment, "id" | "sessionId">): Promise<TranscriptSegment | null> {
    const text = seg.text.trim();
    if (!text) return null;

    const sessionId = await this.ensureActiveSession(seg.sourceId);
    const full: TranscriptSegment = {
      ...seg,
      text,
      id: newSegmentId(),
      sessionId,
      startMs: normalizeTimelineMs(seg.startMs, this.sessionEpochMs),
      endMs: normalizeTimelineMs(seg.endMs, this.sessionEpochMs),
    };
    this.storage.getDb().insertSegment(full);
    this.lastActivityMs = Date.now();
    return full;
  }

  private async ensureActiveSession(sourceId: string): Promise<string> {
    if (this.activeSessionId) {
      if (!this.sessionEpochMs) {
        const s = this.storage.getDb().getSession(this.activeSessionId);
        if (s) this.sessionEpochMs = s.startedAt;
      }
      return this.activeSessionId;
    }

    const open = this.storage.getDb().getOpenSession();
    if (open) {
      this.activeSessionId = open.id;
      this.sessionEpochMs = open.startedAt;
      this.startIdleTimer();
      return open.id;
    }

    const session = this.storage.getDb().createSession({
      appContext: sourceId,
      startedAt: Date.now(),
    });
    this.activeSessionId = session.id;
    this.sessionEpochMs = session.startedAt;
    this.lastActivityMs = Date.now();
    this.speech?.setSessionId(session.id);
    this.startIdleTimer();
    this.emit("session:opened", session);
    log.info("session opened", { id: session.id });
    return session.id;
  }

  private startIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const idleMs = this.prefs.get().idleAutoCloseMs;
      if (this.activeSessionId && Date.now() - this.lastActivityMs > idleMs) {
        void this.closeActive();
      }
    }, 30_000);
  }

  async closeActive(): Promise<Session | null> {
    if (!this.activeSessionId) return null;
    const id = this.activeSessionId;
    this.activeSessionId = null;
    this.sessionEpochMs = 0;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    const session = this.storage.getDb().closeSession(id);
    if (session) {
      this.emit("session:closed", session);
      log.info("session closed", { id });
    }
    return session;
  }

  list(limit: number, offset: number): SessionMeta[] {
    return this.storage.getDb().listSessions(limit, offset);
  }

  get(id: string): Session | null {
    return this.storage.getDb().getSession(id);
  }

  search(q: string): SessionMeta[] {
    return this.storage.getDb().searchSessions(q);
  }

  updateNotes(id: string, notes: string): void {
    this.storage.getDb().updateNotes(id, notes);
  }

  renameSpeaker(sessionId: string, speakerId: string, label: string): void {
    this.storage.getDb().renameSpeaker(sessionId, speakerId, label);
  }

  delete(id: string): void {
    this.storage.getDb().deleteSession(id);
    if (this.activeSessionId === id) this.activeSessionId = null;
  }

  attachSummary(sessionId: string, summary: MeetingSummary): void {
    this.storage.getDb().attachSummary(sessionId, summary);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }
}

/** Values from the sidecar are epoch ms; speech engine uses ms since listen start. */
function normalizeTimelineMs(ms: number, sessionEpochMs: number): number {
  if (ms > 1e12 && sessionEpochMs > 0) return Math.max(0, ms - sessionEpochMs);
  return Math.max(0, ms);
}
