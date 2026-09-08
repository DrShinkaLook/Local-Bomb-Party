import { useCallback, useEffect, useState } from 'react';
import type { Intent, PlayerId } from '@bombparty/engine';
import type { AppSettings, DiscoveredHostSummary } from '../electron/ipc.js';
import { DEFAULT_SETTINGS } from '../electron/ipc.js';
import { useSession } from './hooks/useSession.js';
import { sfx } from './audio/sfx.js';
import { MainMenu } from './components/MainMenu.js';
import { Lobby } from './components/Lobby.js';
import { GameView } from './components/GameView.js';
import { GameOver } from './components/GameOver.js';
import { SettingsPanel } from './components/SettingsPanel.js';

type Screen = 'menu' | 'settings' | 'session';

/**
 * Top-level routing.
 *
 * The screen is derived from the authoritative snapshot rather than tracked
 * separately: `phase.name` decides whether the player sees a lobby, the bomb,
 * or the results table. That means the renderer cannot get stuck on the wrong
 * screen when a host action changes the phase, because there is no second
 * source of truth to fall behind.
 */
export const App = () => {
  const [screen, setScreen] = useState<Screen>('menu');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [playerId, setPlayerId] = useState<PlayerId | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [lanPort, setLanPort] = useState<number | null>(null);
  const [dictionaryWords, setDictionaryWords] = useState(0);
  const [loading, setLoading] = useState(true);

  const { snapshot, toasts, lastRejection, explosionAt, send, hostSend } = useSession(playerId);

  useEffect(() => {
    void window.bombParty.getSettings().then((loaded) => {
      setSettings(loaded);
      sfx.setEnabled(loaded.sfxEnabled);
      sfx.setVolume(loaded.masterVolume);
    });
    void window.bombParty
      .loadDictionary()
      .then((result) => setDictionaryWords(result.words))
      .catch(() => setDictionaryWords(0))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    sfx.setEnabled(next.sfxEnabled);
    sfx.setVolume(next.masterVolume);
    void window.bombParty.saveSettings(next);
    setScreen('menu');
  }, []);

  const startSolo = useCallback(
    async (name: string) => {
      const handle = await window.bombParty.hostRoom({
        roomName: `${name}'s game`,
        playerName: name,
        lan: false,
        rules: settings.lastRules,
      });
      setPlayerId(handle.playerId);
      setIsHost(true);
      setLanPort(null);
      setScreen('session');
      // A solo game is not much of a party without opponents.
      void window.bombParty.hostIntent({ type: 'ADD_BOT', difficulty: 'medium' });
      void window.bombParty.hostIntent({ type: 'ADD_BOT', difficulty: 'easy' });
    },
    [settings.lastRules],
  );

  const startLanHost = useCallback(
    async (name: string, roomName: string) => {
      const handle = await window.bombParty.hostRoom({
        roomName,
        playerName: name,
        lan: true,
        rules: settings.lastRules,
      });
      setPlayerId(handle.playerId);
      setIsHost(true);
      setLanPort(handle.lanPort);
      setScreen('session');
    },
    [settings.lastRules],
  );

  const join = useCallback(async (host: DiscoveredHostSummary, name: string) => {
    const handle = await window.bombParty.joinRoom({
      address: host.address,
      port: host.port,
      playerName: name,
    });
    setPlayerId(handle.playerId);
    setIsHost(false);
    setLanPort(null);
    setScreen('session');
  }, []);

  const leave = useCallback(() => {
    void window.bombParty.leaveRoom();
    setPlayerId(null);
    setIsHost(false);
    setLanPort(null);
    setScreen('menu');
  }, []);

  const onSend = useCallback((intent: Intent) => send(intent), [send]);
  const onHostIntent = useCallback((intent: Intent) => hostSend(intent), [hostSend]);

  if (screen === 'settings') {
    return <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setScreen('menu')} />;
  }

  if (screen === 'menu' || snapshot === null) {
    return (
      <MainMenu
        settings={settings}
        dictionaryWords={dictionaryWords}
        loading={loading}
        onSoloGame={(name) => void startSolo(name)}
        onHostLan={(name, room) => void startLanHost(name, room)}
        onJoin={(host, name) => void join(host, name)}
        onOpenSettings={() => setScreen('settings')}
      />
    );
  }

  switch (snapshot.phase.name) {
    case 'lobby':
      return (
        <Lobby
          snapshot={snapshot}
          selfId={playerId}
          isHost={isHost}
          lanPort={lanPort}
          onHostIntent={onHostIntent}
          onLeave={leave}
        />
      );

    case 'gameOver':
      return (
        <GameOver
          snapshot={snapshot}
          winner={snapshot.phase.winner}
          isHost={isHost}
          onHostIntent={onHostIntent}
          onLeave={leave}
        />
      );

    default:
      return (
        <GameView
          snapshot={snapshot}
          selfId={playerId}
          toasts={toasts}
          rejection={lastRejection}
          exploding={explosionAt !== null}
          screenShake={settings.screenShake}
          reducedMotion={settings.reducedMotion}
          isHost={isHost}
          onSend={onSend}
          onHostIntent={onHostIntent}
          onLeave={leave}
        />
      );
  }
};
