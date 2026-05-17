type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = /api[_-]?key|authorization|token|bearer/i;

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 16 && /^(sk-|sk_|sk_ant_|or-|or_|nvapi-)/.test(value)) {
      return `${value.slice(0, 6)}…[redacted]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level: Level, scope: string, msg: string, meta?: unknown): void {
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, x) => emit("debug", scope, m, x),
    info: (m, x) => emit("info", scope, m, x),
    warn: (m, x) => emit("warn", scope, m, x),
    error: (m, x) => emit("error", scope, m, x),
    child: (sub: string) => createLogger(`${scope}:${sub}`),
  };
}
