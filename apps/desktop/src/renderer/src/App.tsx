import { useState, useEffect, useCallback } from "react";
import type { IpcEvent, Preferences } from "@notetaker/core";
import type { TranscriptSegment, Session, SessionMeta } from "@notetaker/core";
import { api } from "./desktop";
import { Sidebar } from "./components/Sidebar";
import { SessionView } from "./pages/SessionView";
import { ReviewView } from "./pages/ReviewView";
import { SettingsView, type DetectedApp } from "./pages/SettingsView";
import { OnboardingView } from "./onboarding/OnboardingView";
import { SearchView } from "./pages/SearchView";
import { ErrorToasts, type ErrorToastItem } from "./components/ErrorToasts";

type Page = "session" | "review" | "settings" | "onboarding" | "search";

function formatBytesPerSecond(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kB/s`;
  return `${Math.round(bps)} B/s`;
}

export function App() {
  const [page, setPage] = useState<Page>("session");
  const [listening, setListening] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [detectedApps, setDetectedApps] = useState<DetectedApp[]>([]);
  const [appVersion, setAppVersion] = useState<string>("");
  const liveTranscript = prefs?.liveTranscript ?? true;
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [reviewSession, setReviewSession] = useState<Session | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [errors, setErrors] = useState<ErrorToastItem[]>([]);
  const [modelsReady, setModelsReady] = useState(true);
  const [updateState, setUpdateState] = useState<
    | { phase: "idle" }
    | { phase: "available"; version: string }
    | { phase: "downloading"; version?: string; percent: number; bytesPerSecond: number }
    | { phase: "downloaded"; version: string }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  useEffect(() => {
    void (async () => {
      const { enabled } = await api().invoke("listening:get");
      setListening(enabled);
      const loadedPrefs = await api().invoke("preferences:get");
      setPrefs(loadedPrefs);
      const models = await api().invoke("models:status");
      const requiredMissing = models.some((m) => m.required && !m.installed);
      setModelsReady(!requiredMissing);
      if (!loadedPrefs.onboardingCompleted || requiredMissing) {
        setShowOnboarding(true);
        setPage("onboarding");
      }
      const active = await api().invoke("sessions:getActive");
      setActiveSession(active);
      const list = await api().invoke("sessions:list", { limit: 50 });
      setSessions(list);
      // Settings-only data — fetched once, cached for the lifetime of the app.
      const [detected, version] = await Promise.all([
        api().invoke("apps:detected"),
        api().invoke("system:appVersion"),
      ]);
      setDetectedApps(detected);
      setAppVersion(version);
    })();

    const unsub = api().on((evt: IpcEvent) => {
      switch (evt.type) {
        case "listening:changed":
          setListening(evt.payload.enabled);
          break;
        case "session:opened":
          setActiveSession(evt.payload);
          setSegments([]);
          break;
        case "session:closed":
          setActiveSession(null);
          setSegments([]);
          void api().invoke("sessions:list", { limit: 50 }).then(setSessions);
          break;
        case "session:discarded":
          setActiveSession(null);
          setSegments([]);
          break;
        case "transcript:segment":
          setSegments((prev) => [...prev, evt.payload]);
          break;
        case "summary:ready":
          void api().invoke("sessions:get", evt.payload.sessionId).then((s) => {
            if (s) {
              setReviewSession(s);
              setPage("review");
            }
          });
          break;
        case "error":
          setErrors((prev) => {
            // De-dupe identical (where + message) — recurring engine errors
            // shouldn't stack into a wall of toasts.
            if (prev.some((e) => e.where === evt.payload.where && e.message === evt.payload.message)) {
              return prev;
            }
            return [
              ...prev,
              {
                id: Date.now() + Math.floor(Math.random() * 1000),
                where: evt.payload.where,
                message: evt.payload.message,
                ts: Date.now(),
              },
            ];
          });
          break;
        case "preferences:changed":
          setPrefs(evt.payload);
          break;
        case "navigate":
          if (evt.payload.hash === "#/settings") setPage("settings");
          break;
        case "update:available":
          setUpdateState({ phase: "available", version: evt.payload.version });
          break;
        case "update:progress":
          setUpdateState((prev) => ({
            phase: "downloading",
            version: prev.phase === "available" || prev.phase === "downloading" ? prev.version : undefined,
            percent: evt.payload.percent,
            bytesPerSecond: evt.payload.bytesPerSecond,
          }));
          break;
        case "update:downloaded":
          setUpdateState({ phase: "downloaded", version: evt.payload.version });
          break;
        case "update:error":
          setUpdateState({ phase: "error", message: evt.payload.message });
          break;
      }
    });

    return unsub;
  }, []);

  const handleToggleListening = useCallback(async () => {
    const { enabled } = await api().invoke("listening:toggle");
    setListening(enabled);
  }, []);

  const handleOpenSession = useCallback(async (id: string) => {
    const sess = await api().invoke("sessions:get", id);
    if (sess) {
      setReviewSession(sess);
      setPage("review");
    }
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    await api().invoke("sessions:delete", id);
    const list = await api().invoke("sessions:list", { limit: 50 });
    setSessions(list);
    setReviewSession((prev) => (prev?.id === id ? null : prev));
    setPage((prev) => (prev === "review" && reviewSession?.id === id ? "session" : prev));
  }, [reviewSession?.id]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    setPage("session");
    void api()
      .invoke("models:requiredReady")
      .then((res) => setModelsReady(res.ready));
  }, []);

  const handleRunSetup = useCallback(() => {
    setShowOnboarding(true);
    setPage("onboarding");
    void api().invoke("window:show");
  }, []);

  if (page === "onboarding" || showOnboarding) {
    return (
      <div className="app-shell app-shell--onboarding">
        <OnboardingView onComplete={handleOnboardingComplete} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!modelsReady && (
        <div className="error-banner">
          <span>Speech models are not installed — transcription is disabled.</span>
          <button type="button" className="btn btn-primary" onClick={handleRunSetup}>
            Download models
          </button>
        </div>
      )}
      <ErrorToasts
        errors={errors}
        appVersion={appVersion}
        onDismiss={(id) => setErrors((prev) => prev.filter((e) => e.id !== id))}
      />
      {updateState.phase !== "idle" && (
        <div className="update-toast" role="status">
          {updateState.phase === "available" && (
            <>
              <div className="update-toast-main">
                <span className="update-toast-title">Update {updateState.version} available</span>
                <span className="update-toast-sub">Downloading in the background…</span>
              </div>
              <div className="update-toast-progress update-toast-progress-indeterminate" />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setUpdateState({ phase: "idle" })}
                aria-label="Dismiss update notice"
              >
                ×
              </button>
            </>
          )}
          {updateState.phase === "downloading" && (
            <>
              <div className="update-toast-main">
                <span className="update-toast-title">
                  Downloading update{updateState.version ? ` ${updateState.version}` : ""}
                </span>
                <span className="update-toast-sub">
                  {Math.round(updateState.percent)}%
                  {updateState.bytesPerSecond > 0
                    ? ` · ${formatBytesPerSecond(updateState.bytesPerSecond)}`
                    : ""}
                </span>
              </div>
              <div className="update-toast-progress">
                <div
                  className="update-toast-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, updateState.percent))}%` }}
                />
              </div>
            </>
          )}
          {updateState.phase === "downloaded" && (
            <>
              <span>Version {updateState.version} is ready to install.</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void api().invoke("update:install")}
              >
                Restart &amp; update
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setUpdateState({ phase: "idle" })}
              >
                Later
              </button>
            </>
          )}
          {updateState.phase === "error" && (
            <>
              <div className="update-toast-main">
                <span className="update-toast-title">Update failed</span>
                <span className="update-toast-sub">{updateState.message}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setUpdateState({ phase: "idle" })}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
      <div className="app-layout">
      <Sidebar
        listening={listening}
        onToggleListening={handleToggleListening}
        page={page}
        onNavigate={setPage}
        sessions={sessions}
        onOpenSession={handleOpenSession}
        onDeleteSession={handleDeleteSession}
      />
      <main className={`main-content${page === "session" ? " is-stage" : ""}`}>
        {page === "session" && (
          <SessionView
            session={activeSession}
            segments={segments}
            listening={listening}
            showLiveTranscript={liveTranscript}
            onNotesChange={(notes) => {
              if (activeSession) {
                void api().invoke("sessions:updateNotes", { id: activeSession.id, notes });
              }
            }}
            onSessionEnded={() => setActiveSession(null)}
          />
        )}
        {page === "review" && reviewSession && (
          <ReviewView
            session={reviewSession}
            onBack={() => setPage("session")}
            onRenameSpeaker={(speakerId, label) => {
              void api().invoke("sessions:renameSpeaker", {
                sessionId: reviewSession.id,
                speakerId,
                label,
              });
            }}
            onDelete={() => handleDeleteSession(reviewSession.id)}
          />
        )}
        {page === "settings" && prefs && (
          <SettingsView
            prefs={prefs}
            apps={detectedApps}
            appVersion={appVersion}
            onPrefsChange={setPrefs}
            onRunSetup={handleRunSetup}
          />
        )}
        {page === "search" && <SearchView onOpenSession={handleOpenSession} />}
      </main>
      </div>
    </div>
  );
}
