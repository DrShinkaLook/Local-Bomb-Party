import type { GameEvent, GameRules, Intent, GameSnapshot, PlayerId } from '@bombparty/engine';

/**
 * The IPC contract between the Electron main process (which owns the
 * authoritative engine and every socket) and the renderer (which owns nothing
 * but pixels).
 *
 * Channel names are centralised here so the preload allow-list and the renderer
 * cannot drift apart: `preload.ts` exposes exactly these and nothing else.
 */

export const CHANNELS = {
  // renderer -> main, invoke
  hostRoom: 'bp:host-room',
  joinRoom: 'bp:join-room',
  leaveRoom: 'bp:leave-room',
  sendIntent: 'bp:intent',
  hostIntent: 'bp:host-intent',
  getSnapshot: 'bp:snapshot',
  listHosts: 'bp:list-hosts',
  startDiscovery: 'bp:start-discovery',
  stopDiscovery: 'bp:stop-discovery',
  loadDictionary: 'bp:load-dictionary',
  getSettings: 'bp:get-settings',
  saveSettings: 'bp:save-settings',
  listMods: 'bp:list-mods',
  openModsFolder: 'bp:open-mods-folder',
  // main -> renderer, send
  event: 'bp:event',
  status: 'bp:status',
  hostsChanged: 'bp:hosts-changed',
  dictionaryProgress: 'bp:dictionary-progress',
  modsChanged: 'bp:mods-changed',
} as const;

export interface HostRoomRequest {
  readonly roomName: string;
  readonly playerName: string;
  readonly seed?: string;
  readonly rules?: Partial<GameRules>;
  /** 0 asks the OS for a free port. */
  readonly port?: number;
  readonly lan: boolean;
}

export interface JoinRoomRequest {
  readonly address: string;
  readonly port: number;
  readonly playerName: string;
  readonly playerId?: PlayerId;
}

export interface SessionHandle {
  readonly playerId: PlayerId;
  readonly roomId: string;
  readonly snapshot: GameSnapshot;
  readonly lanPort: number | null;
}

export interface DiscoveredHostSummary {
  readonly roomId: string;
  readonly roomName: string;
  readonly address: string;
  readonly port: number;
  readonly players: number;
  readonly maxPlayers: number;
  readonly inProgress: boolean;
}

export interface ModSummary {
  readonly name: string;
  readonly words: number;
  readonly syllables: number;
  readonly hasTheme: boolean;
  readonly hasAudio: boolean;
}

export interface AppSettings {
  readonly playerName: string;
  readonly masterVolume: number;
  readonly sfxEnabled: boolean;
  readonly reducedMotion: boolean;
  readonly screenShake: boolean;
  readonly lastRules: Partial<GameRules>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playerName: 'Player',
  masterVolume: 0.7,
  sfxEnabled: true,
  reducedMotion: false,
  screenShake: true,
  lastRules: {},
};

/** The exact surface `window.bombParty` exposes. Nothing else crosses. */
export interface BridgeApi {
  hostRoom(request: HostRoomRequest): Promise<SessionHandle>;
  joinRoom(request: JoinRoomRequest): Promise<SessionHandle>;
  leaveRoom(): Promise<void>;
  sendIntent(intent: Intent): Promise<void>;
  hostIntent(intent: Intent): Promise<void>;
  getSnapshot(): Promise<GameSnapshot | null>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  listHosts(): Promise<readonly DiscoveredHostSummary[]>;
  loadDictionary(): Promise<{ words: number; ms: number }>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  listMods(): Promise<readonly ModSummary[]>;
  openModsFolder(): Promise<void>;
  onEvent(listener: (event: GameEvent) => void): () => void;
  onHostsChanged(listener: (hosts: readonly DiscoveredHostSummary[]) => void): () => void;
  onDictionaryProgress(listener: (progress: { loaded: number; total: number }) => void): () => void;
  onModsChanged(listener: (mods: readonly ModSummary[]) => void): () => void;
}
