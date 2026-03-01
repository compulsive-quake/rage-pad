"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const https_1 = __importDefault(require("https"));
const child_process_1 = require("child_process");
const qrcode_1 = __importDefault(require("qrcode"));
const routes_1 = require("./routes");
const sound_db_1 = require("./sound-db");
const audio_engine_1 = require("./audio-engine");
const database_1 = require("./database");
// ── File logging for release builds ─────────────────────────────────────────
function setupLogging() {
    const dataDir = process.env['RAGE_PAD_DATA_DIR'];
    if (!dataDir)
        return; // dev mode — keep default console behaviour
    const logPath = path_1.default.join(dataDir, 'server.log');
    if (!fs_1.default.existsSync(dataDir)) {
        fs_1.default.mkdirSync(dataDir, { recursive: true });
    }
    const logStream = fs_1.default.createWriteStream(logPath, { flags: 'a' });
    const origLog = console.log.bind(console);
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const timestamp = () => new Date().toISOString();
    console.log = (...args) => {
        logStream.write(`[${timestamp()}] [LOG] ${args.join(' ')}\n`);
        origLog(...args);
    };
    console.error = (...args) => {
        logStream.write(`[${timestamp()}] [ERROR] ${args.join(' ')}\n`);
        origError(...args);
    };
    console.warn = (...args) => {
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
    ? path_1.default.resolve(process.env['RAGE_PAD_DATA_DIR'])
    : path_1.default.resolve(__dirname, '../../data');
const dbPath = path_1.default.join(dataDir, 'ragepad.db');
const soundsDir = path_1.default.join(dataDir, 'sounds');
const soundDb = new sound_db_1.SoundDb(dbPath, soundsDir);
// ── Initialize audio engine ─────────────────────────────────────────────────
const audioEngine = new audio_engine_1.AudioEngine();
audioEngine.start();
// Apply saved audio device settings
const savedInputDevice = (0, database_1.getSetting)('audioInputDevice');
const savedOutputDevice = (0, database_1.getSetting)('audioOutputDevice');
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
audioEngine.on('exit', (code) => {
    console.warn(`[audio-engine] Process exited (code ${code}), restarting...`);
    setTimeout(() => audioEngine.start(), 1000);
});
// ── Express app ─────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
const startupPort = Number(process.env.PORT) || (0, database_1.getSetting)('serverPort');
let currentPort = startupPort;
console.log(`Server running on port ${startupPort}`);
// Middleware
app.use((0, cors_1.default)({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// API Routes
const routes = (0, routes_1.initRoutes)(soundDb, audioEngine);
app.use('/api', routes);
// Serve Angular static files in production.
const clientDistPath = process.env['RAGE_PAD_CLIENT_DIST']
    ? path_1.default.resolve(process.env['RAGE_PAD_CLIENT_DIST'])
    : path_1.default.join(__dirname, '../../client/dist/rage-pad-client/browser');
app.use(express_1.default.static(clientDistPath));
// Return the port the server is currently listening on
app.get('/api/current-port', (_req, res) => {
    res.json({ port: currentPort });
});
// Return a QR code image for connecting from another device on the LAN
app.get('/api/qr-code', async (_req, res) => {
    const nets = os_1.default.networkInterfaces();
    let lanIp = '';
    for (const iface of Object.values(nets)) {
        if (!iface)
            continue;
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                lanIp = addr.address;
                break;
            }
        }
        if (lanIp)
            break;
    }
    const host = lanIp || 'localhost';
    const url = `http://${host}:${currentPort}`;
    try {
        const dataUrl = await qrcode_1.default.toDataURL(url, {
            width: 300,
            margin: 2,
            color: { dark: '#ffffffff', light: '#00000000' },
        });
        res.json({ url, qrDataUrl: dataUrl });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});
// ── Update download & install ────────────────────────────────────────────────
function httpsGetFollowRedirects(url, onResponse, onError) {
    https_1.default.get(url, { headers: { 'User-Agent': 'RagePad' } }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            httpsGetFollowRedirects(res.headers.location, onResponse, onError);
        }
        else {
            onResponse(res);
        }
    }).on('error', onError);
}
let downloadedInstallerPath = '';
app.get('/api/download-update', (req, res) => {
    const downloadUrl = req.query['url'];
    if (!downloadUrl) {
        res.status(400).json({ error: 'Missing url query parameter' });
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const filename = path_1.default.basename(new URL(downloadUrl).pathname);
    const destPath = path_1.default.join(os_1.default.tmpdir(), filename);
    httpsGetFollowRedirects(downloadUrl, (dlRes) => {
        if (dlRes.statusCode !== 200) {
            send('error', { message: `HTTP ${dlRes.statusCode}` });
            res.end();
            return;
        }
        const totalBytes = parseInt(dlRes.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        const fileStream = fs_1.default.createWriteStream(destPath);
        dlRes.on('data', (chunk) => {
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
app.post('/api/launch-installer', (_req, res) => {
    if (!downloadedInstallerPath || !fs_1.default.existsSync(downloadedInstallerPath)) {
        res.status(400).json({ error: 'No downloaded installer found' });
        return;
    }
    (0, child_process_1.spawn)(`"${downloadedInstallerPath}"`, [], { detached: true, stdio: 'ignore', shell: true }).unref();
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 500);
});
// ── VB-Cable install (SSE) ───────────────────────────────────────────────
const VBCABLE_ZIP_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';
app.get('/api/vbcable/install', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const zipPath = path_1.default.join(os_1.default.tmpdir(), 'VBCABLE_Driver_Pack45.zip');
    const extractDir = path_1.default.join(os_1.default.tmpdir(), 'vbcable_extract');
    httpsGetFollowRedirects(VBCABLE_ZIP_URL, (dlRes) => {
        if (dlRes.statusCode !== 200) {
            send('error', { message: `HTTP ${dlRes.statusCode}` });
            res.end();
            return;
        }
        const totalBytes = parseInt(dlRes.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        const fileStream = fs_1.default.createWriteStream(zipPath);
        dlRes.on('data', (chunk) => {
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
                if (fs_1.default.existsSync(extractDir)) {
                    fs_1.default.rmSync(extractDir, { recursive: true, force: true });
                }
                // Extract using PowerShell
                const psExtract = (0, child_process_1.spawn)('powershell', [
                    '-NoProfile', '-Command',
                    `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`
                ], { stdio: ['ignore', 'pipe', 'pipe'] });
                let psStderr = '';
                psExtract.stderr.on('data', (chunk) => { psStderr += chunk.toString(); });
                psExtract.on('close', (code) => {
                    // Clean up the zip
                    try {
                        fs_1.default.unlinkSync(zipPath);
                    }
                    catch { /* ignore */ }
                    if (code !== 0) {
                        send('error', { message: `Extract failed: ${psStderr || `exit code ${code}`}` });
                        res.end();
                        return;
                    }
                    // Find the installer executable
                    const installerName = 'VBCABLE_Setup_x64.exe';
                    const installerPath = path_1.default.join(extractDir, installerName);
                    if (!fs_1.default.existsSync(installerPath)) {
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
                    const installer = (0, child_process_1.spawn)('powershell', [
                        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', installScript
                    ], { stdio: ['ignore', 'pipe', 'pipe'] });
                    let installStderr = '';
                    installer.stderr.on('data', (chunk) => { installStderr += chunk.toString(); });
                    installer.on('close', (installCode) => {
                        // Clean up extracted files
                        try {
                            fs_1.default.rmSync(extractDir, { recursive: true, force: true });
                        }
                        catch { /* ignore */ }
                        if (installCode !== 0) {
                            send('error', { message: installStderr || `Installer exited with code ${installCode}` });
                        }
                        else {
                            send('done', {});
                        }
                        res.end();
                    });
                    installer.on('error', (err) => {
                        try {
                            fs_1.default.rmSync(extractDir, { recursive: true, force: true });
                        }
                        catch { /* ignore */ }
                        send('error', { message: err.message });
                        res.end();
                    });
                });
                psExtract.on('error', (err) => {
                    try {
                        fs_1.default.unlinkSync(zipPath);
                    }
                    catch { /* ignore */ }
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
app.post('/api/vbcable/auto-select', async (_req, res) => {
    try {
        const devices = await audioEngine.listDevices();
        const outputDevice = devices.output.find(d => d.toUpperCase().includes('CABLE'));
        if (!outputDevice) {
            res.status(404).json({ error: 'VB-Cable output device not found' });
            return;
        }
        await audioEngine.setOutputDevice(outputDevice);
        (0, database_1.setSetting)('audioOutputDevice', outputDevice);
        res.json({ message: `Output device set to: ${outputDevice}`, device: outputDevice });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to auto-select VB-Cable';
        res.status(500).json({ error: msg });
    }
});
// ── Audio engine restart ────────────────────────────────────────────────
app.post('/api/audio/restart-engine', async (_req, res) => {
    try {
        await audioEngine.stop();
        audioEngine.start();
        // Restore saved device settings
        const savedInput = (0, database_1.getSetting)('audioInputDevice');
        const savedOutput = (0, database_1.getSetting)('audioOutputDevice');
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
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to restart audio engine';
        res.status(500).json({ error: msg });
    }
});
// ── Settings API ─────────────────────────────────────────────────────────────
app.get('/api/settings', (_req, res) => {
    res.json({ ...(0, database_1.getAllSettings)(), dataDir: database_1.dataDir });
});
app.post('/api/browse-folder', (req, res) => {
    const startDir = req.body.startDir || database_1.dataDir;
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
    const ps = (0, child_process_1.spawn)('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    ps.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    ps.on('close', () => {
        const selected = stdout.trim();
        res.json({ path: selected });
    });
    ps.on('error', () => {
        res.json({ path: '' });
    });
});
app.put('/api/settings', (req, res) => {
    const body = { ...req.body };
    // Port changes go through /api/change-port — strip it here
    delete body.serverPort;
    const updated = (0, database_1.updateSettings)(body);
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
app.post('/api/change-port', (req, res) => {
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
        (0, database_1.setSetting)('serverPort', newPort);
        const shutdownNew = () => {
            audioEngine.stop().then(() => {
                soundDb.close();
                (0, database_1.closeDb)();
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
    newServer.on('error', (err) => {
        const message = err.code === 'EADDRINUSE'
            ? `Port ${newPort} is already in use`
            : `Failed to listen on port ${newPort}: ${err.message}`;
        res.status(409).json({ error: message });
    });
});
// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Catch-all route for Angular routing (SPA)
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path_1.default.join(clientDistPath, 'index.html'));
    }
    else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});
// Error handling middleware
app.use((err, req, res) => {
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
        (0, database_1.closeDb)();
        server.close(() => process.exit(0));
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
exports.default = app;
//# sourceMappingURL=index.js.map