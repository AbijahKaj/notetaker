import {
  buildUserPrompt,
  parseSummaryJson,
  SUMMARIZE_SYSTEM_PROMPT,
  type Summarizer,
  type SummarizeInput,
} from "./types.js";

export class AnthropicSummarizer implements Summarizer {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async summarize(input: SummarizeInput) {
    const body = {
      model: this.model,
      max_tokens: 4096,
      system: SUMMARIZE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
      tools: [
        {
          name: "meeting_summary",
          description: "Structured meeting summary",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              keyPoints: { type: "array", items: { type: "string" } },
              decisions: { type: "array", items: { type: "string" } },
              actionItems: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    owner: { type: "string" },
                    task: { type: "string" },
                    due: { type: "string" },
                  },
                  required: ["task"],
                },
              },
              openQuestions: { type: "array", items: { type: "string" } },
              followUpEmailDraft: { type: "string" },
            },
            required: [
              "title", "summary", "keyPoints", "decisions",
              "actionItems", "openQuestions", "followUpEmailDraft",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "meeting_summary" },
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as AnthropicResponse;
    const toolUse = data.content?.find((c) => c.type === "tool_use");
    if (toolUse?.input) return toolUse.input as ReturnType<typeof parseSummaryJson>;
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    return parseSummaryJson(text);
  }

  async test() {
    const start = Date.now();
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

interface AnthropicResponse {
  content?: { type: string; text?: string; input?: unknown }[];
}
