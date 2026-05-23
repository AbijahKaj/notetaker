import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  systemPreferences,
  crashReporter,
  globalShortcut,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { createLogger, type Preferences, type Session } from "@notetaker/core";
import type { IpcEvent, IpcInvokeMap } from "@notetaker/core";
import { ExportService } from "@notetaker/storage";
import { PreferencesService } from "./services/PreferencesService.js";
import { StorageService } from "./services/StorageService.js";
import { AudioIngestService } from "./services/AudioIngestService.js";
import { AudioPersistenceService } from "./services/AudioPersistenceService.js";
import { SpeechService } from "./services/SpeechService.js";
import { SessionsService } from "./services/SessionsService.js";
import { SummarizationService } from "./services/SummarizationService.js";
import { ModelManager } from "./services/ModelManager.js";
import { LlmKeyService } from "./services/LlmKeyService.js";
import { AppWatcherService } from "./services/AppWatcherService.js";
import { PermissionsService } from "./services/PermissionsService.js";
import { applyLaunchAtLogin } from "./services/LaunchAtLoginService.js";
import { AutoUpdateService } from "./services/AutoUpdateService.js";
import { performUninstall } from "./services/UninstallService.js";

crashReporter.start({
  productName: "NoteTaker",
  companyName: "NoteTaker",
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
});

const log = createLogger("main");
const __dirname = dirname(fileURLToPath(import.meta.url));
const GITHUB_REPO = "AbijahKaj/notetaker";

let currentToggleShortcut: string | null = null;

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let keepWindowVisible = false;
let reshowTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;

class Application {
  prefs!: PreferencesService;
  storage!: StorageService;
  audio!: AudioIngestService;
  audioPersist!: AudioPersistenceService;
  speech!: SpeechService;
  sessions!: SessionsService;
  summarizer!: SummarizationService;
  models!: ModelManager;
  llmKeys!: LlmKeyService;
  appWatcher!: AppWatcherService;
  permissions!: PermissionsService;
  autoUpdate!: AutoUpdateService;

  async init(): Promise<void> {
    const userDataDir = app.getPath("userData");
    this.llmKeys = new LlmKeyService();
    this.models = new ModelManager(userDataDir);
    this.prefs = new PreferencesService(userDataDir);
    await this.prefs.load();

    this.storage = new StorageService(userDataDir);
    this.storage.setKeyService(this.llmKeys, this.prefs);
    await this.storage.init();

    this.audio = new AudioIngestService();
    this.audioPersist = new AudioPersistenceService(userDataDir);
    this.audioPersist.setEnabled(this.prefs.get().persistAudio);
    this.speech = new SpeechService(this.models);
    this.sessions = new SessionsService(this.storage, this.prefs, this.speech);
    this.summarizer = new SummarizationService(this.llmKeys, this.prefs, this.models);

    this.appWatcher = new AppWatcherService(this.prefs);
    this.permissions = new PermissionsService();

    this.autoUpdate = new AutoUpdateService();
    this.autoUpdate.on("update:available", (payload) =>
      sendEvent({ type: "update:available", payload }),
    );
    this.autoUpdate.on("update:progress", (payload) =>
      sendEvent({ type: "update:progress", payload }),
    );
    this.autoUpdate.on("update:downloaded", (payload) =>
      sendEvent({ type: "update:downloaded", payload }),
    );
    this.autoUpdate.on("update:error", (payload) =>
      sendEvent({ type: "update:error", payload }),
    );

    this.wirePipeline();
    this.wireIpc();

    applyLaunchAtLogin(this.prefs.get().launchAtLogin);
    registerToggleShortcut(this.prefs.get().globalShortcutToggleListening, () => {
      void application.toggleListening();
    });
    this.autoUpdate.start();

    if (this.prefs.get().listeningEnabled) {
      if (this.models.hasAllRequired()) {
        try {
          await this.enableListening();
        } catch (err) {
          log.warn("auto-enable listening failed", { err: String(err) });
          await this.prefs.update({ listeningEnabled: false });
          refreshTrayMenu(false);
        }
      } else {
        // Models were removed (or never finished installing) on a previous run.
        // Don't auto-start; let the user re-run setup so they get clear feedback.
        log.warn("not auto-enabling listening: required models missing");
        await this.prefs.update({ listeningEnabled: false });
        refreshTrayMenu(false);
      }
    } else {
      refreshTrayMenu(false);
    }
  }

  private wirePipeline(): void {
    this.audio.on("audio:frame", (frame) => {
      if (frame.sourceSpec.kind === "mic" && frame.pcm.length > 0) {
        let sum = 0;
        for (const s of frame.pcm) sum += s * s;
        const rms = Math.sqrt(sum / frame.pcm.length);
        sendEvent({ type: "audio:level", payload: { sourceId: frame.sourceId, rms } });
      }

      if (this.prefs.get().persistAudio && this.prefs.get().listeningEnabled) {
        this.audioPersist.writeFrame(frame);
      }

      if (this.prefs.get().listeningEnabled) {
        this.speech.feed(frame);
      }
    });

    this.audio.on("sidecar:crashed", () => {
      sendEvent({
        type: "error",
        payload: {
          where: "audio-sidecar",
          message: "Audio sidecar restarted after an unexpected exit.",
        },
      });
    });

    this.speech.on("transcript:segment", async (seg) => {
      const enriched = await this.sessions.absorbSegment(seg);
      if (!enriched) return;
      log.info("transcript segment", { text: enriched.text.slice(0, 120) });
      sendEvent({ type: "transcript:segment", payload: enriched });
    });

    this.speech.on("error", (ev) => {
      const message = ev.error instanceof Error ? ev.error.message : String(ev.error);
      log.warn("speech error", { where: ev.where, message });
      sendEvent({ type: "error", payload: { where: ev.where, message } });
    });

    this.sessions.on("session:opened", (sess) => {
      this.speech.setSessionId(sess.id);
      this.audioPersist.setSessionId(sess.id);
      refreshTrayMenu(this.prefs.get().listeningEnabled);
      sendEvent({ type: "session:opened", payload: sess });
    });

    this.sessions.on("session:closed", async (sess) => {
      this.audioPersist.setSessionId(null);
      refreshTrayMenu(this.prefs.get().listeningEnabled);
      sendEvent({ type: "session:closed", payload: sess });
      try {
        const summary = await this.summarizer.summarize(sess);
        await this.sessions.attachSummary(sess.id, summary);
        sendEvent({ type: "summary:ready", payload: { sessionId: sess.id, summary } });
      } catch (err) {
        log.error("auto summarize failed", { err: String(err) });
        sendEvent({ type: "error", payload: { where: "summarize", message: String(err) } });
      }
    });

    this.sessions.on("session:discarded", ({ id }) => {
      this.audioPersist.setSessionId(null);
      refreshTrayMenu(this.prefs.get().listeningEnabled);
      sendEvent({ type: "session:discarded", payload: { id } });
    });

    this.appWatcher.on("activate", async (bundleId, name) => {
      if (!this.prefs.get().listeningEnabled) return;
      await this.audio.addAppSource({ bundleId });
      log.info("watched app running", { bundleId, name });
    });
    this.appWatcher.on("deactivate", async (bundleId) => {
      await this.audio.removeAppSource({ bundleId });
    });
    this.appWatcher.on("browserActivate", async (bundleId, matchedSite, name) => {
      if (!this.prefs.get().listeningEnabled) return;
      await this.audio.addBrowserSource({ bundleId, matchedSite });
      log.info("browser meeting tab active", { bundleId, matchedSite, name });
    });
    this.appWatcher.on("browserDeactivate", async (bundleId) => {
      await this.audio.removeBrowserSource({ bundleId });
    });
  }

  private async requestMicPermission(): Promise<boolean> {
    if (process.platform !== "darwin") return true;

    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    if (micStatus === "granted") return true;

    const granted = await systemPreferences.askForMediaAccess("microphone");
    if (!granted) {
      sendEvent({
        type: "error",
        payload: {
          where: "microphone",
          message: "Microphone access is required. Enable it in System Settings → Privacy & Security → Microphone.",
        },
      });
    }
    return granted;
  }

  /** Acquire mic permission (if needed) and start capturing. */
  async startMicCapture(): Promise<void> {
    const granted = await this.requestMicPermission();
    if (!granted) return;
    await this.audio.ensureMicCapture();
  }

  private startWatchers(): void {
    if (this.prefs.get().automationGranted) {
      this.appWatcher.start();
    }
  }

  private stopWatchers(): void {
    this.appWatcher.stop();
  }

  private async enableListening(): Promise<void> {
    const missing = this.models.missingRequired();
    if (missing.length > 0) {
      sendEvent({
        type: "error",
        payload: {
          where: "models",
          message:
            "Speech models are not installed. Open Settings → Run setup again to download them.",
        },
      });
      log.warn("listening blocked: required models missing", { missing });
      throw new Error(`Required models missing: ${missing.join(", ")}`);
    }

    this.audio.setListeningActive(true);
    await this.startMicCapture();

    const listenStartedAt = Date.now();
    this.sessions.beginListeningSession(listenStartedAt);

    await this.speech.start();
    this.speech.setTimelineOrigin(listenStartedAt);
    this.startWatchers();

    if (!this.speech.isSttReady()) {
      const reason = this.speech.getNotReadyReason();
      sendEvent({
        type: "error",
        payload: {
          where: "stt",
          message: reason
            ? `Speech recognition couldn't initialize: ${reason}`
            : "Speech recognition couldn't initialize. Try Run setup again or Reveal crash logs.",
        },
      });
    }

    refreshTrayMenu(true);
    sendEvent({ type: "listening:changed", payload: { enabled: true } });
  }

  private async disableListening(): Promise<void> {
    this.stopWatchers();
    await this.audio.removeAllMeetingSources();
    this.audio.setListeningActive(false);
    await this.audio.releaseMicIfIdle();
    await this.speech.stop();
    await this.sessions.closeActive();
    this.audioPersist.setSessionId(null);
    refreshTrayMenu(false);
    sendEvent({ type: "listening:changed", payload: { enabled: false } });
  }

  async toggleListening(): Promise<boolean> {
    const next = !this.prefs.get().listeningEnabled;
    if (next) {
      try {
        await this.enableListening();
      } catch (err) {
        log.warn("enable listening failed", { err: String(err) });
        // Stay paused; surface the underlying error to the renderer.
        await this.prefs.update({ listeningEnabled: false });
        refreshTrayMenu(false);
        return false;
      }
    } else {
      await this.disableListening();
    }
    await this.prefs.update({ listeningEnabled: next });
    return next;
  }

  async endActiveSession(): Promise<Session | null> {
    return this.sessions.closeActive();
  }

  private wireIpc(): void {
    handle<"preferences:get">("preferences:get", () => this.prefs.get());
    handle<"preferences:set">("preferences:set", async (patch) => {
      const prev = this.prefs.get();
      const next = await this.prefs.update(patch);

      if (patch.encryptDb !== undefined && patch.encryptDb !== prev.encryptDb) {
        try {
          await this.storage.reconfigureEncryption();
        } catch (err) {
          await this.prefs.update({ encryptDb: prev.encryptDb });
          throw new Error(`Database encryption change failed: ${String(err)}`);
        }
      }

      if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== prev.launchAtLogin) {
        applyLaunchAtLogin(patch.launchAtLogin);
      }

      if (patch.persistAudio !== undefined) {
        this.audioPersist.setEnabled(patch.persistAudio);
      }

      if (patch.automationGranted && this.prefs.get().listeningEnabled) {
        this.appWatcher.start();
      }

      if (patch.appWhitelist || patch.siteWhitelist) {
        this.appWatcher.refreshWhitelist();
      }

      if (
        patch.globalShortcutToggleListening !== undefined &&
        patch.globalShortcutToggleListening !== prev.globalShortcutToggleListening
      ) {
        registerToggleShortcut(next.globalShortcutToggleListening, () => {
          void application.toggleListening();
        });
      }

      sendEvent({ type: "preferences:changed", payload: next });
      return next;
    });

    handle<"permissions:check">("permissions:check", () => this.permissions.check());
    handle<"permissions:request">("permissions:request", async (kind) => {
      if (kind === "systemAudio") {
        const probe = await this.audio.probeSystemAudioCapture();
        if (!probe.ok) {
          log.warn("system audio probe", { message: probe.message });
          sendEvent({
            type: "error",
            payload: {
              where: "systemAudio",
              message: probe.message
                ? `Couldn't register for system audio: ${probe.message}`
                : "Couldn't register for system audio. Try rebuilding the sidecar with: pnpm sidecar:build",
            },
          });
        }
        await this.permissions.openSystemAudioSettings();
        return probe.ok;
      }
      return this.permissions.request(kind);
    });

    handle<"micPreview:start">("micPreview:start", async () => {
      await this.audio.startMicPreview();
    });
    handle<"micPreview:stop">("micPreview:stop", async () => {
      await this.audio.stopMicPreview();
    });

    handle<"listening:toggle">("listening:toggle", async () => ({ enabled: await this.toggleListening() }));
    handle<"listening:get">("listening:get", () => ({ enabled: this.prefs.get().listeningEnabled }));

    handle<"sessions:list">("sessions:list", ({ limit = 100, offset = 0 }) => this.sessions.list(limit, offset));
    handle<"sessions:get">("sessions:get", (id) => this.sessions.get(id));
    handle<"sessions:search">("sessions:search", (q) => this.sessions.search(q));
    handle<"sessions:updateNotes">("sessions:updateNotes", ({ id, notes }) => this.sessions.updateNotes(id, notes));
    handle<"sessions:renameSpeaker">("sessions:renameSpeaker", ({ sessionId, speakerId, label }) =>
      this.sessions.renameSpeaker(sessionId, speakerId, label),
    );
    handle<"sessions:delete">("sessions:delete", (id) => this.sessions.delete(id));
    handle<"sessions:endActive">("sessions:endActive", () => this.endActiveSession());
    handle<"sessions:getActive">("sessions:getActive", () => {
      const id = this.sessions.getActiveSessionId();
      return id ? this.sessions.get(id) : null;
    });

    handle<"summarize:run">("summarize:run", async (sessionId) => {
      const sess = this.sessions.get(sessionId);
      if (!sess) throw new Error(`Session ${sessionId} not found`);
      const summary = await this.summarizer.summarize(sess);
      await this.sessions.attachSummary(sessionId, summary);
      return summary;
    });

    handle<"llm:setKey">("llm:setKey", async ({ provider, apiKey }) => {
      try {
        await this.llmKeys.set(provider, apiKey);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });
    handle<"llm:hasKey">("llm:hasKey", async (provider) => this.llmKeys.has(provider));
    handle<"llm:test">("llm:test", async (provider) => this.summarizer.test(provider));

    handle<"models:status">("models:status", () => this.models.statusAll());
    handle<"models:download">("models:download", async (id) => {
      try {
        await this.models.download(id, (ev) => {
          sendEvent({ type: "models:download:progress", payload: ev });
        });
        return { ok: true as const };
      } catch (err) {
        log.error("model download failed", { id, err: String(err) });
        throw err;
      }
    });
    handle<"models:requiredReady">("models:requiredReady", () => {
      const missing = this.models.missingRequired();
      return { ready: missing.length === 0, missing };
    });

    handle<"apps:detected">("apps:detected", async () => this.appWatcher.detectAll());

    const exporter = new ExportService();
    handle<"export:markdown">("export:markdown", (sessionId) => {
      const sess = this.sessions.get(sessionId);
      if (!sess) throw new Error(`Session ${sessionId} not found`);
      return exporter.toMarkdown(sess);
    });
    handle<"export:json">("export:json", (sessionId) => {
      const sess = this.sessions.get(sessionId);
      if (!sess) throw new Error(`Session ${sessionId} not found`);
      return exporter.toJson(sess);
    });
    handle<"export:srt">("export:srt", (sessionId) => {
      const sess = this.sessions.get(sessionId);
      if (!sess) throw new Error(`Session ${sessionId} not found`);
      return exporter.toSrt(sess);
    });

    handle<"system:openExternal">("system:openExternal", (url) => {
      shell.openExternal(url);
    });
    handle<"system:quit">("system:quit", () => {
      quitApp();
    });
    handle<"system:revealCrashLogs">("system:revealCrashLogs", () => {
      const dir = app.getPath("crashDumps");
      void shell.openPath(dir);
    });
    handle<"system:openGithubIssue">("system:openGithubIssue", () => {
      const body = [
        "<!-- Thanks for reporting a bug! Please fill in below. -->",
        "",
        "**Version:** " + app.getVersion(),
        "**OS:** macOS " + release(),
        "",
        "## What happened",
        "",
        "## Steps to reproduce",
        "1. ",
        "2. ",
        "",
        "## Crash logs",
        "If the app crashed, click \"Reveal crash logs\" in Settings and attach the most recent file here.",
        "",
      ].join("\n");
      const url =
        "https://github.com/" +
        GITHUB_REPO +
        "/issues/new?labels=bug&title=" +
        encodeURIComponent("[bug] ") +
        "&body=" +
        encodeURIComponent(body);
      void shell.openExternal(url);
    });
    handle<"system:appVersion">("system:appVersion", () => app.getVersion());
    handle<"system:uninstall">("system:uninstall", async (opts) => {
      log.warn("uninstall requested", { opts });
      try {
        // Stop everything that might hold file locks before we wipe the dir.
        this.autoUpdate?.stop();
        await this.sessions?.closeActive().catch(() => {});
        await this.disableListening().catch(() => {});
        await this.audio?.shutdown().catch(() => {});
        this.storage?.close?.();
      } catch (err) {
        log.warn("uninstall: shutdown step failed", { err: String(err) });
      }

      const result = await performUninstall(opts ?? {});

      // Schedule a hard quit after the renderer receives the response.
      setTimeout(() => {
        try {
          globalShortcut.unregisterAll();
        } catch {}
        isQuitting = true;
        app.exit(0);
      }, 250);

      return result;
    });
    handle<"window:show">("window:show", () => {
      showMainWindow();
    });
    handle<"window:setKeepVisible">("window:setKeepVisible", (keep) => {
      setKeepWindowVisible(keep);
    });
    handle<"update:check">("update:check", () => this.autoUpdate.check());
    handle<"update:install">("update:install", () => {
      this.autoUpdate.install();
    });
  }
}

const application = new Application();

function handle<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (...args: Parameters<IpcInvokeMap[K]>) => ReturnType<IpcInvokeMap[K]> | Promise<ReturnType<IpcInvokeMap[K]>>,
): void {
  ipcMain.handle(channel as string, async (_evt, ...args) => {
    try {
      return await handler(...(args as Parameters<IpcInvokeMap[K]>));
    } catch (err) {
      log.error(`ipc handler error ${String(channel)}`, { err: String(err) });
      throw err;
    }
  });
}

function sendEvent(evt: IpcEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send("event", evt);
  }
}

function registerToggleShortcut(accelerator: string, handler: () => void): void {
  if (currentToggleShortcut) {
    try {
      globalShortcut.unregister(currentToggleShortcut);
    } catch (err) {
      log.warn("globalShortcut.unregister failed", { err: String(err) });
    }
    currentToggleShortcut = null;
  }
  if (!accelerator) return;
  if (!app.isReady()) {
    app.whenReady().then(() => registerToggleShortcut(accelerator, handler));
    return;
  }
  try {
    const ok = globalShortcut.register(accelerator, handler);
    if (ok) {
      currentToggleShortcut = accelerator;
      log.info("global shortcut registered", { accelerator });
    } else {
      log.warn("global shortcut already taken by another app", { accelerator });
    }
  } catch (err) {
    log.warn("globalShortcut.register failed", { accelerator, err: String(err) });
  }
}

function refreshTrayMenu(listening: boolean): void {
  if (!tray) return;
  const hasActive = !!application.sessions.getActiveSessionId();
  const menu = Menu.buildFromTemplate([
    { label: listening ? "Pause listening" : "Start listening", click: () => application.toggleListening() },
    ...(hasActive
      ? [{ label: "End current session", click: () => application.endActiveSession() } as Electron.MenuItemConstructorOptions]
      : []),
    { type: "separator" },
    { label: "Open NoteTaker…", click: () => showMainWindow() },
    { label: "Settings…", click: () => showMainWindow("#/settings") },
    { type: "separator" },
    { label: "Quit", click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(listening ? "NoteTaker — listening" : "NoteTaker — paused");
  const dot = listening ? "●" : "○";
  tray.setTitle(dot);
}

function createTray(): void {
  const iconPath = join(__dirname, "../../resources/icon.png");
  const image = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setTitle("○");
  refreshTrayMenu(application.prefs?.get().listeningEnabled ?? false);
}

function quitApp(): void {
  isQuitting = true;
  setKeepWindowVisible(false);
  app.quit();
}

function setKeepWindowVisible(keep: boolean): void {
  keepWindowVisible = keep;
  if (!keep && reshowTimer) {
    clearTimeout(reshowTimer);
    reshowTimer = null;
  }
}

function scheduleReshowWindow(): void {
  if (!keepWindowVisible || !mainWindow || mainWindow.isDestroyed()) return;
  if (reshowTimer) clearTimeout(reshowTimer);
  reshowTimer = setTimeout(() => {
    reshowTimer = null;
    if (keepWindowVisible && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 600);
}

function showMainWindow(hash?: string): void {
  if (!mainWindow) {
    createMainWindow();
  }
  if (hash) {
    mainWindow?.webContents.send("event", { type: "navigate", payload: { hash } });
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function resolvePreload(): string {
  const candidates = [
    join(__dirname, "../preload/index.mjs"),
    join(__dirname, "../preload/index.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    show: false,
    title: "",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f0f10",
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  mainWindow.on("close", (e) => {
    if (!mainWindow) return;
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("blur", () => {
    if (keepWindowVisible) scheduleReshowWindow();
  });

  mainWindow.on("hide", () => {
    if (keepWindowVisible) scheduleReshowWindow();
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  if (process.platform !== "darwin") {
    log.warn("This app targets macOS; other platforms are unsupported.");
  }

  if (process.platform === "darwin" && app.dock) app.dock.hide();

  await application.init();
  createTray();
  createMainWindow();

  if (isDev) {
    app.setName("NoteTaker");
    if (app.dock) app.dock.show();
    showMainWindow();
    mainWindow?.webContents.openDevTools({ mode: "detach" });
  } else if (!application.prefs.get().onboardingCompleted) {
    setKeepWindowVisible(true);
    showMainWindow();
  }

  app.on("activate", () => {
    if (isQuitting) return;
    if (keepWindowVisible) showMainWindow();
    else if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray
});

app.on("before-quit", () => {
  isQuitting = true;
  setKeepWindowVisible(false);
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    log.warn("globalShortcut.unregisterAll failed", { err: String(err) });
  }
  application.autoUpdate?.stop();
  void application.sessions?.closeActive().catch(() => {});
  void application.audio?.shutdown().catch(() => {});
});

export type { Preferences };
