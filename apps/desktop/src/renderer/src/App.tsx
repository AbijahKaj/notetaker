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
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [reviewSession, setReviewSession] = useState<Session | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    void (async () => {
      const { enabled } = await api().invoke("listening:get");
      setListening(enabled);
      const prefs = await api().invoke("preferences:get");
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
  }, []);

  if (page === "onboarding" || showOnboarding) {
    return <OnboardingView onComplete={handleOnboardingComplete} />;
  }

  return (
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
  );
}
