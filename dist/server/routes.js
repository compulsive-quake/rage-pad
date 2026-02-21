"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const soundpad_client_1 = __importDefault(require("./soundpad-client"));
const router = express_1.default.Router();
const soundpadClient = new soundpad_client_1.default();
// --- SSE config-watch setup ---
const soundlistPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Leppsoft', 'soundlist.spl');
// Set of active SSE response objects
const sseClients = new Set();
let debounceTimer = null;
function notifySseClients() {
    for (const client of sseClients) {
        client.write('event: reload\ndata: {}\n\n');
    }
}
// Watch the soundlist.spl file for changes
if (fs.existsSync(soundlistPath)) {
    fs.watch(soundlistPath, (eventType) => {
        if (eventType === 'change') {
            // Debounce: Soundpad may write the file multiple times in quick succession
            if (debounceTimer)
                clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                console.log('[config-watch] soundlist.spl changed – notifying clients');
                notifySseClients();
            }, 300);
        }
    });
    console.log(`[config-watch] Watching ${soundlistPath}`);
}
else {
    console.warn(`[config-watch] soundlist.spl not found at ${soundlistPath}; watcher not started`);
}
// Get connection status
router.get('/status', async (req, res) => {
    try {
        const isConnected = await soundpadClient.isConnected();
        res.json({ connected: isConnected });
    }
    catch (error) {
        res.status(500).json({
            connected: false,
            error: 'Failed to check connection status'
        });
    }
});
// Get all sounds
router.get('/sounds', async (req, res) => {
    try {
        const result = await soundpadClient.getSoundList();
        if (result.success) {
            res.json(result.data);
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get sounds' });
    }
});
// Search sounds
router.get('/sounds/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        const result = await soundpadClient.searchSounds(query);
        if (result.success) {
            res.json(result.data);
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to search sounds' });
    }
});
// Play a sound by index
router.post('/sounds/:index/play', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        if (isNaN(index)) {
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        const { speakersOnly = false, micOnly = false } = req.body;
        const result = await soundpadClient.playSound(index, speakersOnly, micOnly);
        if (result.success) {
            res.json({ message: 'Sound playing', data: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to play sound' });
    }
});
// Stop current sound
router.post('/stop', async (req, res) => {
    try {
        const result = await soundpadClient.stopSound();
        if (result.success) {
            res.json({ message: 'Sound stopped' });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to stop sound' });
    }
});
// Toggle pause
router.post('/pause', async (req, res) => {
    try {
        const result = await soundpadClient.togglePause();
        if (result.success) {
            res.json({ message: 'Pause toggled' });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to toggle pause' });
    }
});
// Set volume
router.post('/volume', async (req, res) => {
    try {
        const { volume } = req.body;
        if (typeof volume !== 'number' || volume < 0 || volume > 100) {
            res.status(400).json({ error: 'Volume must be a number between 0 and 100' });
            return;
        }
        const result = await soundpadClient.setVolume(volume);
        if (result.success) {
            res.json({ message: 'Volume set', volume });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to set volume' });
    }
});
// Rename a sound by index
router.post('/sounds/:index/rename', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        if (isNaN(index)) {
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        const { title } = req.body;
        if (typeof title !== 'string' || !title.trim()) {
            res.status(400).json({ error: 'Title must be a non-empty string' });
            return;
        }
        const result = await soundpadClient.renameSound(index, title.trim());
        if (result.success) {
            res.json({ message: 'Sound renamed', data: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to rename sound' });
    }
});
// Restart Soundpad (optionally with rename: renames the tag in soundlist.spl then kills/relaunches Soundpad)
router.post('/restart', async (req, res) => {
    try {
        const index = req.body.index !== undefined ? parseInt(req.body.index, 10) : undefined;
        const { title } = req.body;
        const hasRename = index !== undefined && typeof title === 'string' && title.trim();
        if (index !== undefined && isNaN(index)) {
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        if (hasRename) {
            const result = await soundpadClient.restartSoundpad(index, title.trim());
            if (result.success) {
                res.json({ message: 'Sound renamed and Soundpad restarting', data: result.data });
            }
            else {
                res.status(500).json({ error: result.error });
            }
        }
        else {
            // Plain restart without rename
            const result = await soundpadClient.restartSoundpadOnly();
            if (result.success) {
                res.json({ message: 'Soundpad restarting', data: result.data });
            }
            else {
                res.status(500).json({ error: result.error });
            }
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to restart Soundpad' });
    }
});
// Serve category images from local file system
router.get('/category-image', async (req, res) => {
    try {
        const imagePath = req.query.path;
        if (!imagePath) {
            res.status(400).json({ error: 'Image path is required' });
            return;
        }
        // Normalize the path (handle both forward and backslashes)
        const normalizedPath = imagePath.replace(/\//g, path.sep);
        // Check if file exists
        if (!fs.existsSync(normalizedPath)) {
            res.status(404).json({ error: 'Image not found' });
            return;
        }
        // Get the file extension to set the correct content type
        const ext = path.extname(normalizedPath).toLowerCase();
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.ico': 'image/x-icon',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        // Stream the file
        const fileStream = fs.createReadStream(normalizedPath);
        fileStream.pipe(res);
    }
    catch (error) {
        console.error('Error serving category image:', error);
        res.status(500).json({ error: 'Failed to serve image' });
    }
});
// Get category icons from soundlist.spl
router.get('/category-icons', async (req, res) => {
    try {
        const result = await soundpadClient.getCategoryIcons();
        if (result.success) {
            res.json(result.data);
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get category icons' });
    }
});
// SSE endpoint: client subscribes here to receive reload events
router.get('/config-watch', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
    res.flushHeaders();
    // Send a heartbeat comment every 15 s to keep the connection alive
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);
    sseClients.add(res);
    console.log(`[config-watch] Client connected (total: ${sseClients.size})`);
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        console.log(`[config-watch] Client disconnected (total: ${sseClients.size})`);
    });
});
exports.default = router;
//# sourceMappingURL=routes.js.map