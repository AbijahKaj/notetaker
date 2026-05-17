import type { IpcEvent, IpcInvokeMap } from "@notetaker/core";

export type DesktopApi = {
  invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    ...args: Parameters<IpcInvokeMap[K]>
  ): Promise<ReturnType<IpcInvokeMap[K]>>;
  on(listener: (evt: IpcEvent) => void): () => void;
};

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export function api(): DesktopApi {
  return window.desktop;
}
