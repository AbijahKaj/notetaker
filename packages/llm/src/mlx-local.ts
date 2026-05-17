import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "@notetaker/core";
import {
  buildUserPrompt,
  parseSummaryJson,
  SUMMARIZE_SYSTEM_PROMPT,
  type Summarizer,
  type SummarizeInput,
} from "./types.js";

const log = createLogger("llm:mlx");

export class MlxLocalSummarizer implements Summarizer {
  private sidecarPath: string;
  private process: ChildProcess | null = null;

  constructor(sidecarPath?: string) {
    this.sidecarPath = sidecarPath ?? "native/mlx-summarizer/summarize.py";
  }

  async summarize(input: SummarizeInput) {
    const prompt = `${SUMMARIZE_SYSTEM_PROMPT}\n\n${buildUserPrompt(input)}`;
    const result = await this.sendRequest({ action: "summarize", prompt });
    return parseSummaryJson(result.text ?? "{}");
  }

  async test() {
    const start = Date.now();
    try {
      await this.sendRequest({ action: "ping" });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private sendRequest(req: Record<string, string>): Promise<{ text?: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("python3", [this.sidecarPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => log.warn("mlx stderr", { msg: d.toString() }));

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`MLX sidecar exited with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as { text?: string });
        } catch {
          resolve({ text: stdout });
        }
      });

      proc.stdin?.write(JSON.stringify(req) + "\n");
      proc.stdin?.end();
    });
  }
}
