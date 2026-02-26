import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

// ── Protocol types (must match Rust binary) ────────────────────────────────

interface Command {
  cmd: string;
  [key: string]: any;
}

interface EngineResponse {
  type: 'ok' | 'error' | 'devices' | 'status';
  message?: string;
  input?: string[];
  output?: string[];
  playing?: boolean;
  paused?: boolean;
  volume?: number;
  input_device?: string | null;
  output_device?: string | null;
}

export interface AudioDevices {
  input: string[];
  output: string[];
}

export interface AudioStatus {
  playing: boolean;
  paused: boolean;
  volume: number;
  inputDevice: string | null;
  outputDevice: string | null;
}

// ── AudioEngine ────────────────────────────────────────────────────────────

export class AudioEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private binaryPath: string;
  private pendingRequests: Array<{
    resolve: (value: EngineResponse) => void;
    reject: (reason: Error) => void;
  }> = [];
  private lineBuffer = '';
  private _running = false;

  constructor() {
    super();
    // Resolve the audio engine binary path:
    // 1. RAGE_PAD_AUDIO_ENGINE env var (Tauri bundle)
    // 2. Local dev build
    // 3. Fall back to PATH
    if (process.env['RAGE_PAD_AUDIO_ENGINE']) {
      this.binaryPath = process.env['RAGE_PAD_AUDIO_ENGINE'];
    } else {
      const devBinary = path.join(__dirname, '../../audio-engine/target/release/ragepad-audio-engine.exe');
      if (fs.existsSync(devBinary)) {
        this.binaryPath = devBinary;
      } else {
        this.binaryPath = 'ragepad-audio-engine';
      }
    }
  }

  get running(): boolean {
    return this._running;
  }

  start(): void {
    if (this.process) return;

    console.log(`[audio-engine] Starting: ${this.binaryPath}`);

    this.process = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._running = true;

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString('utf-8');
      const lines = this.lineBuffer.split('\n');
      // Keep incomplete last line in buffer
      this.lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.handleLine(trimmed);
      }
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) console.error(`[audio-engine stderr] ${text}`);
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[audio-engine] Exited with code ${code}, signal ${signal}`);
      this._running = false;
      this.process = null;

      // Reject any pending requests
      for (const req of this.pendingRequests) {
        req.reject(new Error('Audio engine process exited'));
      }
      this.pendingRequests = [];

      this.emit('exit', code, signal);
    });

    this.process.on('error', (err) => {
      console.error(`[audio-engine] Failed to start: ${err.message}`);
      this._running = false;
      this.process = null;

      for (const req of this.pendingRequests) {
        req.reject(err);
      }
      this.pendingRequests = [];
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.send({ cmd: 'shutdown' });
    } catch {
      // If shutdown command fails, force kill
    }

    // Give it a moment to exit gracefully
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 2000);

      if (this.process) {
        this.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async listDevices(): Promise<AudioDevices> {
    const resp = await this.send({ cmd: 'list_devices' });
    return {
      input: resp.input || [],
      output: resp.output || [],
    };
  }

  async setInputDevice(deviceName: string): Promise<void> {
    const resp = await this.send({ cmd: 'set_input_device', device_name: deviceName });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async setOutputDevice(deviceName: string): Promise<void> {
    const resp = await this.send({ cmd: 'set_output_device', device_name: deviceName });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async play(filePath: string, volume?: number): Promise<void> {
    const resp = await this.send({
      cmd: 'play',
      file_path: filePath,
      volume: volume !== undefined ? volume / 100 : undefined,
    });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async stopPlayback(): Promise<void> {
    const resp = await this.send({ cmd: 'stop' });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async pause(): Promise<void> {
    const resp = await this.send({ cmd: 'pause' });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async resume(): Promise<void> {
    const resp = await this.send({ cmd: 'resume' });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async setVolume(volume: number): Promise<void> {
    const resp = await this.send({ cmd: 'set_volume', volume: volume / 100 });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  async getStatus(): Promise<AudioStatus> {
    const resp = await this.send({ cmd: 'get_status' });
    return {
      playing: resp.playing || false,
      paused: resp.paused || false,
      volume: Math.round((resp.volume || 0) * 100),
      inputDevice: resp.input_device || null,
      outputDevice: resp.output_device || null,
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private send(command: Command): Promise<EngineResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('Audio engine not running'));
        return;
      }

      this.pendingRequests.push({ resolve, reject });

      const json = JSON.stringify(command) + '\n';
      this.process.stdin.write(json, (err) => {
        if (err) {
          // Remove the pending request we just added
          this.pendingRequests.pop();
          reject(err);
        }
      });
    });
  }

  private handleLine(line: string): void {
    try {
      const response: EngineResponse = JSON.parse(line);
      const pending = this.pendingRequests.shift();
      if (pending) {
        pending.resolve(response);
      }
    } catch {
      console.warn(`[audio-engine] Non-JSON output: ${line}`);
    }
  }
}
