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
const multer_1 = __importDefault(require("multer"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const soundpad_client_1 = __importDefault(require("./soundpad-client"));
const router = express_1.default.Router();
const soundpadClient = new soundpad_client_1.default();
// --- Multer setup for file uploads ---
const ALLOWED_AUDIO_EXTENSIONS = [
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus', '.aiff', '.ape'
];
const upload = (0, multer_1.default)({
    dest: path.join(os.tmpdir(), 'rage-pad-uploads'),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
            cb(null, true);
        }
        else {
            cb(new Error(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(', ')}`));
        }
    }
});
// --- SSE config-watch setup ---
const soundlistPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Leppsoft', 'soundlist.spl');
// Set of active SSE response objects
const sseClients = new Set();
let debounceTimer = null;
/**
 * When true, the file-system watcher will NOT broadcast SSE reload events.
 * This is set during operations that kill Soundpad, edit soundlist.spl, and
 * relaunch Soundpad.  Without this guard the watcher fires as soon as the
 * file is written – before Soundpad is back up – causing the client to call
 * GetSoundlist() against a dead pipe and receive an empty/error response.
 *
 * The operation that sets this flag is responsible for calling
 * notifySseClients() explicitly once Soundpad is confirmed ready.
 */
let sseSuppressed = false;
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
                if (sseSuppressed) {
                    console.log('[config-watch] soundlist.spl changed – SSE suppressed (operation in progress)');
                    return;
                }
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
            // Check if the error is due to Soundpad not running (ENOENT pipe error)
            const isSoundpadNotRunning = result.error?.includes('ENOENT') ||
                result.error?.includes('sp_remote_control');
            if (isSoundpadNotRunning) {
                res.status(503).json({ error: result.error, soundpadNotRunning: true });
            }
            else {
                res.status(500).json({ error: result.error });
            }
        }
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Failed to play sound';
        const isSoundpadNotRunning = errMsg.includes('ENOENT') || errMsg.includes('sp_remote_control');
        if (isSoundpadNotRunning) {
            res.status(503).json({ error: errMsg, soundpadNotRunning: true });
        }
        else {
            res.status(500).json({ error: errMsg });
        }
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
// Update a sound's details (tag, artist, title, and optionally move to a different category)
router.post('/sounds/:index/update-details', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        if (isNaN(index)) {
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        const { customTag, artist, title, category } = req.body;
        if (typeof customTag !== 'string' || !customTag.trim()) {
            res.status(400).json({ error: 'customTag must be a non-empty string' });
            return;
        }
        sseSuppressed = true;
        const result = await soundpadClient.updateSoundDetails(index, customTag.trim(), typeof artist === 'string' ? artist : '', typeof title === 'string' ? title : '', typeof category === 'string' && category.trim() ? category.trim() : undefined);
        sseSuppressed = false;
        if (result.success) {
            notifySseClients();
            res.json({ message: 'Sound details updated', data: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        res.status(500).json({ error: 'Failed to update sound details' });
    }
});
// Delete a sound by index (removes from SPL, deletes file, restarts Soundpad)
router.delete('/sounds/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        if (isNaN(index)) {
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        // Suppress SSE while Soundpad is being restarted
        sseSuppressed = true;
        const result = await soundpadClient.deleteSound(index);
        // Re-enable SSE and notify clients
        sseSuppressed = false;
        if (result.success) {
            notifySseClients();
            res.json({ message: 'Sound deleted', data: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        res.status(500).json({ error: 'Failed to delete sound' });
    }
});
// Reorder a sound (move to a different category/position)
router.post('/sounds/reorder', async (req, res) => {
    try {
        const { soundIndex, targetCategory, targetPosition } = req.body;
        if (typeof soundIndex !== 'number' || isNaN(soundIndex)) {
            res.status(400).json({ error: 'soundIndex must be a valid number' });
            return;
        }
        if (typeof targetCategory !== 'string' || !targetCategory.trim()) {
            res.status(400).json({ error: 'targetCategory must be a non-empty string' });
            return;
        }
        if (typeof targetPosition !== 'number' || isNaN(targetPosition) || targetPosition < 0) {
            res.status(400).json({ error: 'targetPosition must be a non-negative number' });
            return;
        }
        // Suppress SSE while Soundpad is being restarted
        sseSuppressed = true;
        const result = await soundpadClient.reorderSound(soundIndex, targetCategory.trim(), targetPosition);
        // Re-enable SSE and notify clients
        sseSuppressed = false;
        if (result.success) {
            notifySseClients();
            res.json({ message: 'Sound reordered', data: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        res.status(500).json({ error: 'Failed to reorder sound' });
    }
});
// Reorder a category (move to a different position in the category list)
router.post('/categories/reorder', async (req, res) => {
    try {
        const { categoryName, targetPosition } = req.body;
        if (typeof categoryName !== 'string' || !categoryName.trim()) {
            res.status(400).json({ error: 'categoryName must be a non-empty string' });
            return;
        }
        if (typeof targetPosition !== 'number' || isNaN(targetPosition) || targetPosition < 0) {
            res.status(400).json({ error: 'targetPosition must be a non-negative number' });
            return;
        }
        sseSuppressed = true;
        const result = await soundpadClient.reorderCategory(categoryName.trim(), targetPosition);
        sseSuppressed = false;
        if (result.success) {
            notifySseClients();
            res.json({ message: 'Category reordered', data: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        res.status(500).json({ error: 'Failed to reorder category' });
    }
});
// Launch Soundpad if it is not already running
router.post('/launch-soundpad', async (req, res) => {
    try {
        const result = await soundpadClient.launchSoundpad();
        if (result.success) {
            res.json({ message: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to launch Soundpad' });
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
        // Suppress SSE while Soundpad is being restarted
        sseSuppressed = true;
        if (hasRename) {
            const result = await soundpadClient.restartSoundpad(index, title.trim());
            sseSuppressed = false;
            if (result.success) {
                console.log('[restart] Soundpad restarted with rename – notifying SSE clients');
                notifySseClients();
                res.json({ message: 'Sound renamed and Soundpad restarting', data: result.data });
            }
            else {
                res.status(500).json({ error: result.error });
            }
        }
        else {
            // Plain restart without rename
            const result = await soundpadClient.restartSoundpadOnly();
            sseSuppressed = false;
            if (result.success) {
                console.log('[restart] Soundpad restarted – notifying SSE clients');
                notifySseClients();
                res.json({ message: 'Soundpad restarting', data: result.data });
            }
            else {
                res.status(500).json({ error: result.error });
            }
        }
    }
    catch (error) {
        sseSuppressed = false;
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
// Update a category's icon (base64 image data)
router.put('/category-icon', async (req, res) => {
    try {
        const { categoryName, iconBase64 } = req.body;
        if (typeof categoryName !== 'string' || !categoryName.trim()) {
            res.status(400).json({ error: 'categoryName must be a non-empty string' });
            return;
        }
        if (typeof iconBase64 !== 'string' || !iconBase64.trim()) {
            res.status(400).json({ error: 'iconBase64 must be a non-empty string' });
            return;
        }
        sseSuppressed = true;
        const result = await soundpadClient.setCategoryIcon(categoryName.trim(), iconBase64.trim());
        sseSuppressed = false;
        if (result.success) {
            notifySseClients();
            res.json({ message: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        res.status(500).json({ error: 'Failed to update category icon' });
    }
});
// Get categories list (for add-sound modal dropdown)
router.get('/categories', async (req, res) => {
    try {
        const categories = soundpadClient.getCategoriesList();
        res.json(categories);
    }
    catch (error) {
        console.error('Error getting categories:', error);
        res.status(500).json({ error: 'Failed to get categories' });
    }
});
// Add a new sound file to Soundpad
const addSoundUpload = upload.fields([
    { name: 'soundFile', maxCount: 1 },
    { name: 'originalFile', maxCount: 1 },
]);
router.post('/sounds/add', addSoundUpload, async (req, res) => {
    const files = req.files;
    const soundFile = files?.['soundFile']?.[0];
    const originalFile = files?.['originalFile']?.[0];
    try {
        if (!soundFile) {
            res.status(400).json({ error: 'No sound file uploaded' });
            return;
        }
        const categoryName = req.body.category;
        if (!categoryName) {
            // Clean up temp files
            try {
                fs.unlinkSync(soundFile.path);
            }
            catch { /* ignore */ }
            if (originalFile)
                try {
                    fs.unlinkSync(originalFile.path);
                }
                catch { /* ignore */ }
            res.status(400).json({ error: 'Category name is required' });
            return;
        }
        // Optional custom display name provided by the user
        const displayName = req.body.displayName?.trim() || undefined;
        // Optional artist and title metadata
        const artist = typeof req.body.artist === 'string' ? req.body.artist : '';
        const title = typeof req.body.title === 'string' ? req.body.title : '';
        // Optional duration in seconds
        const durationSeconds = parseInt(req.body.durationSeconds, 10) || 0;
        // Suppress SSE notifications while we kill/restart Soundpad.
        // The file watcher would otherwise fire before Soundpad is back up,
        // causing the client to hit a dead pipe and get an empty sound list.
        sseSuppressed = true;
        const result = await soundpadClient.addSound(soundFile.path, soundFile.originalname, categoryName, displayName, artist, title, durationSeconds, originalFile ? originalFile.path : undefined, originalFile ? originalFile.originalname : undefined);
        // Re-enable SSE and notify clients now that Soundpad is ready
        sseSuppressed = false;
        if (result.success) {
            // Notify all SSE clients so they refresh their sound list
            console.log('[sounds/add] Sound added successfully – notifying SSE clients');
            notifySseClients();
            res.json({ message: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        // Always re-enable SSE on error
        sseSuppressed = false;
        // Clean up temp files on error
        if (soundFile) {
            try {
                fs.unlinkSync(soundFile.path);
            }
            catch { /* ignore */ }
        }
        if (originalFile) {
            try {
                fs.unlinkSync(originalFile.path);
            }
            catch { /* ignore */ }
        }
        // Handle multer errors specifically
        if (error instanceof multer_1.default.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                res.status(413).json({ error: 'File too large. Maximum size is 100 MB.' });
                return;
            }
            res.status(400).json({ error: `Upload error: ${error.message}` });
            return;
        }
        if (error instanceof Error) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Failed to add sound' });
    }
});
// Stream a sound's audio file by index
router.get('/sounds/:index/audio', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        if (isNaN(index)) {
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        const filePath = soundpadClient.getSoundFilePath(index);
        if (!filePath || !fs.existsSync(filePath)) {
            res.status(404).json({ error: 'Sound file not found' });
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
            '.aac': 'audio/aac',
            '.wma': 'audio/x-ms-wma',
            '.m4a': 'audio/mp4',
            '.opus': 'audio/opus',
            '.aiff': 'audio/aiff',
            '.ape': 'audio/x-ape',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const fileName = path.basename(filePath);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
    }
    catch (error) {
        console.error('Error serving sound audio:', error);
        res.status(500).json({ error: 'Failed to serve sound audio' });
    }
});
// Update a sound's audio file by index
router.post('/sounds/:index/update-file', upload.single('soundFile'), async (req, res) => {
    const soundFile = req.file;
    try {
        const index = parseInt(req.params.index, 10);
        if (isNaN(index)) {
            if (soundFile)
                try {
                    fs.unlinkSync(soundFile.path);
                }
                catch { /* ignore */ }
            res.status(400).json({ error: 'Invalid sound index' });
            return;
        }
        if (!soundFile) {
            res.status(400).json({ error: 'No sound file uploaded' });
            return;
        }
        sseSuppressed = true;
        const result = await soundpadClient.updateSoundFile(index, soundFile.path, soundFile.originalname);
        sseSuppressed = false;
        if (result.success) {
            console.log('[sounds/update-file] Sound file updated – notifying SSE clients');
            notifySseClients();
            res.json({ message: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        if (soundFile) {
            try {
                fs.unlinkSync(soundFile.path);
            }
            catch { /* ignore */ }
        }
        if (error instanceof multer_1.default.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                res.status(413).json({ error: 'File too large. Maximum size is 100 MB.' });
                return;
            }
            res.status(400).json({ error: `Upload error: ${error.message}` });
            return;
        }
        if (error instanceof Error) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: 'Failed to update sound file' });
    }
});
// Return list of sound URLs that have uncropped backups
router.get('/sounds/uncropped-list', async (req, res) => {
    try {
        const soundsDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Leppsoft', 'sounds');
        if (!fs.existsSync(soundsDir)) {
            res.json({ urls: [] });
            return;
        }
        const files = fs.readdirSync(soundsDir);
        const uncroppedFiles = files.filter(f => f.includes('_uncropped'));
        // Map uncropped filenames back to the original sound URL
        const urls = [];
        for (const uf of uncroppedFiles) {
            const ext = path.extname(uf);
            const base = path.basename(uf, ext).replace(/_uncropped$/, '');
            // The cropped file could have any audio extension
            const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus', '.aiff', '.ape'];
            for (const aExt of audioExts) {
                const croppedPath = path.join(soundsDir, `${base}${aExt}`);
                if (fs.existsSync(croppedPath)) {
                    urls.push(croppedPath);
                    break;
                }
            }
        }
        res.json({ urls });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to list uncropped backups' });
    }
});
// Restore the uncropped backup for a sound
router.post('/sounds/reset-crop', async (req, res) => {
    try {
        const { url: soundUrl } = req.body;
        if (!soundUrl || typeof soundUrl !== 'string') {
            res.status(400).json({ error: 'Sound URL is required' });
            return;
        }
        sseSuppressed = true;
        const result = await soundpadClient.resetCrop(soundUrl);
        sseSuppressed = false;
        if (result.success) {
            console.log('[sounds/reset-crop] Crop reset successfully – notifying SSE clients');
            notifySseClients();
            res.json({ message: result.data });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        sseSuppressed = false;
        res.status(500).json({ error: 'Failed to reset crop' });
    }
});
/** Resolve the path to the yt-dlp binary. In Tauri builds the RAGE_PAD_YT_DLP
 *  env var points to the bundled exe; in dev mode fall back to the build dir
 *  or assume yt-dlp is on PATH. */
function getYtDlpPath() {
    if (process.env['RAGE_PAD_YT_DLP'])
        return process.env['RAGE_PAD_YT_DLP'];
    const localBin = path.join(__dirname, '../../src-tauri/binaries/yt-dlp.exe');
    if (fs.existsSync(localBin))
        return localBin;
    return 'yt-dlp'; // assume on PATH
}
/** Run yt-dlp and return stdout as a string. */
function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(getYtDlpPath(), args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            }
            else {
                resolve(stdout);
            }
        });
    });
}
// YouTube audio fetch endpoint (uses yt-dlp binary)
router.post('/youtube/fetch', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string') {
            res.status(400).json({ error: 'YouTube URL is required' });
            return;
        }
        const videoUrl = url.trim();
        const tmpDir = process.env['RAGE_PAD_TMP_DIR'] || os.tmpdir();
        // Step 1: Get video metadata (title, duration) via yt-dlp -j
        let videoTitle = 'youtube_audio';
        let videoDurationSeconds = 0;
        try {
            const metaJson = await runYtDlp([
                '--no-download', '-j', '--no-warnings', videoUrl
            ]);
            const meta = JSON.parse(metaJson);
            videoTitle = meta.title || meta.fulltitle || 'youtube_audio';
            videoDurationSeconds = meta.duration || 0;
        }
        catch (metaErr) {
            console.warn('[youtube/fetch] Could not fetch metadata:', metaErr);
        }
        const safeTitle = videoTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'youtube_audio';
        // Use yt-dlp's output template; the actual extension is determined by format
        const outTemplate = path.join(tmpDir, `${safeTitle}.%(ext)s`);
        // Step 2: Download best audio natively (m4a/webm — no ffmpeg needed)
        await runYtDlp([
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '-o', outTemplate,
            '--no-playlist',
            '--no-warnings',
            '--force-overwrites',
            videoUrl
        ]);
        // yt-dlp replaces %(ext)s with the actual extension; find the output file
        const possibleExts = ['m4a', 'webm', 'opus', 'ogg', 'mp3'];
        let outPath = '';
        for (const ext of possibleExts) {
            const candidate = path.join(tmpDir, `${safeTitle}.${ext}`);
            if (fs.existsSync(candidate)) {
                outPath = candidate;
                break;
            }
        }
        if (!outPath) {
            res.status(500).json({ error: 'yt-dlp did not produce an output file' });
            return;
        }
        const ext = path.extname(outPath).slice(1); // e.g. "m4a"
        const mimeMap = {
            m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/opus',
            ogg: 'audio/ogg', mp3: 'audio/mpeg',
        };
        const fileBuffer = fs.readFileSync(outPath);
        // Clean up temp file
        try {
            fs.unlinkSync(outPath);
        }
        catch { /* ignore */ }
        const fileName = `${safeTitle}.${ext}`;
        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('X-Video-Title', encodeURIComponent(videoTitle));
        res.setHeader('X-Video-Duration', String(videoDurationSeconds));
        res.setHeader('Access-Control-Expose-Headers', 'X-Video-Title, X-Video-Duration, Content-Disposition');
        res.send(fileBuffer);
    }
    catch (error) {
        console.error('[youtube/fetch] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch YouTube audio';
        res.status(500).json({ error: message });
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