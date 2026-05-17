import { useState, useEffect } from "react";
import type { LlmProvider } from "@notetaker/core";
import { api } from "../desktop";
import { MicVuMeter } from "../components/MicVuMeter";

type Step = "welcome" | "permissions" | "apps" | "sites" | "models" | "llm" | "test" | "done";

const STEPS: Step[] = ["welcome", "permissions", "apps", "sites", "models", "llm", "test", "done"];

interface OnboardingViewProps {
  onComplete: () => void;
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [micGranted, setMicGranted] = useState(false);
  const [systemAudioRequested, setSystemAudioRequested] = useState(false);
  const [appleEventsGranted, setAppleEventsGranted] = useState(false);
  const [apps, setApps] = useState<{ bundleId: string; name: string; installed: boolean; running: boolean }[]>([]);
  const [appWhitelist, setAppWhitelist] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [newSite, setNewSite] = useState("");
  const [models, setModels] = useState<{ id: string; required: boolean; installed: boolean; sizeBytes: number }[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [testDone, setTestDone] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

  const stepIndex = STEPS.indexOf(step);

  useEffect(() => {
    if (!isMac) setSystemAudioRequested(true);
  }, [isMac]);

  const refreshPermissions = async () => {
    const perms = await api().invoke("permissions:check");
    setMicGranted(perms.microphone === "granted");
  };

  useEffect(() => {
    void api().invoke("window:setKeepVisible", true);
    const unsub = api().on((evt) => {
      if (evt.type === "models:download:progress") {
        const pct = evt.payload.totalBytes > 0
          ? evt.payload.receivedBytes / evt.payload.totalBytes
          : 0;
        setDownloadProgress((prev) => ({ ...prev, [evt.payload.id]: pct }));
      }
    });
    return () => {
      unsub();
      void api().invoke("window:setKeepVisible", false);
    };
  }, []);

  useEffect(() => {
    if (step === "permissions") {
      void (async () => {
        await refreshPermissions();
        const prefs = await api().invoke("preferences:get");
        setAppleEventsGranted(prefs.automationGranted);
      })();
    }
    if (step === "apps") {
      void (async () => {
        const detected = await api().invoke("apps:detected");
        setApps(detected);
        const prefs = await api().invoke("preferences:get");
        setAppWhitelist(prefs.appWhitelist);
      })();
    }
    if (step === "sites") {
      void api().invoke("preferences:get").then((p) => setSites(p.siteWhitelist));
    }
    if (step === "models") {
      void api().invoke("models:status").then(setModels);
    }
  }, [step]);

  const next = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!);
    else void finish();
  };

  const finish = async () => {
    await api().invoke("preferences:set", { onboardingCompleted: true });
    await api().invoke("window:setKeepVisible", false);
    await api().invoke("window:show");
    onComplete();
  };

  const requestMic = async () => {
    const granted = await api().invoke("permissions:request", "microphone");
    setMicGranted(granted);
    await api().invoke("window:show");
  };

  const requestSystemAudio = async () => {
    await api().invoke("permissions:request", "systemAudio");
    setSystemAudioRequested(true);
  };

  const requestAppleEvents = async () => {
    const granted = await api().invoke("permissions:request", "appleEvents");
    setAppleEventsGranted(granted);
    if (granted) {
      await api().invoke("preferences:set", { automationGranted: true });
    }
    await api().invoke("window:show");
  };

  const toggleApp = (bundleId: string) => {
    setAppWhitelist((prev) =>
      prev.includes(bundleId) ? prev.filter((id) => id !== bundleId) : [...prev, bundleId],
    );
  };

  const saveApps = async () => {
    await api().invoke("preferences:set", { appWhitelist });
    next();
  };

  const addSite = () => {
    if (!newSite.trim()) return;
    setSites((prev) => [...prev, newSite.trim()]);
    setNewSite("");
  };

  const removeSite = (site: string) => {
    setSites((prev) => prev.filter((s) => s !== site));
  };

  const saveSites = async () => {
    await api().invoke("preferences:set", { siteWhitelist: sites });
    next();
  };

  const downloadRequiredModels = async () => {
    setDownloading(true);
    const required = models.filter((m) => m.required && !m.installed);
    for (const m of required) {
      setDownloadingId(m.id);
      setDownloadProgress((prev) => ({ ...prev, [m.id]: 0 }));
      await api().invoke("models:download", m.id);
      setDownloadProgress((prev) => ({ ...prev, [m.id]: 1 }));
    }
    setDownloadingId(null);
    const updated = await api().invoke("models:status");
    setModels(updated);
    setDownloading(false);
    await api().invoke("window:show");
  };

  const saveLlm = async () => {
    if (llmProvider !== "mlx-local" && apiKey) {
      await api().invoke("llm:setKey", { provider: llmProvider, apiKey });
    }
    await api().invoke("preferences:set", { llmProvider });
    next();
  };

  const runTest = async () => {
    const { enabled } = await api().invoke("listening:toggle");
    if (enabled) {
      setTimeout(async () => {
        await api().invoke("sessions:endActive");
        setTestDone(true);
      }, 5000);
    }
  };

  const permissionsReady = micGranted && (systemAudioRequested || !isMac);

  const requiredModels = models.filter((m) => m.required);
  const requiredPending = requiredModels.filter((m) => !m.installed);
  const overallProgress = requiredModels.length > 0
    ? requiredModels.reduce((sum, m) => sum + (downloadProgress[m.id] ?? (m.installed ? 1 : 0)), 0) / requiredModels.length
    : 1;

  const formatPct = (pct: number) => `${Math.round(pct * 100)}%`;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div className="onboarding-step">
        <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
          {STEPS.map((s, i) => (
            <div
              key={s}
              style={{
                width: 32,
                height: 4,
                borderRadius: 2,
                background: i <= stepIndex ? "var(--accent)" : "var(--border)",
              }}
            />
          ))}
        </div>

        {step === "welcome" && (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Welcome to NoteTaker</h1>
            <p style={{ color: "var(--text-muted)" }}>
              A privacy-first meeting note taker. Speech recognition runs locally on your device.
              Audio never leaves your machine unless you opt in to a cloud LLM for summaries.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={next}>Get started</button>
            </div>
          </>
        )}

        {step === "permissions" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Permissions</h1>
            <p style={{ color: "var(--text-muted)" }}>
              Grant access so NoteTaker can capture your voice and meeting audio.
            </p>

            <div className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Microphone</span>
                {micGranted ? (
                  <span className="badge badge-success">Granted</span>
                ) : (
                  <button className="btn btn-primary" onClick={requestMic}>Grant access</button>
                )}
              </div>
              {micGranted && <MicVuMeter active />}
            </div>

            <div className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div>System audio</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>macOS 14.2+ — captures meeting app audio</div>
                </div>
                {systemAudioRequested ? (
                  <span className="badge badge-success">Opened settings</span>
                ) : (
                  <button className="btn btn-primary" onClick={requestSystemAudio}>Open settings</button>
                )}
              </div>
            </div>

            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div>Browser tab detection</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Reads meeting tab URLs (e.g. meet.google.com)</div>
                </div>
                {appleEventsGranted ? (
                  <span className="badge badge-success">Granted</span>
                ) : (
                  <button className="btn btn-primary" onClick={requestAppleEvents}>Grant access</button>
                )}
              </div>
            </div>

            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={next} disabled={!permissionsReady}>Continue</button>
            </div>
          </>
        )}

        {step === "apps" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Meeting Apps</h1>
            <p style={{ color: "var(--text-muted)" }}>Select which apps to monitor for meeting audio.</p>
            {apps.map((app) => (
              <div key={app.bundleId} className="whitelist-item">
                <input
                  type="checkbox"
                  checked={appWhitelist.includes(app.bundleId)}
                  onChange={() => toggleApp(app.bundleId)}
                />
                <span style={{ flex: 1 }}>{app.name}</span>
                {app.installed ? (
                  <span className="badge badge-success">Installed</span>
                ) : (
                  <span className="badge badge-muted">Not found</span>
                )}
              </div>
            ))}
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={saveApps}>Continue</button>
            </div>
          </>
        )}

        {step === "sites" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Meeting Sites</h1>
            <p style={{ color: "var(--text-muted)" }}>
              Browser audio is captured only when one of these sites is open in a tab.
            </p>
            {sites.map((site) => (
              <div key={site} className="whitelist-item">
                <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13 }}>{site}</span>
                <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => removeSite(site)}>Remove</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="meet.google.com" onKeyDown={(e) => e.key === "Enter" && addSite()} />
              <button className="btn btn-ghost" onClick={addSite}>Add</button>
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={saveSites}>Continue</button>
            </div>
          </>
        )}

        {step === "models" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Download Models</h1>
            <p style={{ color: "var(--text-muted)" }}>
              Required speech models (~580 MB). Downloaded once, stored locally.
            </p>

            {downloading && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                  <span>
                    {downloadingId
                      ? `Downloading ${downloadingId}…`
                      : downloading
                        ? "Preparing download…"
                        : "Overall progress"}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{formatPct(overallProgress)}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${overallProgress * 100}%` }} />
                </div>
              </div>
            )}

            {models.map((m) => {
              const progress = downloadProgress[m.id];
              const isActive = downloadingId === m.id;
              const showProgress = progress !== undefined && progress < 1;

              return (
                <div key={m.id} className="whitelist-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{m.id}</span>
                    {m.installed ? (
                      <span className="badge badge-success">Installed</span>
                    ) : isActive ? (
                      <span className="badge badge-muted">{formatPct(progress ?? 0)}</span>
                    ) : (
                      <span className="badge badge-muted">{Math.round(m.sizeBytes / 1_000_000)} MB</span>
                    )}
                  </div>
                  {showProgress && (
                    <div className="progress-bar" style={{ marginTop: 8 }}>
                      <div className="progress-bar-fill" style={{ width: `${(progress ?? 0) * 100}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={downloadRequiredModels} disabled={downloading || requiredPending.length === 0}>
                {downloading ? "Downloading…" : requiredPending.length === 0 ? "All required installed" : "Download required"}
              </button>
              <button
                className="btn btn-primary"
                onClick={next}
                disabled={models.some((m) => m.required && !m.installed) || downloading}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "llm" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Summarization</h1>
            <p style={{ color: "var(--text-muted)" }}>Choose how meeting summaries are generated.</p>
            <select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value as LlmProvider)}>
              <option value="anthropic">Anthropic Claude (cloud, best quality)</option>
              <option value="openai">OpenAI GPT (cloud)</option>
              <option value="openrouter">OpenRouter (cloud, flexible)</option>
              <option value="mlx-local">Local MLX Llama 3.2 3B (private, offline)</option>
            </select>
            {llmProvider !== "mlx-local" && (
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API key (optional — can add later in Settings)"
                style={{ marginTop: 8 }}
              />
            )}
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={saveLlm}>Continue</button>
            </div>
          </>
        )}

        {step === "test" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Test Session</h1>
            <p style={{ color: "var(--text-muted)" }}>
              Speak for a few seconds to verify transcription. Listening stays on; only the test session ends.
            </p>
            {testDone ? (
              <div className="card">
                <span className="badge badge-success">Test complete</span>
                <p style={{ marginTop: 8, fontSize: 13 }}>Transcription pipeline is working.</p>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={runTest}>Start 5-second test</button>
            )}
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => { setTestDone(true); next(); }}>Skip</button>
              <button className="btn btn-primary" onClick={next} disabled={!testDone}>Continue</button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>You're all set</h1>
            <p style={{ color: "var(--text-muted)" }}>
              NoteTaker is ready. Use the menu bar icon to start listening, or end individual sessions without pausing.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={finish}>Open NoteTaker</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
