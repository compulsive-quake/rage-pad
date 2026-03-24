import { exec } from 'child_process';
import { AudioEngine } from './audio-engine';
import { getSetting, setSetting } from './database';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GameProfile {
  id: string;
  name: string;
  processName: string;
  pttKeyCode: number;
  pttKeyLabel: string;
  enabled: boolean;
  isPreset: boolean;
}

export interface PttStatus {
  enabled: boolean;
  detectedGame: string | null;
  detectedProcessName: string | null;
  activeKeyLabel: string | null;
  activeKeyCode: number | null;
}

// ── Preset games ─────────────────────────────────────────────────────────────

export const PRESET_GAMES: Omit<GameProfile, 'id' | 'enabled'>[] = [
  // ── FPS / Battle Royale / Tactical Shooters ──
  { name: 'Counter-Strike 2', processName: 'cs2.exe', pttKeyCode: 0x4B, pttKeyLabel: 'K', isPreset: true },
  { name: 'Valorant', processName: 'VALORANT-Win64-Shipping.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Fortnite', processName: 'FortniteClient-Win64-Shipping.exe', pttKeyCode: 0x59, pttKeyLabel: 'Y', isPreset: true },
  { name: 'Apex Legends', processName: 'r5apex.exe', pttKeyCode: 0x54, pttKeyLabel: 'T', isPreset: true },
  { name: 'Overwatch 2', processName: 'Overwatch.exe', pttKeyCode: 0xC0, pttKeyLabel: '~ (Tilde)', isPreset: true },
  { name: 'PUBG', processName: 'TslGame.exe', pttKeyCode: 0x54, pttKeyLabel: 'T', isPreset: true },
  { name: 'Call of Duty: Warzone', processName: 'cod.exe', pttKeyCode: 0x5A, pttKeyLabel: 'Z', isPreset: true },
  { name: 'Call of Duty: Modern Warfare II', processName: 'cod22-cod.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Rainbow Six Siege', processName: 'RainbowSix.exe', pttKeyCode: 0x55, pttKeyLabel: 'U', isPreset: true },
  { name: 'Battlefield 2042', processName: 'BF2042.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Halo Infinite', processName: 'HaloInfinite.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'The Finals', processName: 'Discovery.exe', pttKeyCode: 0x5A, pttKeyLabel: 'Z', isPreset: true },
  { name: 'XDefiant', processName: 'XDefiant.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Insurgency: Sandstorm', processName: 'InsurgencyClient-Win64-Shipping.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },

  // ── Tactical / Milsim ──
  { name: 'Hell Let Loose', processName: 'HLL-Win64-Shipping.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Squad', processName: 'SquadGame.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Escape from Tarkov', processName: 'EscapeFromTarkov.exe', pttKeyCode: 0x4B, pttKeyLabel: 'K', isPreset: true },
  { name: 'Hunt: Showdown', processName: 'HuntGame.exe', pttKeyCode: 0xA4, pttKeyLabel: 'Left Alt', isPreset: true },
  { name: 'DayZ', processName: 'DayZ_x64.exe', pttKeyCode: 0x14, pttKeyLabel: 'Caps Lock', isPreset: true },
  { name: 'Arma 3', processName: 'arma3_x64.exe', pttKeyCode: 0x14, pttKeyLabel: 'Caps Lock', isPreset: true },
  { name: 'Ready or Not', processName: 'ReadyOrNot-Win64-Shipping.exe', pttKeyCode: 0x4A, pttKeyLabel: 'J', isPreset: true },

  // ── Survival / Open World ──
  { name: 'Rust', processName: 'RustClient.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'ARK: Survival Evolved', processName: 'ShooterGame.exe', pttKeyCode: 0x42, pttKeyLabel: 'B', isPreset: true },
  { name: 'Sea of Thieves', processName: 'SoTGame.exe', pttKeyCode: 0xA4, pttKeyLabel: 'Left Alt', isPreset: true },
  { name: 'No Man\'s Sky', processName: 'NMS.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Palworld', processName: 'Palworld-Win64-Shipping.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'The Forest', processName: 'TheForest.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Sons of the Forest', processName: 'SonsOfTheForest.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },

  // ── Co-op / Horror ──
  { name: 'Phasmophobia', processName: 'Phasmophobia.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Lethal Company', processName: 'Lethal Company.exe', pttKeyCode: 0x54, pttKeyLabel: 'T', isPreset: true },
  { name: 'Deep Rock Galactic', processName: 'FSD-Win64-Shipping.exe', pttKeyCode: 0x5A, pttKeyLabel: 'Z', isPreset: true },
  { name: 'Helldivers 2', processName: 'helldivers2.exe', pttKeyCode: 0x14, pttKeyLabel: 'Caps Lock', isPreset: true },
  { name: 'Back 4 Blood', processName: 'Back4Blood.exe', pttKeyCode: 0x54, pttKeyLabel: 'T', isPreset: true },
  { name: 'Left 4 Dead 2', processName: 'left4dead2.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'GTFO', processName: 'GTFO.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Warhammer: Vermintide 2', processName: 'vermintide2.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Payday 3', processName: 'PAYDAY3Client-Win64-Shipping.exe', pttKeyCode: 0x42, pttKeyLabel: 'B', isPreset: true },

  // ── MOBA / Competitive ──
  { name: 'League of Legends', processName: 'League of Legends.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Dota 2', processName: 'dota2.exe', pttKeyCode: 0x47, pttKeyLabel: 'G', isPreset: true },
  { name: 'Rocket League', processName: 'RocketLeague.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },

  // ── RPG / MMO ──
  { name: 'Destiny 2', processName: 'destiny2.exe', pttKeyCode: 0x54, pttKeyLabel: 'T', isPreset: true },
  { name: 'World of Warcraft', processName: 'Wow.exe', pttKeyCode: 0xC0, pttKeyLabel: '~ (Tilde)', isPreset: true },
  { name: 'Final Fantasy XIV', processName: 'ffxiv_dx11.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Warframe', processName: 'Warframe.x64.exe', pttKeyCode: 0x43, pttKeyLabel: 'C', isPreset: true },
  { name: 'Path of Exile 2', processName: 'PathOfExileSteam.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Elden Ring', processName: 'eldenring.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Baldur\'s Gate 3', processName: 'bg3.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },

  // ── Sandbox / Social ──
  { name: 'GTA V', processName: 'GTA5.exe', pttKeyCode: 0x4E, pttKeyLabel: 'N', isPreset: true },
  { name: 'FiveM', processName: 'FiveM.exe', pttKeyCode: 0x4E, pttKeyLabel: 'N', isPreset: true },
  { name: 'Minecraft', processName: 'javaw.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Roblox', processName: 'RobloxPlayerBeta.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Among Us', processName: 'Among Us.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Dead by Daylight', processName: 'DeadByDaylight-Win64-Shipping.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Garry\'s Mod', processName: 'gmod.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Team Fortress 2', processName: 'hl2.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Satisfactory', processName: 'FactoryGame.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },

  // ── Voice Chat Applications ──
  { name: 'Discord', processName: 'Discord.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'TeamSpeak', processName: 'ts3client_win64.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Mumble', processName: 'mumble.exe', pttKeyCode: 0x56, pttKeyLabel: 'V', isPreset: true },
  { name: 'Ventrilo', processName: 'Ventrilo.exe', pttKeyCode: 0xA2, pttKeyLabel: 'Left Ctrl', isPreset: true },
];

// ── HotkeyManager ────────────────────────────────────────────────────────────

export class HotkeyManager {
  private audioEngine: AudioEngine;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private _detectedGame: GameProfile | null = null;
  private _enabled = false;
  private runningProcesses = new Set<string>();

  constructor(audioEngine: AudioEngine) {
    this.audioEngine = audioEngine;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get detectedGame(): GameProfile | null {
    return this._detectedGame;
  }

  /** Start monitoring for game processes. */
  start(): void {
    this._enabled = getSetting('pttEnabled') as boolean;
    if (!this._enabled) return;

    console.log('[hotkey] Starting game process monitoring');
    this.poll(); // Initial poll
    this.pollInterval = setInterval(() => this.poll(), 5000);
  }

  /** Stop monitoring and release any held keys. */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this._detectedGame) {
      this.sendClearPttKey();
      this._detectedGame = null;
    }
  }

  /** Enable or disable PTT mode. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    setSetting('pttEnabled', enabled);

    if (enabled) {
      if (!this.pollInterval) {
        this.poll();
        this.pollInterval = setInterval(() => this.poll(), 5000);
      }
    } else {
      this.stop();
    }
  }

  /** Get saved game profiles, merging presets with saved data. */
  getProfiles(): GameProfile[] {
    const saved = this.loadSavedProfiles();

    if (saved.length === 0) {
      // First time: generate default profiles from presets (all disabled)
      const defaults = PRESET_GAMES.map((preset, i) => ({
        ...preset,
        id: `preset-${i}`,
        enabled: false,
      }));
      this.saveProfiles(defaults);
      return defaults;
    }

    // Merge any new presets that aren't in the saved list yet
    const savedProcessNames = new Set(saved.map(p => p.processName.toLowerCase()));
    let added = false;
    for (const preset of PRESET_GAMES) {
      if (!savedProcessNames.has(preset.processName.toLowerCase())) {
        saved.push({
          ...preset,
          id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          enabled: false,
        });
        added = true;
      }
    }
    if (added) this.saveProfiles(saved);

    return saved;
  }

  /** Save game profiles. */
  saveProfiles(profiles: GameProfile[]): void {
    setSetting('pttGameProfiles', JSON.stringify(profiles));
  }

  /** Get current PTT status. */
  getStatus(): PttStatus {
    return {
      enabled: this._enabled,
      detectedGame: this._detectedGame?.name ?? null,
      detectedProcessName: this._detectedGame?.processName ?? null,
      activeKeyLabel: this._detectedGame?.pttKeyLabel ?? null,
      activeKeyCode: this._detectedGame?.pttKeyCode ?? null,
    };
  }

  /** List currently running process names. */
  async listProcesses(): Promise<string[]> {
    return new Promise((resolve) => {
      exec('tasklist /FO CSV /NH', { maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const names = new Set<string>();
        for (const line of stdout.split('\n')) {
          const match = line.match(/^"([^"]+)"/);
          if (match) names.add(match[1]);
        }
        resolve(Array.from(names).sort());
      });
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private poll(): void {
    if (!this._enabled) return;

    exec('tasklist /FO CSV /NH', { maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
      if (error) return;

      this.runningProcesses.clear();
      for (const line of stdout.split('\n')) {
        const match = line.match(/^"([^"]+)"/);
        if (match) this.runningProcesses.add(match[1].toLowerCase());
      }

      const profiles = this.getProfiles().filter(p => p.enabled);
      const matched = profiles.find(p =>
        this.runningProcesses.has(p.processName.toLowerCase())
      );

      if (matched && this._detectedGame?.id !== matched.id) {
        // New game detected or game changed
        console.log(`[hotkey] Game detected: ${matched.name} (${matched.processName}), PTT key: ${matched.pttKeyLabel}`);
        this._detectedGame = matched;
        this.sendSetPttKey(matched.pttKeyCode);
      } else if (!matched && this._detectedGame) {
        // Game exited
        console.log(`[hotkey] Game exited: ${this._detectedGame.name}`);
        this.sendClearPttKey();
        this._detectedGame = null;
      }
    });
  }

  private sendSetPttKey(virtualKeyCode: number): void {
    if (!this.audioEngine.running) return;
    this.audioEngine.setPttKey(virtualKeyCode).catch((err: Error) => {
      console.warn(`[hotkey] Failed to set PTT key: ${err.message}`);
    });
  }

  private sendClearPttKey(): void {
    if (!this.audioEngine.running) return;
    this.audioEngine.clearPttKey().catch((err: Error) => {
      console.warn(`[hotkey] Failed to clear PTT key: ${err.message}`);
    });
  }

  private loadSavedProfiles(): GameProfile[] {
    try {
      const raw = getSetting('pttGameProfiles') as string;
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}
