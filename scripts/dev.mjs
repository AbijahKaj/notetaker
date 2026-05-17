import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "darwin") {
  const build = spawnSync("pnpm", ["sidecar:build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const dev = spawnSync("pnpm", ["--filter", "desktop", "dev"], { cwd: root, stdio: "inherit" });
process.exit(dev.status ?? 0);
