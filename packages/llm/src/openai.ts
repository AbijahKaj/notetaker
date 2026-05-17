import {
  buildUserPrompt,
  parseSummaryJson,
  SUMMARIZE_SYSTEM_PROMPT,
  type Summarizer,
  type SummarizeInput,
} from "./types.js";

export class OpenAiSummarizer implements Summarizer {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async summarize(input: SummarizeInput) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return parseSummaryJson(data.choices[0]?.message?.content ?? "{}");
  }

  async test() {
    const start = Date.now();
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
