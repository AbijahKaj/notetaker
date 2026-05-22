import { app } from "electron";
import { createLogger } from "@notetaker/core";

const log = createLogger("launch-at-login");

export function applyLaunchAtLogin(enabled: boolean): void {
  if (process.platform !== "darwin") return;

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      name: app.getName(),
    });
    log.info("launch at login updated", { enabled });
  } catch (err) {
    log.warn("launch at login failed", { err: String(err) });
  }
}
