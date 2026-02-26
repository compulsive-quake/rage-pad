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
// ── Settings API ─────────────────────────────────────────────────────────────
app.get('/api/settings', (_req, res) => {
    res.json((0, database_1.getAllSettings)());
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