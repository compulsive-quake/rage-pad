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
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
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
console.log(`Server running on port ${PORT}`);
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
const server = app.listen(PORT, () => {
    console.log(`🎵 Rage Pad server running on http://localhost:${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}/api`);
    console.log(`🔗 Soundpad integration ready`);
});
// Graceful shutdown so nodemon can restart cleanly without EADDRINUSE
const shutdown = () => {
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
exports.default = app;
//# sourceMappingURL=index.js.map