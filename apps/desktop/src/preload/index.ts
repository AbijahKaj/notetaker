import { contextBridge, ipcRenderer } from "electron";
import type { IpcEvent, IpcInvokeMap } from "@notetaker/core";

type InvokeArgs<K extends keyof IpcInvokeMap> = Parameters<IpcInvokeMap[K]>;
type InvokeResult<K extends keyof IpcInvokeMap> = ReturnType<IpcInvokeMap[K]>;

const api = {
  invoke<K extends keyof IpcInvokeMap>(channel: K, ...args: InvokeArgs<K>): Promise<InvokeResult<K>> {
    return ipcRenderer.invoke(channel as string, ...args) as Promise<InvokeResult<K>>;
  },
  on(listener: (evt: IpcEvent) => void): () => void {
    const handler = (_: unknown, evt: IpcEvent) => listener(evt);
    ipcRenderer.on("event", handler);
    return () => ipcRenderer.off("event", handler);
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld("desktop", api);
