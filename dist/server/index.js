"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const routes_1 = __importDefault(require("./routes"));
const database_1 = require("./database");
const app = (0, express_1.default)();
const startupPort = Number(process.env.PORT) || (0, database_1.getSetting)('serverPort');
let currentPort = startupPort;
// Redirect ytdl-core debug files (e.g. player-script.js) to ./tmp instead of
// the project root.  The tmp directory is listed in .gitignore.
// When packaged as a Tauri sidecar, RAGE_PAD_TMP_DIR points to a writable location.
const ytdlTmpDir = process.env['RAGE_PAD_TMP_DIR']
    ? path_1.default.resolve(process.env['RAGE_PAD_TMP_DIR'])
    : path_1.default.resolve(__dirname, '../../tmp');
if (!fs_1.default.existsSync(ytdlTmpDir)) {
    fs_1.default.mkdirSync(ytdlTmpDir, { recursive: true });
}
process.env.YTDL_DEBUG_PATH = ytdlTmpDir;
// Clean up any stale ytdl debug files left in tmp from previous runs.
try {
    const staleFiles = fs_1.default.readdirSync(ytdlTmpDir).filter(f => f.endsWith('-player-script.js'));
    for (const f of staleFiles) {
        try {
            fs_1.default.unlinkSync(path_1.default.join(ytdlTmpDir, f));
        }
        catch { /* ignore */ }
    }
    if (staleFiles.length > 0) {
        console.log(`[startup] Cleaned up ${staleFiles.length} stale ytdl debug file(s) from tmp/`);
    }
}
catch { /* ignore */ }
console.log(`Server running on port ${startupPort}`);
// Middleware
app.use((0, cors_1.default)({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// API Routes
app.use('/api', routes_1.default);
// Serve Angular static files in production.
// When packaged as a Tauri sidecar, RAGE_PAD_CLIENT_DIST points to the
// Angular build that Tauri bundles as resources alongside the installer.
const clientDistPath = process.env['RAGE_PAD_CLIENT_DIST']
    ? path_1.default.resolve(process.env['RAGE_PAD_CLIENT_DIST'])
    : path_1.default.join(__dirname, '../../client/dist/rage-pad-client/browser');
app.use(express_1.default.static(clientDistPath));
// Return the port the server is currently listening on
app.get('/api/current-port', (_req, res) => {
    res.json({ port: currentPort });
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
    // Try to start a new listener on the requested port
    const newServer = app.listen(newPort, () => {
        const oldPort = currentPort;
        currentPort = newPort;
        // Persist the new port to the database
        (0, database_1.setSetting)('serverPort', newPort);
        // Re-attach graceful-shutdown handlers to the new server instance
        const shutdownNew = () => {
            (0, database_1.closeDb)();
            newServer.close(() => process.exit(0));
        };
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
        process.on('SIGTERM', shutdownNew);
        process.on('SIGINT', shutdownNew);
        console.log(`[port-change] Switched from port ${oldPort} to ${newPort}`);
        res.json({ port: newPort, message: `Server moved to port ${newPort}` });
        // Close the old listener after a short delay so the response can flush
        setTimeout(() => {
            server.close(() => {
                console.log(`[port-change] Old listener on port ${oldPort} closed`);
            });
            // Promote the new server so future port-changes close the right one
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
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Catch-all route for Angular routing (SPA)
app.get('*', (req, res) => {
    // Only serve index.html for non-API routes
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
    console.log(`Soundpad integration ready`);
});
// Graceful shutdown so nodemon can restart cleanly without EADDRINUSE
const shutdown = () => {
    (0, database_1.closeDb)();
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
exports.default = app;
//# sourceMappingURL=index.js.map