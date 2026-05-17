import { DEFAULT_LLM_MODELS, resolveLlmModel, type LlmProvider } from "@notetaker/core";
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
  const model = resolveLlmModel(opts.provider, opts.model);
  switch (opts.provider) {
    case "anthropic":
      return new AnthropicSummarizer(opts.apiKey ?? "", model || DEFAULT_LLM_MODELS.anthropic);
    case "openai":
      return new OpenAiSummarizer(opts.apiKey ?? "", model || DEFAULT_LLM_MODELS.openai);
    case "openrouter":
      return new OpenRouterSummarizer(opts.apiKey ?? "", model || DEFAULT_LLM_MODELS.openrouter);
    case "mlx-local":
      return new MlxLocalSummarizer(opts.mlxSidecarPath);
    default:
      return new AnthropicSummarizer(opts.apiKey ?? "", model || DEFAULT_LLM_MODELS.anthropic);
  }
}
