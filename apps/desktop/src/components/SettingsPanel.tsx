import { useEffect, useState, type ReactNode } from 'react';
import type { AppSettings, ModSummary } from '../../electron/ipc.js';

interface SettingsPanelProps {
  readonly settings: AppSettings;
  readonly onSave: (settings: AppSettings) => void;
  readonly onClose: () => void;
}

export const SettingsPanel = ({ settings, onSave, onClose }: SettingsPanelProps) => {
  const [draft, setDraft] = useState(settings);
  const [mods, setMods] = useState<readonly ModSummary[]>([]);

  useEffect(() => {
    void window.bombParty.listMods().then(setMods);
    return window.bombParty.onModsChanged(setMods);
  }, []);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="stage flex h-full w-full items-center justify-center p-10">
      <div className="panel w-full max-w-2xl rounded-2xl p-6">
        <h2 className="font-display text-2xl font-semibold">Settings</h2>

        <div className="mt-6 space-y-5">
          <Row label="Display name">
            <input
              className="panel w-56 rounded-lg bg-black/30 px-3 py-1.5 outline-none"
              value={draft.playerName}
              maxLength={24}
              onChange={(event) => update('playerName', event.target.value)}
            />
          </Row>

          <Row label="Sound effects">
            <Toggle checked={draft.sfxEnabled} onChange={(v) => update('sfxEnabled', v)} />
          </Row>

          <Row label="Volume">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.masterVolume * 100)}
              onChange={(event) => update('masterVolume', Number(event.target.value) / 100)}
              className="w-56"
            />
          </Row>

          <Row label="Screen shake">
            <Toggle checked={draft.screenShake} onChange={(v) => update('screenShake', v)} />
          </Row>

          <Row label="Reduce motion">
            <Toggle checked={draft.reducedMotion} onChange={(v) => update('reducedMotion', v)} />
          </Row>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">Mods</h3>
            <button
              className="text-xs uppercase tracking-wide hover:underline"
              style={{ color: 'var(--bp-accent)' }}
              onClick={() => void window.bombParty.openModsFolder()}
            >
              open folder
            </button>
          </div>
          {mods.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--bp-muted)' }}>
              No mods installed. Drop a folder into the mods directory with{' '}
              <code>custom_words.txt</code>, <code>custom_syllables.json</code>,{' '}
              <code>theme.json</code>, or an <code>audio/</code> folder.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {mods.map((mod) => (
                <li key={mod.name} className="panel flex justify-between rounded-lg px-3 py-2 text-sm">
                  <span>{mod.name}</span>
                  <span style={{ color: 'var(--bp-muted)' }}>
                    {mod.words > 0 ? `${mod.words.toLocaleString()} words · ` : ''}
                    {mod.syllables > 0 ? `${mod.syllables} syllables · ` : ''}
                    {mod.hasTheme ? 'theme · ' : ''}
                    {mod.hasAudio ? 'audio' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button className="panel rounded-lg px-5 py-2.5" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded-lg px-5 py-2.5 font-semibold text-black"
            style={{ background: 'var(--bp-accent)' }}
            onClick={() => onSave(draft)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between">
    <span style={{ color: 'var(--bp-muted)' }}>{label}</span>
    {children}
  </div>
);

const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    role="switch"
    aria-checked={checked}
    className="relative h-6 w-11 rounded-full transition-colors"
    style={{ background: checked ? 'var(--bp-accent)' : 'rgba(255,255,255,0.12)' }}
    onClick={() => onChange(!checked)}
  >
    <span
      className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
      style={{ left: checked ? '22px' : '2px' }}
    />
  </button>
);
