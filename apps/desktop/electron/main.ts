import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRoomCode } from '@bombparty/engine';
import type { Dictionary, GameEvent, Intent } from '@bombparty/engine';
import {
  CHANNELS,
  type AppSettings,
  type HostRoomRequest,
  type JoinByCodeRequest,
  type JoinByCodeResult,
  type JoinRoomRequest,
} from './ipc.js';
import { Session } from './session.js';
import { DiscoveryListener } from './net/discovery.js';
import { LanRoomCodeResolver } from './net/roomCodeResolver.js';
import { ModRegistry } from './mods.js';
import { SettingsStore } from './settings.js';
import { loadDictionary } from './dictionary/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let window: BrowserWindow | null = null;
let dictionary: Dictionary | null = null;

const modsRoot = isDev
  ? join(here, '../../../mods')
  : join(app.getPath('userData'), 'mods');

const mods = new ModRegistry(modsRoot);
const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
const discovery = new DiscoveryListener();
const roomCodes = new LanRoomCodeResolver(discovery);

const emitToRenderer = (channel: string, payload: unknown): void => {
  if (window !== null && !window.isDestroyed()) window.webContents.send(channel, payload);
};

const session = new Session((event: GameEvent) => emitToRenderer(CHANNELS.event, event));

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/**
 * Security posture, stated in one place:
 *
 *   - `contextIsolation` on and `nodeIntegration` off: renderer JavaScript runs
 *     in its own context with no `require`, no `process`, no `Buffer`.
 *   - `sandbox` on: the renderer process is OS-sandboxed as well.
 *   - Navigation and new windows are refused outright. This app has no reason
 *     to visit a URL, so the safest handler is one that always says no.
 *
 * The renderer is treated as untrusted. That is not paranoia about our own
 * code — it is what makes a bug in rendering someone's LAN-supplied display
 * name a rendering bug rather than a remote code execution.
 */
const createWindow = (): void => {
  window = new BrowserWindow({
    width: 1_280,
    height: 820,
    minWidth: 1_000,
    minHeight: 700,
    backgroundColor: '#07070d',
    show: false,
    autoHideMenuBar: true,
    title: 'Bomb Party',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window?.show());

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (isDev) {
    void window.loadURL('http://localhost:5173');
  } else {
    void window.loadFile(join(here, '../dist/index.html'));
  }
};

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

const dictionaryPaths = () => ({
  wordListPath: isDev
    ? join(here, '../../../data/words-en.txt')
    : join(process.resourcesPath, 'data', 'words-en.txt'),
  cachePath: join(app.getPath('userData'), 'cache', 'dictionary-v1.bin'),
});

const ensureDictionary = async (): Promise<{ words: number; ms: number }> => {
  mods.scan();
  const { wordListPath, cachePath } = dictionaryPaths();
  const result = await loadDictionary({
    wordListPath,
    cachePath,
    modWordPaths: mods.wordFiles(),
    minLength: 2,
  });
  dictionary = result.dictionary;
  return { words: result.words, ms: result.ms };
};

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

const registerIpc = (): void => {
  ipcMain.handle(CHANNELS.loadDictionary, () => ensureDictionary());

  ipcMain.handle(CHANNELS.hostRoom, async (_event, request: HostRoomRequest) => {
    if (dictionary === null) await ensureDictionary();
    return session.startHosting(
      request,
      dictionary as Dictionary,
      mods.syllableOverrides(),
    );
  });

  ipcMain.handle(CHANNELS.joinRoom, (_event, request: JoinRoomRequest) => session.join(request));

  /**
   * Join by code.
   *
   * Discovery is started on demand rather than assumed: a player can paste a
   * code straight from the main menu without having opened the room browser,
   * and the resolver needs beacons to be arriving before it can match one.
   * The distinct failure reasons matter — "that is not a code" and "no room
   * answered to it" need different advice in the UI.
   */
  ipcMain.handle(
    CHANNELS.joinByCode,
    async (_event, request: JoinByCodeRequest): Promise<JoinByCodeResult> => {
      await discovery.start();

      const endpoint = await roomCodes.resolve(request.code);
      if (endpoint === null) {
        const malformed = normalizeRoomCode(request.code) === null;
        return malformed
          ? { ok: false, reason: 'MALFORMED', message: 'That does not look like a room code.' }
          : {
              ok: false,
              reason: 'NOT_FOUND',
              message: 'No room on this network answered to that code.',
            };
      }

      try {
        const handle = await session.join({
          address: endpoint.address,
          port: endpoint.port,
          playerName: request.playerName,
        });
        return { ok: true, handle };
      } catch (error) {
        return {
          ok: false,
          reason: 'REFUSED',
          message: error instanceof Error ? error.message : 'The room refused the connection.',
        };
      }
    },
  );
  ipcMain.handle(CHANNELS.leaveRoom, () => session.stop());
  ipcMain.handle(CHANNELS.sendIntent, (_event, intent: Intent) => session.sendIntent(intent));
  ipcMain.handle(CHANNELS.hostIntent, (_event, intent: Intent) => session.hostIntent(intent));
  ipcMain.handle(CHANNELS.getSnapshot, () => session.snapshot());

  ipcMain.handle(CHANNELS.startDiscovery, () => discovery.start());
  ipcMain.handle(CHANNELS.stopDiscovery, () => discovery.stop());
  ipcMain.handle(CHANNELS.listHosts, () =>
    discovery.knownHosts().map((entry) => ({
      roomId: entry.beacon.roomId,
      roomCode: entry.beacon.roomCode,
      roomName: entry.beacon.roomName,
      address: entry.address,
      port: entry.beacon.port,
      players: entry.beacon.players,
      maxPlayers: entry.beacon.maxPlayers,
      inProgress: entry.beacon.inProgress,
    })),
  );

  ipcMain.handle(CHANNELS.getSettings, () => settings.read());
  ipcMain.handle(CHANNELS.saveSettings, (_event, next: AppSettings) => settings.write(next));

  ipcMain.handle(CHANNELS.listMods, () => {
    mods.scan();
    return mods.summaries();
  });
  ipcMain.handle(CHANNELS.openModsFolder, () => shell.openPath(mods.modsRoot));
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app.whenReady().then(() => {
    registerIpc();
    mods.startWatching();
    mods.onChange((summaries) => emitToRenderer(CHANNELS.modsChanged, summaries));
    discovery.onChange(() =>
      emitToRenderer(
        CHANNELS.hostsChanged,
        discovery.knownHosts().map((entry) => ({
          roomId: entry.beacon.roomId,
          roomCode: entry.beacon.roomCode,
          roomName: entry.beacon.roomName,
          address: entry.address,
          port: entry.beacon.port,
          players: entry.beacon.players,
          maxPlayers: entry.beacon.maxPlayers,
          inProgress: entry.beacon.inProgress,
        })),
      ),
    );

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    mods.stopWatching();
    void discovery.stop();
    void session.stop();
  });
}
