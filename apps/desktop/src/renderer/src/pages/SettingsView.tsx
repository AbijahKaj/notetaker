import { useState, useEffect } from "react";
import type { Preferences, LlmProvider } from "@notetaker/core";
import { defaultLlmModel, llmModelPlaceholder } from "@notetaker/core/llm-defaults";
import { api } from "../desktop";
import { HotkeyInput } from "../components/HotkeyInput";

interface SettingsViewProps {
  onRunSetup?: () => void;
}

const DEFAULT_TOGGLE_HOTKEY = "CommandOrControl+Shift+L";

export function SettingsView({ onRunSetup }: SettingsViewProps) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [apps, setApps] = useState<{ bundleId: string; name: string; installed: boolean; running: boolean }[]>([]);
  const [newSite, setNewSite] = useState("");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    void (async () => {
      const p = await api().invoke("preferences:get");
      setPrefs(p);
      const detected = await api().invoke("apps:detected");
      setApps(detected);
      const version = await api().invoke("system:appVersion");
      setAppVersion(version);
    })();
  }, []);

  const checkForUpdates = async () => {
    setUpdateStatus("Checking…");
    const result = await api().invoke("update:check");
    if (!result.ok) {
      setUpdateStatus(result.error ?? "Update check failed");
    } else if (result.alreadyLatest) {
      setUpdateStatus("You're on the latest version.");
    } else if (result.version) {
      setUpdateStatus(`Update available: ${result.version}. Downloading in the background…`);
    } else {
      setUpdateStatus("Update check finished.");
    }
  };

  const update = async (patch: Partial<Preferences>) => {
    try {
      setSettingsError(null);
      const next = await api().invoke("preferences:set", patch);
      setPrefs(next);
    } catch (err) {
      setSettingsError(String(err));
    }
  };

  const toggleApp = async (bundleId: string) => {
    if (!prefs) return;
    const list = prefs.appWhitelist.includes(bundleId)
      ? prefs.appWhitelist.filter((id) => id !== bundleId)
      : [...prefs.appWhitelist, bundleId];
    await update({ appWhitelist: list });
  };

  const removeSite = async (site: string) => {
    if (!prefs) return;
    await update({ siteWhitelist: prefs.siteWhitelist.filter((s) => s !== site) });
  };

  const addSite = async () => {
    if (!prefs || !newSite.trim()) return;
    await update({ siteWhitelist: [...prefs.siteWhitelist, newSite.trim()] });
    setNewSite("");
  };

  const saveApiKey = async () => {
    if (!prefs || !apiKey) return;
    const result = await api().invoke("llm:setKey", { provider: prefs.llmProvider, apiKey });
    if (result.ok) setTestResult("API key saved");
    else setTestResult(`Error: ${result.error}`);
    setApiKey("");
  };

  const testLlm = async () => {
    if (!prefs) return;
    setTestResult("Testing…");
    const result = await api().invoke("llm:test", prefs.llmProvider);
    setTestResult(result.ok ? `OK (${result.latencyMs}ms)` : `Failed: ${result.error}`);
  };

  if (!prefs) return <p>Loading…</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title">Settings</h1>
      {settingsError && (
        <div className="error-banner">{settingsError}</div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Setup</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          Re-run the onboarding wizard to change permissions, models, or LLM configuration.
        </p>
        <button className="btn btn-ghost" onClick={onRunSetup}>Run setup again</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Meeting Apps</h2>
        {apps.map((app) => (
          <div key={app.bundleId} className="whitelist-item">
            <input
              type="checkbox"
              checked={prefs.appWhitelist.includes(app.bundleId)}
              onChange={() => toggleApp(app.bundleId)}
            />
            <span style={{ flex: 1 }}>{app.name}</span>
            {app.running && <span className="badge badge-success">Running</span>}
            {!app.installed && <span className="badge badge-muted">Not installed</span>}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Meeting Sites (browsers)</h2>
        {prefs.siteWhitelist.map((site) => (
          <div key={site} className="whitelist-item">
            <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13 }}>{site}</span>
            <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => removeSite(site)}>Remove</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="meet.google.com" onKeyDown={(e) => e.key === "Enter" && addSite()} />
          <button className="btn btn-primary" onClick={addSite}>Add</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>LLM Provider</h2>
        <select
          value={prefs.llmProvider}
          onChange={(e) => {
            const llmProvider = e.target.value as LlmProvider;
            void update({ llmProvider, llmModel: defaultLlmModel(llmProvider) });
          }}
          style={{ marginBottom: 12 }}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="mlx-local">Local MLX (Llama 3.2 3B)</option>
        </select>
        {prefs.llmProvider !== "mlx-local" && (
          <>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
              Model
            </label>
            <input
              value={prefs.llmModel}
              onChange={(e) => setPrefs({ ...prefs, llmModel: e.target.value })}
              onBlur={() => {
                const llmModel = prefs.llmModel.trim() || defaultLlmModel(prefs.llmProvider);
                void update({ llmModel });
              }}
              placeholder={llmModelPlaceholder(prefs.llmProvider)}
              style={{ marginBottom: 8, fontFamily: "var(--mono)", fontSize: 13 }}
            />
            {prefs.llmProvider === "openrouter" && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                Use OpenRouter model slugs (e.g. <code>anthropic/claude-sonnet-4</code>). Browse IDs at{" "}
                <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">
                  openrouter.ai/models
                </a>
                .
              </p>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key"
              style={{ marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={saveApiKey}>Save Key</button>
              <button className="btn btn-ghost" onClick={testLlm}>Test Connection</button>
            </div>
            {testResult && <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{testResult}</p>}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Behavior</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={prefs.liveTranscript}
            onChange={(e) => update({ liveTranscript: e.target.checked })}
          />
          <span>Show live transcript</span>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={prefs.encryptDb}
            onChange={(e) => update({ encryptDb: e.target.checked })}
          />
          <span>Encrypt local database (key stored in Keychain)</span>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={prefs.launchAtLogin}
            onChange={(e) => update({ launchAtLogin: e.target.checked })}
          />
          <span>Launch at login</span>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={prefs.persistAudio}
            onChange={(e) => update({ persistAudio: e.target.checked })}
          />
          <span>Save raw audio locally during sessions</span>
        </label>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 10, fontSize: 12 }}
          onClick={() =>
            void api().invoke(
              "system:openExternal",
              "https://abijahkaj.github.io/notetaker/security.html",
            )
          }
        >
          How encryption works
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Keyboard shortcut</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Toggle listening from anywhere. Click below and press a key combination.
        </p>
        <HotkeyInput
          value={prefs.globalShortcutToggleListening}
          onChange={(accelerator) => update({ globalShortcutToggleListening: accelerator })}
          onReset={() => update({ globalShortcutToggleListening: DEFAULT_TOGGLE_HOTKEY })}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Updates</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          {appVersion ? `NoteTaker ${appVersion}` : "NoteTaker"} — checked once on launch. Use the button below to re-check now.
        </p>
        <button className="btn btn-ghost" onClick={checkForUpdates}>Check for updates</button>
        {updateStatus && (
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{updateStatus}</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Troubleshooting</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Crash logs are stored locally and never uploaded. Attach them when reporting a bug.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => void api().invoke("system:revealCrashLogs")}
          >
            Reveal crash logs
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void api().invoke("system:openGithubIssue")}
          >
            Report an issue on GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
