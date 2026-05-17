import { createSummarizer } from "@notetaker/llm";
import { createLogger, resolveLlmModel, type Session, type LlmProvider } from "@notetaker/core";
import type { LlmKeyService } from "./LlmKeyService.js";
import type { PreferencesService } from "./PreferencesService.js";
import type { ModelManager } from "./ModelManager.js";

const log = createLogger("summarizer");

export class SummarizationService {
  private llmKeys: LlmKeyService;
  private prefs: PreferencesService;
  private models: ModelManager;

  constructor(llmKeys: LlmKeyService, prefs: PreferencesService, models: ModelManager) {
    this.llmKeys = llmKeys;
    this.prefs = prefs;
    this.models = models;
  }

  async summarize(session: Session) {
    const prefs = this.prefs.get();
    let provider = prefs.llmProvider;

    if (provider !== "mlx-local") {
      const hasKey = await this.llmKeys.has(provider);
      if (!hasKey) {
        provider = "mlx-local";
      }
    }

    const apiKey = provider !== "mlx-local" ? (await this.llmKeys.get(provider)) ?? undefined : undefined;

    const model = resolveLlmModel(provider, prefs.llmModel);

    const summarizer = createSummarizer({
      provider,
      apiKey,
      model,
    });

    log.info("summarizing session", { id: session.id, provider });
    try {
      return await summarizer.summarize({
        transcript: session.segments,
        userNotes: session.userNotes,
        meta: {
          id: session.id,
          title: session.title,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          appContext: session.appContext,
        },
      });
    } catch (err) {
      if (provider !== "mlx-local") {
        log.warn("cloud summarize failed, falling back to local MLX", { err: String(err) });
        const local = createSummarizer({ provider: "mlx-local" });
        return local.summarize({
          transcript: session.segments,
          userNotes: session.userNotes,
          meta: {
            id: session.id,
            title: session.title,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            appContext: session.appContext,
          },
        });
      }
      throw err;
    }
  }

  async test(provider: LlmProvider) {
    const apiKey = provider !== "mlx-local" ? (await this.llmKeys.get(provider)) ?? "" : "";
    const prefs = this.prefs.get();
    const summarizer = createSummarizer({
      provider,
      apiKey,
      model: resolveLlmModel(provider, prefs.llmModel),
    });
    return summarizer.test();
  }
}
