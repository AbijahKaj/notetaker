import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createLogger, type Preferences, type Session } from "@notetaker/core";
import type { IpcEvent, IpcInvokeMap } from "@notetaker/core";
import { ExportService } from "@notetaker/storage";
import { PreferencesService } from "./services/PreferencesService.js";
import { StorageService } from "./services/StorageService.js";
import { AudioIngestService } from "./services/AudioIngestService.js";
import { SpeechService } from "./services/SpeechService.js";
import { SessionsService } from "./services/SessionsService.js";
import { SummarizationService } from "./services/SummarizationService.js";
import { ModelManager } from "./services/ModelManager.js";
import { LlmKeyService } from "./services/LlmKeyService.js";
import { AppWatcherService } from "./services/AppWatcherService.js";
import { TabPollerService } from "./services/TabPollerService.js";
import { PermissionsService } from "./services/PermissionsService.js";

const log = createLogger("main");
const __dirname = dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let keepWindowVisible = false;
let reshowTimer: ReturnType<typeof setTimeout> | null = null;

const isDev = !app.isPackaged;

class Application {
  prefs!: PreferencesService;
  storage!: StorageService;
  audio!: AudioIngestService;
  speech!: SpeechService;
  sessions!: SessionsService;
  summarizer!: SummarizationService;
  models!: ModelManager;
  llmKeys!: LlmKeyService;
  appWatcher!: AppWatcherService;
  tabPoller!: TabPollerService;
  permissions!: PermissionsService;

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
    this.speech = new SpeechService(this.models);
    this.sessions = new SessionsService(this.storage, this.prefs, this.speech);
    this.summarizer = new SummarizationService(this.llmKeys, this.prefs, this.models);

    this.appWatcher = new AppWatcherService(this.prefs);
    this.tabPoller = new TabPollerService(this.prefs);
    this.permissions = new PermissionsService();

    this.wirePipeline();
    this.wireIpc();

    if (this.prefs.get().listeningEnabled) {
      await this.enableListening();
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
      if (this.prefs.get().listeningEnabled) {
        this.speech.feed(frame);
      }
    });
    this.audio.on("audio:source:added", ({ sourceId }) => {
      log.info("audio source added", { sourceId });
    });
    this.audio.on("audio:source:removed", ({ sourceId }) => {
      log.info("audio source removed", { sourceId });
    });

    this.speech.on("transcript:segment", async (seg) => {
      const enriched = await this.sessions.absorbSegment(seg);
      sendEvent({ type: "transcript:segment", payload: enriched });
    });

    this.sessions.on("session:opened", (sess) => {
      this.speech.setSessionId(sess.id);
      refreshTrayMenu(this.prefs.get().listeningEnabled);
      sendEvent({ type: "session:opened", payload: sess });
    });

    this.sessions.on("session:closed", async (sess) => {
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

    this.appWatcher.on("activate", async (bundleId, name) => {
      await this.audio.addAppSource({ bundleId });
      log.info("app activated", { bundleId, name });
    });
    this.appWatcher.on("deactivate", async (bundleId) => {
      await this.audio.removeAppSource({ bundleId });
    });

    this.tabPoller.on("activate", async ({ bundleId, matchedSite }) => {
      await this.audio.addBrowserSource({ bundleId, matchedSite });
    });
    this.tabPoller.on("deactivate", async ({ bundleId }) => {
      await this.audio.removeBrowserSource({ bundleId });
    });
  }

  private async enableListening(): Promise<void> {
    await this.audio.start();
    await this.speech.start();
    await this.audio.addMicSource();
    if (this.prefs.get().automationGranted) {
      this.appWatcher.start();
      this.tabPoller.start();
    }
    refreshTrayMenu(true);
    sendEvent({ type: "listening:changed", payload: { enabled: true } });
  }

  private async disableListening(): Promise<void> {
    this.tabPoller.stop();
    this.appWatcher.stop();
    await this.audio.stop();
    await this.speech.stop();
    await this.sessions.closeActive();
    refreshTrayMenu(false);
    sendEvent({ type: "listening:changed", payload: { enabled: false } });
  }

  async toggleListening(): Promise<boolean> {
    const next = !this.prefs.get().listeningEnabled;
    if (next) await this.enableListening();
    else await this.disableListening();
    await this.prefs.update({ listeningEnabled: next });
    return next;
  }

  async endActiveSession(): Promise<Session | null> {
    return this.sessions.closeActive();
  }

  private wireIpc(): void {
    handle<"preferences:get">("preferences:get", () => this.prefs.get());
    handle<"preferences:set">("preferences:set", async (patch) => {
      const next = await this.prefs.update(patch);
      this.appWatcher.refreshWhitelist();
      this.tabPoller.refreshWhitelist();
      if (patch.automationGranted && this.prefs.get().listeningEnabled) {
        this.appWatcher.start();
        this.tabPoller.start();
      }
      return next;
    });

    handle<"permissions:check">("permissions:check", () => this.permissions.check());
    handle<"permissions:request">("permissions:request", async (kind) => this.permissions.request(kind));

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
      await this.models.download(id, (ev) => {
        sendEvent({ type: "models:download:progress", payload: ev });
      });
      return { ok: true };
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
      app.quit();
    });
    handle<"window:show">("window:show", () => {
      showMainWindow();
    });
    handle<"window:setKeepVisible">("window:setKeepVisible", (keep) => {
      setKeepWindowVisible(keep);
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
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(listening ? "NoteTaker — listening" : "NoteTaker — paused");
  const dot = listening ? "●" : "○";
  tray.setTitle(dot);
}

function createTray(): void {
  const image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setTitle("○");
  tray.on("click", () => {
    application.toggleListening();
  });
  refreshTrayMenu(false);
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
    mainWindow?.webContents.send("event", { type: "navigate", payload: { hash } } as unknown as IpcEvent);
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

  if (!application.prefs.get().onboardingCompleted) {
    setKeepWindowVisible(true);
    showMainWindow();
  }

  app.on("activate", () => {
    if (keepWindowVisible) showMainWindow();
    else if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray
});

app.on("before-quit", async () => {
  await application["sessions"]?.closeActive().catch(() => {});
});

export type { Preferences };
