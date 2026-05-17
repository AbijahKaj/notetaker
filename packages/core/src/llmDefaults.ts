import type { LlmProvider } from "./types.js";

/** Default model ID per provider (OpenRouter uses `vendor/model` slugs). */
export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4.1-mini",
  openrouter: "anthropic/claude-sonnet-4",
  "mlx-local": "",
};

export function defaultLlmModel(provider: LlmProvider): string {
  return DEFAULT_LLM_MODELS[provider];
}

/** Pick a model string appropriate for the active provider. */
export function resolveLlmModel(provider: LlmProvider, model: string | undefined): string {
  if (provider === "mlx-local") return "";
  const trimmed = model?.trim() ?? "";
  if (!trimmed) return defaultLlmModel(provider);
  if (provider === "openrouter" && !trimmed.includes("/")) {
    return defaultLlmModel("openrouter");
  }
  return trimmed;
}

export function llmModelPlaceholder(provider: LlmProvider): string {
  switch (provider) {
    case "openrouter":
      return "anthropic/claude-sonnet-4";
    case "openai":
      return "gpt-4.1-mini";
    case "anthropic":
      return "claude-sonnet-4-20250514";
    default:
      return "";
  }
}
