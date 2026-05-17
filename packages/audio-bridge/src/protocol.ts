export type SidecarSource =
  | { type: "mic" }
  | { type: "app"; bundleId: string; pid?: number }
  | { type: "browser"; bundleId: string; matchedSite: string; pid?: number };

export type SidecarCommand =
  | { cmd: "start"; socketPath: string }
  | { cmd: "add"; source: SidecarSource; sourceId: string }
  | { cmd: "remove"; sourceId: string }
  | { cmd: "stop" }
  | { cmd: "ping" };

export type SidecarEvent =
  | { type: "ready" }
  | { type: "pcm"; sourceId: string; tsMs: number; samples: number }
  | { type: "error"; message: string }
  | { type: "source:started"; sourceId: string }
  | { type: "source:stopped"; sourceId: string }
  | { type: "pong" };

export const PCM_HEADER_SIZE = 16;
export const SAMPLE_RATE = 16_000;
