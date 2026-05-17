import { useState, useEffect } from "react";
import type { Preferences, LlmProvider } from "@notetaker/core";
import { api } from "../desktop";

interface SettingsViewProps {
  onRunSetup?: () => void;
}

export function SettingsView({ onRunSetup }: SettingsViewProps) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [apps, setApps] = useState<{ bundleId: string; name: string; installed: boolean; running: boolean }[]>([]);
  const [newSite, setNewSite] = useState("");

  useEffect(() => {
    void (async () => {
      const p = await api().invoke("preferences:get");
      setPrefs(p);
      const detected = await api().invoke("apps:detected");
      setApps(detected);
    })();
  }, []);

  const update = async (patch: Partial<Preferences>) => {
    const next = await api().invoke("preferences:set", patch);
    setPrefs(next);
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
          onChange={(e) => update({ llmProvider: e.target.value as LlmProvider })}
          style={{ marginBottom: 12 }}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="mlx-local">Local MLX (Llama 3.2 3B)</option>
        </select>
        {prefs.llmProvider !== "mlx-local" && (
          <>
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

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Behavior</h2>
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
          <span>Encrypt local database</span>
        </label>
      </div>
    </div>
  );
}
