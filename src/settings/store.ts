import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

/** localStorage, or null when the browser blocks it (accessing it can throw). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type Listener = (s: Readonly<Settings>, changed: (keyof Settings)[]) => void;

/**
 * The live settings. Loaded once at startup; every change is saved immediately and pushed to
 * listeners (display refit, perf overlay). Readers that act per frame (frame limiter, effects)
 * just read `settings.current`.
 */
class SettingsStore {
  private value: Settings = loadSettings(storage());
  private readonly listeners: Listener[] = [];

  get current(): Readonly<Settings> {
    return this.value;
  }

  set(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== this.value[k]);
    if (changed.length === 0) return;
    this.value = { ...this.value, ...patch };
    saveSettings(storage(), this.value);
    for (const l of this.listeners) l(this.value, changed);
  }

  reset(): void {
    this.set({ ...DEFAULT_SETTINGS });
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }
}

export const settings = new SettingsStore();
// Inspection/measurement access in every build (like window.__perf).
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__settings = settings;
