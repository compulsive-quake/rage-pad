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
const soundpad_client_1 = __importDefault(require("./soundpad-client"));
const router = express_1.default.Router();
const soundpadClient = new soundpad_client_1.default();
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
// Set play mode
router.post('/play-mode', async (req, res) => {
    try {
        const { mode } = req.body;
        if (typeof mode !== 'number') {
            res.status(400).json({ error: 'Mode must be a number' });
            return;
        }
        const result = await soundpadClient.setPlayMode(mode);
        if (result.success) {
            res.json({ message: 'Play mode set', mode });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to set play mode' });
    }
});
// Set speakers only mode
router.post('/speakers-only', async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ error: 'Enabled must be a boolean' });
            return;
        }
        const result = await soundpadClient.setSpeakersOnly(enabled);
        if (result.success) {
            res.json({ message: 'Speakers only mode set', enabled });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to set speakers only mode' });
    }
});
// Restart Soundpad
router.post('/restart', async (req, res) => {
    try {
        const result = await soundpadClient.restartSoundpad();
        if (result.success) {
            res.json({ message: 'Soundpad restarting' });
        }
        else {
            res.status(500).json({ error: result.error });
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
exports.default = router;
//# sourceMappingURL=routes.js.map