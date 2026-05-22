import { useEffect, useState } from "react";

interface HotkeyInputProps {
  value: string;
  onChange: (accelerator: string) => void;
  onReset?: () => void;
}

const SPECIAL_KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Return",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

export function HotkeyInput({ value, onChange, onReset }: HotkeyInputProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(false);
        setPending(null);
        return;
      }

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");

      if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) {
        setPending(parts.length > 0 ? parts.join("+") + "+…" : "…");
        return;
      }

      let key: string;
      if (e.key.length === 1) {
        key = e.key.toUpperCase();
      } else if (SPECIAL_KEY_LABELS[e.key]) {
        key = SPECIAL_KEY_LABELS[e.key]!;
      } else if (/^F\d{1,2}$/.test(e.key)) {
        key = e.key;
      } else {
        key = e.key;
      }

      if (parts.length === 0) {
        setPending("Add a modifier (⌘, ⌃, ⌥, or ⇧)");
        return;
      }

      parts.push(key);
      const accelerator = parts.join("+");
      onChange(accelerator);
      setPending(null);
      setRecording(false);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  const label = recording ? pending ?? "Press a key combination…" : formatAccelerator(value);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className={recording ? "btn btn-primary" : "btn btn-ghost"}
        onClick={() => {
          setPending(null);
          setRecording((r) => !r);
        }}
        style={{ fontFamily: "var(--mono)", minWidth: 220, justifyContent: "center" }}
      >
        {label}
      </button>
      {recording && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Esc to cancel</span>
      )}
      {!recording && onReset && (
        <button type="button" className="btn btn-ghost" onClick={onReset} style={{ fontSize: 12 }}>
          Reset to default
        </button>
      )}
    </div>
  );
}

function formatAccelerator(value: string): string {
  return value
    .split("+")
    .map((p) => {
      if (p === "CommandOrControl") return "⌘";
      if (p === "Command") return "⌘";
      if (p === "Control") return "⌃";
      if (p === "Alt" || p === "Option") return "⌥";
      if (p === "Shift") return "⇧";
      return p;
    })
    .join(" ");
}
