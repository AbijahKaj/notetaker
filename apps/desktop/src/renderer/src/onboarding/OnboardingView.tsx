import { useState, useEffect } from "react";
import type { LlmProvider } from "@notetaker/core";
import { defaultLlmModel, llmModelPlaceholder } from "@notetaker/core/llm-defaults";
import { api } from "../desktop";
import { MicVuMeter } from "../components/MicVuMeter";

type Step = "welcome" | "permissions" | "apps" | "sites" | "models" | "llm" | "test" | "done";

type ModelPhase = "downloading" | "extracting" | "finishing" | "done";

const STEPS: Step[] = ["welcome", "permissions", "apps", "sites", "models", "llm", "test", "done"];

const MODEL_PHASE_LABEL: Record<ModelPhase, string> = {
  downloading: "Downloading",
  extracting: "Extracting",
  finishing: "Installing",
  done: "Installed",
};

interface OnboardingViewProps {
  onComplete: () => void;
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [micGranted, setMicGranted] = useState(false);
  const [systemAudioRequested, setSystemAudioRequested] = useState(false);
  const [systemAudioHint, setSystemAudioHint] = useState<string | null>(null);
  const [appleEventsGranted, setAppleEventsGranted] = useState(false);
  const [apps, setApps] = useState<{ bundleId: string; name: string; installed: boolean; running: boolean }[]>([]);
  const [appWhitelist, setAppWhitelist] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [newSite, setNewSite] = useState("");
  const [models, setModels] = useState<{ id: string; required: boolean; installed: boolean; sizeBytes: number }[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [modelPhases, setModelPhases] = useState<Record<string, ModelPhase>>({});
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("anthropic");
  const [llmModel, setLlmModel] = useState(defaultLlmModel("anthropic"));
  const [apiKey, setApiKey] = useState("");
  const [testDone, setTestDone] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testPhase, setTestPhase] = useState<"idle" | "warming" | "listening" | "running">("idle");
  const [testCountdown, setTestCountdown] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
        const { id, phase, receivedBytes, totalBytes } = evt.payload;
        setModelPhases((prev) => ({ ...prev, [id]: phase }));
        if (phase === "downloading" && receivedBytes !== undefined && totalBytes) {
          setDownloadProgress((prev) => ({
            ...prev,
            [id]: totalBytes > 0 ? receivedBytes / totalBytes : 0,
          }));
        }
        if (phase === "done") {
          setDownloadProgress((prev) => ({ ...prev, [id]: 1 }));
          void api().invoke("models:status").then(setModels);
        }
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
    setSystemAudioHint(
      "System Settings → Privacy & Security → Audio Capture. Enable “NoteTaker” (packaged app) or “NoteTaker” / “Electron” when running via pnpm dev. The entry only appears after you tap this button.",
    );
    await api().invoke("window:show");
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
    setDownloadError(null);
    const required = models.filter((m) => m.required && !m.installed);
    if (required.length === 0) {
      setDownloading(false);
      return;
    }

    setDownloadProgress((prev) => {
      const next = { ...prev };
      for (const m of required) next[m.id] = 0;
      return next;
    });
    setModelPhases((prev) => {
      const next = { ...prev };
      for (const m of required) next[m.id] = "downloading";
      return next;
    });

    const failures: { id: string; err: unknown }[] = [];

    await Promise.all(
      required.map(async (m) => {
        try {
          await api().invoke("models:download", m.id);
          setModelPhases((prev) => ({ ...prev, [m.id]: "done" }));
          setDownloadProgress((prev) => ({ ...prev, [m.id]: 1 }));
        } catch (err) {
          failures.push({ id: m.id, err });
          setModelPhases((prev) => {
            const next = { ...prev };
            delete next[m.id];
            return next;
          });
        }
      }),
    );

    const updated = await api().invoke("models:status");
    setModels(updated);

    if (failures.length > 0) {
      const ids = failures.map((f) => f.id).join(", ");
      setDownloadError(
        `Failed to download: ${ids}. Check your connection and click Retry.`,
      );
    } else {
      await api().invoke("window:show");
    }

    setDownloading(false);
  };

  const saveLlm = async () => {
    if (llmProvider !== "mlx-local" && apiKey) {
      await api().invoke("llm:setKey", { provider: llmProvider, apiKey });
    }
    await api().invoke("preferences:set", {
      llmProvider,
      llmModel: llmModel.trim() || defaultLlmModel(llmProvider),
    });
    next();
  };

  const onLlmProviderChange = (provider: LlmProvider) => {
    setLlmProvider(provider);
    setLlmModel(defaultLlmModel(provider));
  };

  const runTest = async () => {
    setTestError(null);
    setTestPhase("running");

    let firstTranscriptResolve: (() => void) | null = null;
    const firstTranscript = new Promise<void>((resolve) => {
      firstTranscriptResolve = resolve;
    });
    let sawTranscript = false;
    const unsub = api().on((evt) => {
      if (evt.type === "transcript:segment" && evt.payload.text.trim().length > 2) {
        sawTranscript = true;
        firstTranscriptResolve?.();
      }
    });

    const before = await api().invoke("listening:get");

    try {
      // Toggle on (heavy: loads sherpa/parakeet — can take several seconds the first time).
      setTestPhase("warming");
      if (!before.enabled) {
        await api().invoke("listening:toggle");
      }

      // Engine is loaded — give the user a clear visual cue and a countdown.
      setTestPhase("listening");
      const totalSeconds = 10;
      setTestCountdown(totalSeconds);
      const tickHandle = setInterval(() => {
        setTestCountdown((prev) => (prev === null ? null : Math.max(0, prev - 1)));
      }, 1000);

      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, totalSeconds * 1000),
      );
      await Promise.race([firstTranscript, timeout]);
      clearInterval(tickHandle);
      setTestCountdown(null);
    } finally {
      await api().invoke("sessions:endActive").catch(() => {});
      if (!before.enabled) {
        await api().invoke("listening:toggle").catch(() => {});
      }
      unsub();
      setTestPhase("idle");
    }

    if (sawTranscript) {
      setTestDone(true);
    } else {
      setTestError(
        "No transcript detected. Make sure mic access is granted in System Settings, then try again and speak clearly.",
      );
    }
  };

  const permissionsReady = micGranted && (systemAudioRequested || !isMac);

  const requiredModels = models.filter((m) => m.required);
  const requiredPending = requiredModels.filter((m) => !m.installed);

  const modelContribution = (m: (typeof models)[number]) => {
    if (m.installed) return 1;
    const phase = modelPhases[m.id];
    const pct = downloadProgress[m.id] ?? 0;
    if (phase === "done") return 1;
    if (phase === "extracting") return 0.92;
    if (phase === "finishing") return 0.98;
    if (phase === "downloading") return pct * 0.9;
    return 0;
  };

  const overallProgress = requiredModels.length > 0
    ? requiredModels.reduce((sum, m) => sum + modelContribution(m), 0) / requiredModels.length
    : 1;

  const formatPct = (pct: number) => `${Math.round(pct * 100)}%`;

  const inFlightModels = requiredModels.filter((m) => {
    const phase = modelPhases[m.id];
    return !m.installed && phase && phase !== "done";
  });
  const anyExtracting = inFlightModels.some(
    (m) => modelPhases[m.id] === "extracting" || modelPhases[m.id] === "finishing",
  );

  const activeStatusLabel = (() => {
    if (!downloading) return "Preparing download…";
    if (inFlightModels.length === 0) return "Finishing up…";
    if (inFlightModels.length === 1) {
      const m = inFlightModels[0]!;
      const phase = modelPhases[m.id];
      if (phase === "extracting") return `Extracting ${m.id}…`;
      if (phase === "finishing") return `Installing ${m.id}…`;
      return `Downloading ${m.id}… ${formatPct(downloadProgress[m.id] ?? 0)}`;
    }
    return `Downloading ${inFlightModels.length} models in parallel…`;
  })();

  const modelBadge = (m: (typeof models)[number]) => {
    if (m.installed) return <span className="badge badge-success">Installed</span>;
    const phase = modelPhases[m.id];
    if (phase === "extracting") {
      return <span className="badge badge-muted">Extracting…</span>;
    }
    if (phase === "finishing") {
      return <span className="badge badge-muted">Installing…</span>;
    }
    if (phase === "downloading") {
      return <span className="badge badge-muted">{formatPct(downloadProgress[m.id] ?? 0)}</span>;
    }
    if (phase === "done") {
      return <span className="badge badge-success">Installed</span>;
    }
    return <span className="badge badge-muted">{Math.round(m.sizeBytes / 1_000_000)} MB</span>;
  };

  return (
    <div className="onboarding-shell" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
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
              A privacy-first meeting note taker. Your microphone stays on; speech recognition runs locally.
              System audio is captured only from whitelisted meeting apps and browser tabs.
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
              Three separate macOS permissions (microphone, system audio, browser automation).
              You should see one dialog per button — not the same prompt repeated.
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
                  <button className="btn btn-primary" onClick={requestSystemAudio}>Enable &amp; open settings</button>
                )}
              </div>
              {systemAudioHint && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{systemAudioHint}</p>
              )}
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

            {downloadError && (
              <div className="card" style={{ marginBottom: 12, borderColor: "var(--danger, #e55)" }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--danger, #e55)" }}>{downloadError}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    className="btn btn-primary"
                    onClick={downloadRequiredModels}
                    disabled={downloading}
                  >
                    Retry download
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setDownloadError(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {downloading && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, gap: 12 }}>
                  <span>{activeStatusLabel}</span>
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{formatPct(overallProgress)}</span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill${anyExtracting ? " progress-bar-fill-pulse" : ""}`}
                    style={{ width: `${overallProgress * 100}%` }}
                  />
                </div>
              </div>
            )}

            {models.map((m) => {
              const progress = downloadProgress[m.id];
              const phase = modelPhases[m.id];
              const isActive = downloading && !!phase && phase !== "done";
              const showDownloadBar = phase === "downloading" && progress !== undefined;
              const showExtractBar = phase === "extracting" || phase === "finishing";

              return (
                <div key={m.id} className="whitelist-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{m.id}</span>
                    {modelBadge(m)}
                  </div>
                  {isActive && phase && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                      {MODEL_PHASE_LABEL[phase]}
                      {phase === "downloading" ? ` ${formatPct(progress ?? 0)}` : "…"}
                    </p>
                  )}
                  {showDownloadBar && (
                    <div className="progress-bar" style={{ marginTop: 8 }}>
                      <div className="progress-bar-fill" style={{ width: `${(progress ?? 0) * 100}%` }} />
                    </div>
                  )}
                  {showExtractBar && (
                    <div className="progress-bar progress-bar-indeterminate" style={{ marginTop: 8 }} />
                  )}
                </div>
              );
            })}
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={downloadRequiredModels} disabled={downloading || requiredPending.length === 0}>
                {downloading
                  ? anyExtracting
                    ? "Extracting…"
                    : "Downloading…"
                  : requiredPending.length === 0
                    ? "All required installed"
                    : "Download required"}
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
            <select value={llmProvider} onChange={(e) => onLlmProviderChange(e.target.value as LlmProvider)}>
              <option value="anthropic">Anthropic Claude (cloud, best quality)</option>
              <option value="openai">OpenAI GPT (cloud)</option>
              <option value="openrouter">OpenRouter (cloud, flexible)</option>
              <option value="mlx-local">Local MLX Llama 3.2 3B (private, offline)</option>
            </select>
            {llmProvider !== "mlx-local" && (
              <>
                <input
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  placeholder={llmModelPlaceholder(llmProvider)}
                  style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 13 }}
                />
                {llmProvider === "openrouter" && (
                  <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                    OpenRouter model ID, e.g. <code>anthropic/claude-sonnet-4</code>
                  </p>
                )}
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API key (optional — can add later in Settings)"
                  style={{ marginTop: 8 }}
                />
              </>
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
            ) : testPhase === "warming" ? (
              <div className="card">
                <p style={{ fontSize: 13, marginBottom: 8 }}>
                  Loading speech engine… first time can take 5–15 seconds while Parakeet is loaded into memory.
                </p>
                <div className="progress-bar progress-bar-indeterminate" />
              </div>
            ) : testPhase === "listening" ? (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: "var(--danger)", boxShadow: "0 0 6px var(--danger)",
                    animation: "pulse 1.2s ease-in-out infinite",
                  }} />
                  <strong style={{ fontSize: 14 }}>Speak now</strong>
                  {testCountdown !== null && (
                    <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", color: "var(--text-muted)" }}>
                      {testCountdown}s
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Say a sentence — the test ends as soon as a transcript arrives.
                </p>
              </div>
            ) : (
              <>
                <button className="btn btn-primary" onClick={runTest} disabled={testPhase !== "idle"}>
                  Start test
                </button>
                {testError && (
                  <p style={{ marginTop: 12, fontSize: 13, color: "var(--danger)" }}>{testError}</p>
                )}
              </>
            )}
            <div className="onboarding-actions">
              <button
                className="btn btn-ghost"
                onClick={() => { setTestDone(true); next(); }}
                disabled={testPhase !== "idle" && !testDone}
              >
                Skip
              </button>
              <button
                className="btn btn-primary"
                onClick={next}
                disabled={!testDone || testPhase !== "idle"}
              >
                Continue
              </button>
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
