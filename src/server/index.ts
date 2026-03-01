import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import { spawn } from 'child_process';
import QRCode from 'qrcode';
import { initRoutes } from './routes';
import { SoundDb } from './sound-db';
import { AudioEngine } from './audio-engine';

import { getSetting, getAllSettings, setSetting, updateSettings, closeDb, dataDir as dbDataDir } from './database';

// ── File logging for release builds ─────────────────────────────────────────
function setupLogging(): void {
  const dataDir = process.env['RAGE_PAD_DATA_DIR'];
  if (!dataDir) return; // dev mode — keep default console behaviour

  const logPath = path.join(dataDir, 'server.log');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  const timestamp = () => new Date().toISOString();

  console.log = (...args: unknown[]) => {
    logStream.write(`[${timestamp()}] [LOG] ${args.join(' ')}\n`);
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    logStream.write(`[${timestamp()}] [ERROR] ${args.join(' ')}\n`);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    logStream.write(`[${timestamp()}] [WARN] ${args.join(' ')}\n`);
    origWarn(...args);
  };

  process.on('uncaughtException', (err) => {
    const msg = `[${timestamp()}] [FATAL] Uncaught exception: ${err.stack || err.message}\n`;
    logStream.write(msg);
    origError(msg);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = `[${timestamp()}] [FATAL] Unhandled rejection: ${reason}\n`;
    logStream.write(msg);
    origError(msg);
    process.exit(1);
  });
}

setupLogging();

// ── Initialize SQLite database ──────────────────────────────────────────────

const dataDir = process.env['RAGE_PAD_DATA_DIR']
  ? path.resolve(process.env['RAGE_PAD_DATA_DIR'])
  : path.resolve(__dirname, '../../data');

const dbPath = path.join(dataDir, 'ragepad.db');
const soundsDir = path.join(dataDir, 'sounds');
const soundDb = new SoundDb(dbPath, soundsDir);

// ── Initialize audio engine ─────────────────────────────────────────────────

const audioEngine = new AudioEngine();
audioEngine.start();

// Apply saved audio device settings
const savedInputDevice = getSetting('audioInputDevice');
const savedOutputDevice = getSetting('audioOutputDevice');

if (savedInputDevice) {
  audioEngine.setInputDevice(savedInputDevice).catch(err => {
    console.warn(`[audio-engine] Could not restore input device "${savedInputDevice}":`, err.message);
  });
}
if (savedOutputDevice) {
  audioEngine.setOutputDevice(savedOutputDevice).catch(err => {
    console.warn(`[audio-engine] Could not restore output device "${savedOutputDevice}":`, err.message);
  });
}

audioEngine.on('exit', (code: number | null) => {
  console.warn(`[audio-engine] Process exited (code ${code}), restarting...`);
  setTimeout(() => audioEngine.start(), 1000);
});

// ── Express app ─────────────────────────────────────────────────────────────

const app: Application = express();
const startupPort = Number(process.env.PORT) || getSetting('serverPort');
let currentPort = startupPort;

console.log(`Server running on port ${startupPort}`);

// Middleware
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
const routes = initRoutes(soundDb, audioEngine);
app.use('/api', routes);

// Serve Angular static files in production.
const clientDistPath = process.env['RAGE_PAD_CLIENT_DIST']
  ? path.resolve(process.env['RAGE_PAD_CLIENT_DIST'])
  : path.join(__dirname, '../../client/dist/rage-pad-client/browser');
app.use(express.static(clientDistPath));

// Return the port the server is currently listening on
app.get('/api/current-port', (_req: Request, res: Response) => {
  res.json({ port: currentPort });
});

// Return a QR code image for connecting from another device on the LAN
app.get('/api/qr-code', async (_req: Request, res: Response) => {
  const nets = os.networkInterfaces();
  let lanIp = '';
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        lanIp = addr.address;
        break;
      }
    }
    if (lanIp) break;
  }
  const host = lanIp || 'localhost';
  const url = `http://${host}:${currentPort}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#ffffffff', light: '#00000000' },
    });
    res.json({ url, qrDataUrl: dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ── Update download & install ────────────────────────────────────────────────

function httpsGetFollowRedirects(url: string, onResponse: (res: import('http').IncomingMessage) => void, onError: (err: Error) => void): void {
  https.get(url, { headers: { 'User-Agent': 'RagePad' } }, (res) => {
    if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
      httpsGetFollowRedirects(res.headers.location, onResponse, onError);
    } else {
      onResponse(res);
    }
  }).on('error', onError);
}

let downloadedInstallerPath = '';

app.get('/api/download-update', (req: Request, res: Response) => {
  const downloadUrl = req.query['url'] as string;
  if (!downloadUrl) {
    res.status(400).json({ error: 'Missing url query parameter' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const filename = path.basename(new URL(downloadUrl).pathname);
  const destPath = path.join(os.tmpdir(), filename);

  httpsGetFollowRedirects(downloadUrl, (dlRes) => {
    if (dlRes.statusCode !== 200) {
      send('error', { message: `HTTP ${dlRes.statusCode}` });
      res.end();
      return;
    }

    const totalBytes = parseInt(dlRes.headers['content-length'] || '0', 10);
    let receivedBytes = 0;
    const fileStream = fs.createWriteStream(destPath);

    dlRes.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      fileStream.write(chunk);
      if (totalBytes > 0) {
        send('progress', { received: receivedBytes, total: totalBytes, percent: Math.round((receivedBytes / totalBytes) * 100) });
      }
    });

    dlRes.on('end', () => {
      fileStream.end(() => {
        downloadedInstallerPath = destPath;
        send('done', { path: destPath });
        res.end();
      });
    });

    dlRes.on('error', (err) => {
      fileStream.end();
      send('error', { message: err.message });
      res.end();
    });
  }, (err) => {
    send('error', { message: err.message });
    res.end();
  });
});

app.post('/api/launch-installer', (_req: Request, res: Response) => {
  if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
    res.status(400).json({ error: 'No downloaded installer found' });
    return;
  }
  spawn(`"${downloadedInstallerPath}"`, [], { detached: true, stdio: 'ignore', shell: true }).unref();
  res.json({ ok: true });

  setTimeout(() => process.exit(0), 500);
});

// ── VB-Cable install (SSE) ───────────────────────────────────────────────

const VBCABLE_ZIP_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';

app.get('/api/vbcable/install', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const zipPath = path.join(os.tmpdir(), 'VBCABLE_Driver_Pack45.zip');
  const extractDir = path.join(os.tmpdir(), 'vbcable_extract');

  httpsGetFollowRedirects(VBCABLE_ZIP_URL, (dlRes) => {
    if (dlRes.statusCode !== 200) {
      send('error', { message: `HTTP ${dlRes.statusCode}` });
      res.end();
      return;
    }

    const totalBytes = parseInt(dlRes.headers['content-length'] || '0', 10);
    let receivedBytes = 0;
    const fileStream = fs.createWriteStream(zipPath);

    dlRes.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      fileStream.write(chunk);
      if (totalBytes > 0) {
        send('progress', { received: receivedBytes, total: totalBytes, percent: Math.round((receivedBytes / totalBytes) * 100) });
      }
    });

    dlRes.on('end', () => {
      fileStream.end(() => {
        send('extracting', {});

        // Clean up previous extraction if present
        if (fs.existsSync(extractDir)) {
          fs.rmSync(extractDir, { recursive: true, force: true });
        }

        // Extract using PowerShell
        const psExtract = spawn('powershell', [
          '-NoProfile', '-Command',
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let psStderr = '';
        psExtract.stderr.on('data', (chunk: Buffer) => { psStderr += chunk.toString(); });

        psExtract.on('close', (code) => {
          // Clean up the zip
          try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

          if (code !== 0) {
            send('error', { message: `Extract failed: ${psStderr || `exit code ${code}`}` });
            res.end();
            return;
          }

          // Find the installer executable
          const installerName = 'VBCABLE_Setup_x64.exe';
          const installerPath = path.join(extractDir, installerName);

          if (!fs.existsSync(installerPath)) {
            send('error', { message: `Installer not found at ${installerPath}` });
            res.end();
            return;
          }

          send('installing', {});

          // Save current default devices, install VB-Cable, then restore defaults.
          // Windows automatically sets newly-installed audio devices as the default,
          // so we capture the current defaults and restore them after installation.
          const installScript = `
$ErrorActionPreference = 'SilentlyContinue'

# ── Capture current default playback & recording device IDs ──
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorClass { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
    int OpenPropertyStore(int access, out IntPtr props);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}

[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig {
    int GetMixFormat(string deviceId, IntPtr format);
    int GetDeviceFormat(string deviceId, int def, IntPtr format);
    int ResetDeviceFormat(string deviceId);
    int SetDeviceFormat(string deviceId, IntPtr format, IntPtr mixFormat);
    int GetProcessingPeriod(string deviceId, int def, long defaultPeriod, long minPeriod);
    int SetProcessingPeriod(string deviceId, long period);
    int GetShareMode(string deviceId, IntPtr mode);
    int SetShareMode(string deviceId, IntPtr mode);
    int GetPropertyValue(string deviceId, IntPtr key, IntPtr value);
    int SetPropertyValue(string deviceId, IntPtr key, IntPtr value);
    int SetDefaultEndpoint(string deviceId, int role);
    int SetEndpointVisibility(string deviceId, int visible);
}

[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
internal class PolicyConfigClass { }

public static class AudioDefaults {
    public static string GetDefaultId(int dataFlow) {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorClass());
        IntPtr devicePtr;
        int hr = enumerator.GetDefaultAudioEndpoint(dataFlow, 0, out devicePtr);
        if (hr != 0) return "";
        var device = (IMMDevice)Marshal.GetObjectForIUnknown(devicePtr);
        string id;
        device.GetId(out id);
        Marshal.ReleaseComObject(device);
        Marshal.ReleaseComObject(enumerator);
        return id ?? "";
    }
    public static void SetDefault(string deviceId, int role) {
        if (string.IsNullOrEmpty(deviceId)) return;
        var policy = (IPolicyConfig)(new PolicyConfigClass());
        policy.SetDefaultEndpoint(deviceId, role);
        Marshal.ReleaseComObject(policy);
    }
}
'@ -IgnoreStandardError 2>$null

$playbackId = [AudioDefaults]::GetDefaultId(0)
$recordingId = [AudioDefaults]::GetDefaultId(1)

# ── Run VB-Cable installer ──
Start-Process -FilePath '${installerPath.replace(/'/g, "''")}' -ArgumentList '-i','-h' -Verb RunAs -Wait

# ── Restore original defaults (all three roles: Console=0, Multimedia=1, Communications=2) ──
if ($playbackId) {
    [AudioDefaults]::SetDefault($playbackId, 0)
    [AudioDefaults]::SetDefault($playbackId, 1)
    [AudioDefaults]::SetDefault($playbackId, 2)
}
if ($recordingId) {
    [AudioDefaults]::SetDefault($recordingId, 0)
    [AudioDefaults]::SetDefault($recordingId, 1)
    [AudioDefaults]::SetDefault($recordingId, 2)
}
`;

          const installer = spawn('powershell', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', installScript
          ], { stdio: ['ignore', 'pipe', 'pipe'] });

          let installStderr = '';
          installer.stderr.on('data', (chunk: Buffer) => { installStderr += chunk.toString(); });

          installer.on('close', (installCode) => {
            // Clean up extracted files
            try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }

            if (installCode !== 0) {
              send('error', { message: installStderr || `Installer exited with code ${installCode}` });
            } else {
              send('done', {});
            }
            res.end();
          });

          installer.on('error', (err) => {
            try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
            send('error', { message: err.message });
            res.end();
          });
        });

        psExtract.on('error', (err) => {
          try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
          send('error', { message: err.message });
          res.end();
        });
      });
    });

    dlRes.on('error', (err) => {
      fileStream.end();
      send('error', { message: err.message });
      res.end();
    });
  }, (err) => {
    send('error', { message: err.message });
    res.end();
  });
});

// ── VB-Cable auto-select ────────────────────────────────────────────────

app.post('/api/vbcable/auto-select', async (_req: Request, res: Response) => {
  try {
    const devices = await audioEngine.listDevices();
    const outputDevice = devices.output.find(d => d.toUpperCase().includes('CABLE'));
    if (!outputDevice) {
      res.status(404).json({ error: 'VB-Cable output device not found' });
      return;
    }
    await audioEngine.setOutputDevice(outputDevice);
    setSetting('audioOutputDevice', outputDevice);
    res.json({ message: `Output device set to: ${outputDevice}`, device: outputDevice });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to auto-select VB-Cable';
    res.status(500).json({ error: msg });
  }
});

// ── Audio engine restart ────────────────────────────────────────────────

app.post('/api/audio/restart-engine', async (_req: Request, res: Response) => {
  try {
    await audioEngine.stop();
    audioEngine.start();

    // Restore saved device settings
    const savedInput = getSetting('audioInputDevice');
    const savedOutput = getSetting('audioOutputDevice');
    if (savedInput) {
      await audioEngine.setInputDevice(savedInput).catch(err => {
        console.warn(`[restart-engine] Could not restore input device:`, err.message);
      });
    }
    if (savedOutput) {
      await audioEngine.setOutputDevice(savedOutput).catch(err => {
        console.warn(`[restart-engine] Could not restore output device:`, err.message);
      });
    }

    res.json({ message: 'Audio engine restarted' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to restart audio engine';
    res.status(500).json({ error: msg });
  }
});

// ── Settings API ─────────────────────────────────────────────────────────────

app.get('/api/settings', (_req: Request, res: Response) => {
  res.json({ ...getAllSettings(), dataDir: dbDataDir });
});

app.post('/api/browse-folder', (req: Request, res: Response) => {
  const startDir = (req.body.startDir as string) || dbDataDir;
  // Use PowerShell to open a native folder picker dialog
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select YouTube cache folder'
$dialog.SelectedPath = '${startDir.replace(/'/g, "''")}'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq 'OK') {
  Write-Output $dialog.SelectedPath
} else {
  Write-Output ''
}
`;
  const ps = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  ps.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

  ps.on('close', () => {
    const selected = stdout.trim();
    res.json({ path: selected });
  });

  ps.on('error', () => {
    res.json({ path: '' });
  });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const body = { ...req.body };
  // Port changes go through /api/change-port — strip it here
  delete body.serverPort;
  const updated = updateSettings(body);

  // Apply audio device changes immediately
  if (body.audioInputDevice !== undefined) {
    audioEngine.setInputDevice(body.audioInputDevice).catch(err => {
      console.warn(`[settings] Could not set input device:`, err.message);
    });
  }
  if (body.audioOutputDevice !== undefined) {
    audioEngine.setOutputDevice(body.audioOutputDevice).catch(err => {
      console.warn(`[settings] Could not set output device:`, err.message);
    });
  }

  res.json(updated);
});

// Change the server port at runtime
app.post('/api/change-port', (req: Request, res: Response) => {
  const { port } = req.body;
  const newPort = Number(port);

  if (!Number.isInteger(newPort) || newPort < 1024 || newPort > 65535) {
    res.status(400).json({ error: 'Port must be an integer between 1024 and 65535' });
    return;
  }

  if (newPort === currentPort) {
    res.json({ port: currentPort, message: 'Already listening on this port' });
    return;
  }

  const newServer = app.listen(newPort, () => {
    const oldPort = currentPort;
    currentPort = newPort;

    setSetting('serverPort', newPort);

    const shutdownNew = () => {
      audioEngine.stop().then(() => {
        soundDb.close();
        closeDb();
        newServer.close(() => process.exit(0));
      });
    };
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.on('SIGTERM', shutdownNew);
    process.on('SIGINT', shutdownNew);

    console.log(`[port-change] Switched from port ${oldPort} to ${newPort}`);
    res.json({ port: newPort, message: `Server moved to port ${newPort}` });

    setTimeout(() => {
      server.close(() => {
        console.log(`[port-change] Old listener on port ${oldPort} closed`);
      });
      server = newServer;
    }, 500);
  });

  newServer.on('error', (err: NodeJS.ErrnoException) => {
    const message = err.code === 'EADDRINUSE'
      ? `Port ${newPort} is already in use`
      : `Failed to listen on port ${newPort}: ${err.message}`;
    res.status(409).json({ error: message });
  });
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all route for Angular routing (SPA)
app.get('*', (req: Request, res: Response) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
let server = app.listen(startupPort, () => {
  console.log(`Rage Pad server running on http://localhost:${startupPort}`);
  console.log(`API available at http://localhost:${startupPort}/api`);
  console.log(`Audio engine ready`);
});

// Graceful shutdown
const shutdown = () => {
  audioEngine.stop().then(() => {
    soundDb.close();
    closeDb();
    server.close(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
