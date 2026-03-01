import path from 'path';
import fs from 'fs';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AppSettings {
  keepAwakeEnabled: boolean;
  idleTimeoutEnabled: boolean;
  wakeMinutes: number;
  autoUpdateCheckEnabled: boolean;
  updateCheckIntervalMinutes: number;
  serverPort: number;
  audioInputDevice: string;
  audioOutputDevice: string;
  youtubeCachePath: string;
  youtubeCacheTtlMinutes: number;
  youtubeCacheMaxSizeMb: number;
  nsfwModeEnabled: boolean;
  storeServerUrl: string;
  storeUploaderToken: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  keepAwakeEnabled: false,
  idleTimeoutEnabled: false,
  wakeMinutes: 30,
  autoUpdateCheckEnabled: true,
  updateCheckIntervalMinutes: 60,
  serverPort: 8088,
  audioInputDevice: '',
  audioOutputDevice: '',
  youtubeCachePath: '',
  youtubeCacheTtlMinutes: 4320,
  youtubeCacheMaxSizeMb: 100,
  nsfwModeEnabled: false,
  storeServerUrl: 'http://localhost:9090',
  storeUploaderToken: '',
};

// ── Data dir & file path ─────────────────────────────────────────────────────

export const dataDir = process.env['RAGE_PAD_DATA_DIR']
  ? path.resolve(process.env['RAGE_PAD_DATA_DIR'])
  : path.resolve(__dirname, '../../data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const settingsPath = path.join(dataDir, 'settings.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: AppSettings): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// Seed defaults on first load
if (!fs.existsSync(settingsPath)) {
  writeSettings(DEFAULT_SETTINGS);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  const settings = readSettings();
  return settings[key];
}

export function getAllSettings(): AppSettings {
  return readSettings();
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const settings = readSettings();
  settings[key] = value;
  writeSettings(settings);
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const settings = readSettings();
  for (const [key, value] of Object.entries(partial)) {
    if (key in DEFAULT_SETTINGS) {
      (settings as any)[key] = value;
    }
  }
  writeSettings(settings);
  return settings;
}

export function closeDb(): void {
  // no-op – kept for API compatibility
}
