import { useState, useEffect, useCallback } from "react";
import type { IpcEvent } from "@notetaker/core";
import type { TranscriptSegment, Session, SessionMeta } from "@notetaker/core";
import { api } from "./desktop";
import { Sidebar } from "./components/Sidebar";
import { SessionView } from "./pages/SessionView";
import { ReviewView } from "./pages/ReviewView";
import { SettingsView } from "./pages/SettingsView";
import { OnboardingView } from "./onboarding/OnboardingView";
import { SearchView } from "./pages/SearchView";

type Page = "session" | "review" | "settings" | "onboarding" | "search";

export function App() {
  const [page, setPage] = useState<Page>("session");
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(true);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [reviewSession, setReviewSession] = useState<Session | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState<{ version: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const { enabled } = await api().invoke("listening:get");
      setListening(enabled);
      const prefs = await api().invoke("preferences:get");
      setLiveTranscript(prefs.liveTranscript);
      const models = await api().invoke("models:status");
      const requiredMissing = models.some((m) => m.required && !m.installed);
      if (!prefs.onboardingCompleted || requiredMissing) {
        setShowOnboarding(true);
        setPage("onboarding");
      }
      const active = await api().invoke("sessions:getActive");
      setActiveSession(active);
      const list = await api().invoke("sessions:list", { limit: 50 });
      setSessions(list);
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
          setErrorBanner(evt.payload.message);
          break;
        case "preferences:changed":
          setLiveTranscript(evt.payload.liveTranscript);
          break;
        case "navigate":
          if (evt.payload.hash === "#/settings") setPage("settings");
          break;
        case "update:downloaded":
          setUpdateReady({ version: evt.payload.version });
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

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    setPage("session");
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
      {errorBanner && (
        <div className="error-banner">
          <span>{errorBanner}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setErrorBanner(null)}>Dismiss</button>
        </div>
      )}
      {updateReady && (
        <div className="update-toast" role="status">
          <span>Version {updateReady.version} is ready to install.</span>
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
            onClick={() => setUpdateReady(null)}
          >
            Later
          </button>
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
      />
      <main className="main-content">
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
          />
        )}
        {page === "settings" && <SettingsView onRunSetup={handleRunSetup} />}
        {page === "search" && <SearchView onOpenSession={handleOpenSession} />}
      </main>
      </div>
    </div>
  );
}
