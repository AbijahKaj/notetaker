import { useState } from "react";
import { api } from "../desktop";
import { redactForReport } from "../utils/redact";

export interface ErrorToastItem {
  id: number;
  where: string;
  message: string;
  ts: number;
}

interface ErrorToastsProps {
  errors: ErrorToastItem[];
  appVersion: string;
  onDismiss: (id: number) => void;
}

const GITHUB_REPO = "AbijahKaj/notetaker";

const TITLE_MAP: Record<string, string> = {
  stt: "Speech recognition",
  "audio-sidecar": "Audio capture",
  microphone: "Microphone",
  systemAudio: "System audio",
  summarize: "Summary generation",
  models: "Models",
  appleEvents: "Browser tab detection",
};

function titleFor(where: string): string {
  return TITLE_MAP[where] ?? where;
}

/** Short one-liner: first sentence or trimmed prefix. */
function headlineFor(message: string): string {
  const firstLine = message.split(/[\n\r]/)[0]?.trim() ?? message;
  if (firstLine.length <= 140) return firstLine;
  return `${firstLine.slice(0, 137)}…`;
}

function buildIssueUrl(item: ErrorToastItem, appVersion: string): string {
  const title = `[bug] ${titleFor(item.where)}: ${headlineFor(item.message).slice(0, 80)}`;
  const body = [
    "<!-- Logs below are redacted: home dirs → ~, UUIDs/hashes/emails/IPs replaced. -->",
    "",
    `**Where:** \`${item.where}\``,
    `**Version:** ${appVersion || "unknown"}`,
    `**Platform:** ${navigator.platform || "unknown"}`,
    `**When:** ${new Date(item.ts).toISOString()}`,
    "",
    "## What happened",
    "",
    "<!-- Describe what you were doing when this happened. -->",
    "",
    "## Error",
    "",
    "```",
    redactForReport(item.message),
    "```",
    "",
    "## Steps to reproduce",
    "1. ",
    "2. ",
  ].join("\n");
  return (
    `https://github.com/${GITHUB_REPO}/issues/new?labels=bug` +
    `&title=${encodeURIComponent(title)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

function ErrorToast({
  item,
  appVersion,
  onDismiss,
}: {
  item: ErrorToastItem;
  appVersion: string;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = item.message.length > 140 || item.message.includes("\n");

  return (
    <div className="error-toast" role="alert">
      <div className="error-toast-header">
        <span className="error-toast-icon" aria-hidden>!</span>
        <span className="error-toast-title">{titleFor(item.where)}</span>
        <button
          type="button"
          className="error-toast-close"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="error-toast-body">{headlineFor(item.message)}</div>
      {hasMore && (
        <button
          type="button"
          className="error-toast-disclosure"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && hasMore && (
        <pre className="error-toast-details">{redactForReport(item.message)}</pre>
      )}
      <div className="error-toast-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void api().invoke("system:openExternal", buildIssueUrl(item, appVersion))
          }
        >
          Report on GitHub
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ErrorToasts({ errors, appVersion, onDismiss }: ErrorToastsProps) {
  if (errors.length === 0) return null;
  return (
    <div className="error-toast-stack" aria-live="polite">
      {errors.map((e) => (
        <ErrorToast
          key={e.id}
          item={e}
          appVersion={appVersion}
          onDismiss={() => onDismiss(e.id)}
        />
      ))}
    </div>
  );
}
