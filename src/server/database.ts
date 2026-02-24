import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AppSettings {
  configWatchEnabled: boolean;
  autoLaunchEnabled: boolean;
  keepAwakeEnabled: boolean;
  idleTimeoutEnabled: boolean;
  wakeMinutes: number;
  autoUpdateCheckEnabled: boolean;
  serverPort: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  configWatchEnabled: false,
  autoLaunchEnabled: true,
  keepAwakeEnabled: false,
  idleTimeoutEnabled: false,
  wakeMinutes: 30,
  autoUpdateCheckEnabled: true,
  serverPort: 3000,
};

// ── DB initialisation ────────────────────────────────────────────────────────

const dataDir = process.env['RAGE_PAD_DATA_DIR']
  ? path.resolve(process.env['RAGE_PAD_DATA_DIR'])
  : path.resolve(__dirname, '../../data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'settings.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Seed defaults (INSERT OR IGNORE keeps existing values untouched)
const seed = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  seed.run(key, String(value));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deserialize(key: string, raw: string): boolean | number {
  const def = DEFAULT_SETTINGS[key as keyof AppSettings];
  if (typeof def === 'boolean') return raw === 'true';
  return Number(raw) || (def as number);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return DEFAULT_SETTINGS[key];
  return deserialize(key, row.value) as AppSettings[K];
}

export function getAllSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const result = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      (result as any)[row.key] = deserialize(row.key, row.value);
    }
  }
  return result;
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const batch = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) update.run(k, v);
  });
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(partial)) {
    if (key in DEFAULT_SETTINGS) {
      entries.push([key, String(value)]);
    }
  }
  if (entries.length) batch(entries);
  return getAllSettings();
}

export function closeDb(): void {
  db.close();
}
