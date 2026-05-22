import { z } from "zod";

export const SAMPLE_RATE = 16_000 as const;
export type SampleRate = typeof SAMPLE_RATE;

export type SourceKind = "mic" | "app" | "browser";

export type SourceSpec =
  | { kind: "mic" }
  | { kind: "app"; bundleId: string }
  | { kind: "browser"; bundleId: string; matchedSite: string };

export interface PcmFrame {
  sourceId: string;
  sourceSpec: SourceSpec;
  sampleRate: SampleRate;
  pcm: Float32Array;
  tsMs: number;
}

export interface SpeechSegment {
  sourceId: string;
  startMs: number;
  endMs: number;
  pcm: Float32Array;
  sampleRate: SampleRate;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  sourceId: string;
  speakerId: string;
  speakerLabel?: string;
  startMs: number;
  endMs: number;
  text: string;
  lang: string;
  confidence?: number;
}

export interface SessionMeta {
  id: string;
  title?: string;
  startedAt: number;
  endedAt?: number;
  appContext?: string;
}

export interface Session extends SessionMeta {
  userNotes: string;
  segments: TranscriptSegment[];
  summary?: MeetingSummary;
}

export const ActionItemSchema = z.object({
  owner: z.string().optional(),
  task: z.string(),
  due: z.string().optional(),
});

export const MeetingSummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
  actionItems: z.array(ActionItemSchema),
  openQuestions: z.array(z.string()),
  followUpEmailDraft: z.string(),
});

export type ActionItem = z.infer<typeof ActionItemSchema>;
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

export const LlmProviderSchema = z.enum([
  "anthropic",
  "openai",
  "openrouter",
  "mlx-local",
]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const PreferencesSchema = z.object({
  listeningEnabled: z.boolean().default(false),
  launchAtLogin: z.boolean().default(false),
  appWhitelist: z.array(z.string()).default([]),
  siteWhitelist: z.array(z.string()).default([]),
  llmProvider: LlmProviderSchema.default("anthropic"),
  llmModel: z.string().default("claude-sonnet-4-20250514"),
  liveTranscript: z.boolean().default(true),
  persistAudio: z.boolean().default(false),
  encryptDb: z.boolean().default(true),
  idleAutoCloseMs: z.number().int().positive().default(5 * 60 * 1000),
  onboardingCompleted: z.boolean().default(false),
  automationGranted: z.boolean().default(false),
  globalShortcutToggleListening: z.string().default("CommandOrControl+Shift+L"),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_APP_WHITELIST: string[] = [
  "us.zoom.xos",
  "com.microsoft.teams2",
  "com.tinyspeck.slackmacgap",
  "com.apple.FaceTime",
  "com.hnc.Discord",
  "com.cisco.webexmeetingsapp",
];

export const DEFAULT_SITE_WHITELIST: string[] = [
  "meet.google.com",
  "teams.microsoft.com",
  "app.zoom.us",
  "discord.com/channels",
  "whereby.com",
  "around.co",
];
