import type { LlmProvider } from "@notetaker/core";
import type { Summarizer } from "./types.js";
import { AnthropicSummarizer } from "./anthropic.js";
import { OpenAiSummarizer } from "./openai.js";
import { OpenRouterSummarizer } from "./openrouter.js";
import { MlxLocalSummarizer } from "./mlx-local.js";

export interface SummarizerFactoryOptions {
  provider: LlmProvider;
  apiKey?: string;
  model?: string;
  mlxSidecarPath?: string;
}

export function createSummarizer(opts: SummarizerFactoryOptions): Summarizer {
  switch (opts.provider) {
    case "anthropic":
      return new AnthropicSummarizer(opts.apiKey ?? "", opts.model ?? "claude-sonnet-4-20250514");
    case "openai":
      return new OpenAiSummarizer(opts.apiKey ?? "", opts.model ?? "gpt-4.1-mini");
    case "openrouter":
      return new OpenRouterSummarizer(opts.apiKey ?? "", opts.model ?? "anthropic/claude-sonnet-4");
    case "mlx-local":
      return new MlxLocalSummarizer(opts.mlxSidecarPath);
    default:
      return new AnthropicSummarizer(opts.apiKey ?? "", opts.model ?? "claude-sonnet-4-20250514");
  }
}
