import type {
  MeetingSummary,
  Preferences,
  Session,
  SessionMeta,
  TranscriptSegment,
  LlmProvider,
} from "./types.js";

export type IpcEvent =
  | { type: "listening:changed"; payload: { enabled: boolean } }
  | { type: "session:opened"; payload: Session }
  | { type: "session:closed"; payload: Session }
  | { type: "transcript:segment"; payload: TranscriptSegment }
  | { type: "audio:level"; payload: { sourceId: string; rms: number } }
  | { type: "models:download:progress"; payload: { id: string; receivedBytes: number; totalBytes: number } }
  | { type: "permission:changed"; payload: { kind: "microphone" | "systemAudio"; granted: boolean } }
  | { type: "summary:ready"; payload: { sessionId: string; summary: MeetingSummary } }
  | { type: "error"; payload: { where: string; message: string } };

export type PermissionState = "granted" | "denied" | "not-determined" | "restricted";

export interface IpcInvokeMap {
  "preferences:get": () => Preferences;
  "preferences:set": (patch: Partial<Preferences>) => Preferences;
  "permissions:check": () => { microphone: PermissionState; systemAudio: PermissionState; appleEvents: PermissionState };
  "permissions:request": (kind: "microphone" | "systemAudio" | "appleEvents") => boolean;
  "listening:toggle": () => { enabled: boolean };
  "listening:get": () => { enabled: boolean };
  "sessions:list": (opts: { limit?: number; offset?: number }) => SessionMeta[];
  "sessions:get": (id: string) => Session | null;
  "sessions:search": (q: string) => SessionMeta[];
  "sessions:updateNotes": (args: { id: string; notes: string }) => void;
  "sessions:renameSpeaker": (args: { sessionId: string; speakerId: string; label: string }) => void;
  "sessions:delete": (id: string) => void;
  "sessions:endActive": () => Session | null;
  "sessions:getActive": () => Session | null;
  "summarize:run": (sessionId: string) => MeetingSummary;
  "llm:setKey": (args: { provider: LlmProvider; apiKey: string }) => { ok: boolean; error?: string };
  "llm:hasKey": (provider: LlmProvider) => boolean;
  "llm:test": (provider: LlmProvider) => { ok: boolean; latencyMs?: number; error?: string };
  "models:status": () => { id: string; required: boolean; installed: boolean; sizeBytes: number }[];
  "models:download": (id: string) => { ok: boolean };
  "apps:detected": () => { bundleId: string; name: string; installed: boolean; running: boolean }[];
  "export:markdown": (sessionId: string) => string;
  "export:json": (sessionId: string) => string;
  "export:srt": (sessionId: string) => string;
  "system:openExternal": (url: string) => void;
  "system:quit": () => void;
  "window:show": () => void;
  "window:setKeepVisible": (keep: boolean) => void;
}

export type IpcChannel = keyof IpcInvokeMap;
