#!/usr/bin/env python3
"""MLX summarizer sidecar for NoteTaker.

Communicates via stdio JSON lines:
  Input:  {"action": "summarize", "prompt": "..."} or {"action": "ping"}
  Output: {"text": "..."} or {"ok": true}
"""

import json
import sys

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"error": "invalid json"}))
            continue

        action = req.get("action", "")

        if action == "ping":
            print(json.dumps({"ok": True}))
            continue

        if action == "summarize":
            prompt = req.get("prompt", "")
            try:
                result = summarize_with_mlx(prompt)
                print(json.dumps({"text": result}))
            except ImportError:
                print(json.dumps({
                    "text": json.dumps({
                        "title": "Meeting Notes (local stub)",
                        "summary": "MLX not installed. Install with: pip install mlx-lm",
                        "keyPoints": [],
                        "decisions": [],
                        "actionItems": [],
                        "openQuestions": [],
                        "followUpEmailDraft": "",
                    })
                }))
            except Exception as e:
                print(json.dumps({"error": str(e)}))
            continue

        print(json.dumps({"error": f"unknown action: {action}"}))


def summarize_with_mlx(prompt: str) -> str:
    from mlx_lm import load, generate

    model_path = "mlx-community/Llama-3.2-3B-Instruct-4bit"
    model, tokenizer = load(model_path)

    messages = [
        {"role": "system", "content": "You are a meeting notes assistant. Return valid JSON."},
        {"role": "user", "content": prompt},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    response = generate(model, tokenizer, prompt=text, max_tokens=2048, verbose=False)
    return response


if __name__ == "__main__":
    main()
