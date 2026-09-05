import { useEffect, useState } from 'react';
import type { DiscoveredHostSummary, AppSettings } from '../../electron/ipc.js';

interface MainMenuProps {
  readonly settings: AppSettings;
  readonly dictionaryWords: number;
  readonly loading: boolean;
  readonly onSoloGame: (name: string) => void;
  readonly onHostLan: (name: string, roomName: string) => void;
  readonly onJoin: (host: DiscoveredHostSummary, name: string) => void;
  readonly onOpenSettings: () => void;
}

export const MainMenu = ({
  settings,
  dictionaryWords,
  loading,
  onSoloGame,
  onHostLan,
  onJoin,
  onOpenSettings,
}: MainMenuProps) => {
  const [name, setName] = useState(settings.playerName);
  const [roomName, setRoomName] = useState(`${settings.playerName}'s room`);
  const [hosts, setHosts] = useState<readonly DiscoveredHostSummary[]>([]);

  useEffect(() => {
    void window.bombParty.startDiscovery();
    const off = window.bombParty.onHostsChanged(setHosts);
    void window.bombParty.listHosts().then(setHosts);
    return () => {
      off();
      void window.bombParty.stopDiscovery();
    };
  }, []);

  return (
    <div className="stage flex h-full w-full items-center justify-center p-10">
      <div className="grid w-full max-w-5xl grid-cols-[1.1fr_1fr] gap-8">
        <section className="flex flex-col justify-center">
          <h1 className="font-display text-6xl font-bold tracking-tight">
            Bomb<span style={{ color: 'var(--bp-accent)' }}>Party</span>
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed" style={{ color: 'var(--bp-muted)' }}>
            Type a word containing the syllable before the fuse burns out. Miss, and the bomb
            costs you a life. Last player standing wins.
          </p>

          <label className="mt-8 block text-xs uppercase tracking-widest" style={{ color: 'var(--bp-muted)' }}>
            Your name
          </label>
          <input
            className="panel mt-2 w-72 rounded-lg bg-black/30 px-4 py-2 outline-none"
            value={name}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-lg px-5 py-3 font-semibold text-black transition-transform hover:scale-[1.03] disabled:opacity-40"
              style={{ background: 'var(--bp-accent)' }}
              disabled={loading || name.trim().length === 0}
              onClick={() => onSoloGame(name.trim())}
            >
              {loading ? 'Loading dictionary…' : 'Play with bots'}
            </button>
            <button
              className="panel rounded-lg px-5 py-3 font-semibold transition-transform hover:scale-[1.03] disabled:opacity-40"
              disabled={loading || name.trim().length === 0}
              onClick={() => onHostLan(name.trim(), roomName.trim() || 'Bomb Party')}
            >
              Host on LAN
            </button>
            <button className="panel rounded-lg px-5 py-3 font-semibold" onClick={onOpenSettings}>
              Settings
            </button>
          </div>

          <p className="mt-6 text-xs" style={{ color: 'var(--bp-muted)' }}>
            {dictionaryWords > 0
              ? `${dictionaryWords.toLocaleString()} words loaded`
              : 'Preparing dictionary…'}
          </p>
        </section>

        <section className="panel flex flex-col rounded-2xl p-5">
          <header className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">Rooms on this network</h2>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--bp-muted)' }}>
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--bp-good)' }}
              />
              scanning
            </span>
          </header>

          <input
            className="panel mt-4 rounded-lg bg-black/30 px-3 py-2 text-sm outline-none"
            value={roomName}
            maxLength={32}
            onChange={(event) => setRoomName(event.target.value)}
            aria-label="Room name for hosting"
          />

          <div className="scroll-thin mt-4 flex-1 space-y-2 overflow-y-auto">
            {hosts.length === 0 ? (
              <p className="pt-8 text-center text-sm" style={{ color: 'var(--bp-muted)' }}>
                No rooms found yet.
                <br />
                Host one, or make sure you are on the same WiFi.
              </p>
            ) : (
              hosts.map((host) => (
                <button
                  key={`${host.address}:${host.port}`}
                  className="panel flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                  onClick={() => onJoin(host, name.trim())}
                >
                  <span>
                    <span className="block text-sm font-semibold">{host.roomName}</span>
                    <span className="block text-xs" style={{ color: 'var(--bp-muted)' }}>
                      {host.address} · {host.players}/{host.maxPlayers}
                      {host.inProgress ? ' · in progress' : ''}
                    </span>
                  </span>
                  <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--bp-accent)' }}>
                    join
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
