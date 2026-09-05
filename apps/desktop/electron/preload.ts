import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type BridgeApi } from './ipc.js';
import type { GameEvent, Intent } from '@bombparty/engine';

/**
 * The only bridge between the sandboxed renderer and the main process.
 *
 * Three rules, and the whole security posture of the app rests on them:
 *
 *   1. `ipcRenderer` itself is never exposed — only the closed set of functions
 *      below. A compromised renderer cannot invoke an arbitrary channel.
 *   2. Nothing here takes a channel name from the caller.
 *   3. Listener registration returns an unsubscribe function and strips the
 *      Electron `IpcRendererEvent`, so renderer code never receives a `sender`
 *      it could use to reach back into the main process.
 */

const subscribe = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: unknown, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: BridgeApi = {
  hostRoom: (request) => ipcRenderer.invoke(CHANNELS.hostRoom, request),
  joinRoom: (request) => ipcRenderer.invoke(CHANNELS.joinRoom, request),
  leaveRoom: () => ipcRenderer.invoke(CHANNELS.leaveRoom),
  sendIntent: (intent: Intent) => ipcRenderer.invoke(CHANNELS.sendIntent, intent),
  hostIntent: (intent: Intent) => ipcRenderer.invoke(CHANNELS.hostIntent, intent),
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot),
  startDiscovery: () => ipcRenderer.invoke(CHANNELS.startDiscovery),
  stopDiscovery: () => ipcRenderer.invoke(CHANNELS.stopDiscovery),
  listHosts: () => ipcRenderer.invoke(CHANNELS.listHosts),
  loadDictionary: () => ipcRenderer.invoke(CHANNELS.loadDictionary),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  listMods: () => ipcRenderer.invoke(CHANNELS.listMods),
  openModsFolder: () => ipcRenderer.invoke(CHANNELS.openModsFolder),
  onEvent: (listener) => subscribe<GameEvent>(CHANNELS.event, listener),
  onHostsChanged: (listener) => subscribe(CHANNELS.hostsChanged, listener),
  onDictionaryProgress: (listener) => subscribe(CHANNELS.dictionaryProgress, listener),
  onModsChanged: (listener) => subscribe(CHANNELS.modsChanged, listener),
};

contextBridge.exposeInMainWorld('bombParty', api);
