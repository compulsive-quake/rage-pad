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
exports.initRoutes = initRoutes;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("./database");
const store_sync_1 = require("./store-sync");
// ── Module-level state (set by initRoutes) ─────────────────────────────────
let soundDb;
let audioEngine;
function initRoutes(db, engine) {
    soundDb = db;
    audioEngine = engine;
    return router;
}
const router = express_1.default.Router();
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
// --- SSE setup ---
const sseClients = new Set();
function notifySseClients() {
    for (const client of sseClients) {
        client.write('event: reload\ndata: {}\n\n');
    }
}
// ── Status ─────────────────────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
    try {
        const engineRunning = audioEngine.running;
        res.json({ connected: engineRunning });
    }
    catch {
        res.status(500).json({ connected: false, error: 'Failed to check status' });
    }
});
// ── Audio Devices ──────────────────────────────────────────────────────────
router.get('/audio/devices', async (_req, res) => {
    try {
        const devices = await audioEngine.listDevices();
        res.json(devices);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to list audio devices' });
    }
});
router.post('/audio/input-device', async (req, res) => {
    try {
        const { deviceName } = req.body;
        if (!deviceName || typeof deviceName !== 'string') {
            res.status(400).json({ error: 'deviceName is required' });
            return;
        }
        await audioEngine.setInputDevice(deviceName);
        res.json({ message: `Input device set to: ${deviceName}` });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to set input device';
        res.status(500).json({ error: msg });
    }
});
router.post('/audio/output-device', async (req, res) => {
    try {
        const { deviceName } = req.body;
        if (!deviceName || typeof deviceName !== 'string') {
            res.status(400).json({ error: 'deviceName is required' });
            return;
        }
        await audioEngine.setOutputDevice(deviceName);
        res.json({ message: `Output device set to: ${deviceName}` });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to set output device';
        res.status(500).json({ error: msg });
    }
});
// ── Sounds ─────────────────────────────────────────────────────────────────
router.get('/sounds', (_req, res) => {
    try {
        const sounds = soundDb.getAllSounds();
        res.json(sounds);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get sounds' });
    }
});
router.get('/sounds/search', (req, res) => {
    try {
        const query = req.query.q || '';
        const sounds = soundDb.searchSounds(query);
        res.json(sounds);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to search sounds' });
    }
});
// Play a sound by id
router.post('/sounds/:id/play', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        const filePath = soundDb.getSoundFilePath(id);
        if (!filePath || !fs.existsSync(filePath)) {
            res.status(404).json({ error: 'Sound file not found' });
            return;
        }
        const { speakersOnly = false, micOnly = false } = req.body;
        // Play through audio engine (mic/VB-Cable output) unless speakers-only.
        // Fire-and-forget: don't await the decode — respond immediately so the
        // client can start speaker playback with minimal latency.
        if (!speakersOnly) {
            audioEngine.playFireAndForget(filePath);
        }
        // Record the play
        soundDb.recordPlay(id);
        res.json({ message: 'Sound playing', speakersOnly, micOnly });
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Failed to play sound';
        res.status(500).json({ error: errMsg });
    }
});
router.post('/stop', async (_req, res) => {
    try {
        await audioEngine.stopPlayback();
        res.json({ message: 'Sound stopped' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to stop sound' });
    }
});
router.post('/pause', async (_req, res) => {
    try {
        // Get current status to determine if we should pause or resume
        const status = await audioEngine.getStatus();
        if (status.paused) {
            await audioEngine.resume();
        }
        else {
            await audioEngine.pause();
        }
        res.json({ message: 'Pause toggled' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to toggle pause' });
    }
});
router.post('/volume', async (req, res) => {
    try {
        const { volume } = req.body;
        if (typeof volume !== 'number' || volume < 0 || volume > 100) {
            res.status(400).json({ error: 'Volume must be a number between 0 and 100' });
            return;
        }
        await audioEngine.setVolume(volume);
        res.json({ message: 'Volume set', volume });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to set volume' });
    }
});
// Rename a sound by id
router.post('/sounds/:id/rename', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        const { title } = req.body;
        if (typeof title !== 'string' || !title.trim()) {
            res.status(400).json({ error: 'Title must be a non-empty string' });
            return;
        }
        const ok = soundDb.renameSound(id, title.trim());
        if (ok) {
            // Sync hook: find which category this sound belongs to and sync
            const allSounds = soundDb.getAllSounds();
            const sound = allSounds.find(s => s.id === id);
            if (sound)
                (0, store_sync_1.trySyncIfPublic)(soundDb, sound.category);
            notifySseClients();
            res.json({ message: 'Sound renamed' });
        }
        else {
            res.status(404).json({ error: 'Sound not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to rename sound' });
    }
});
// Update a sound's details
router.post('/sounds/:id/update-details', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        const { customTag, artist, category, icon, hideTitle, nsfw } = req.body;
        if (typeof customTag !== 'string' || !customTag.trim()) {
            res.status(400).json({ error: 'customTag must be a non-empty string' });
            return;
        }
        // Resolve category id if a category name was provided
        let categoryId;
        if (typeof category === 'string' && category.trim()) {
            const cat = soundDb.getCategoryByName(category.trim());
            if (cat) {
                categoryId = cat.id;
            }
            else {
                // Create the category if it doesn't exist
                categoryId = soundDb.getOrCreateCategory(category.trim());
            }
        }
        const ok = soundDb.updateSoundDetails(id, {
            title: customTag.trim(),
            artist: typeof artist === 'string' ? artist : undefined,
            categoryId,
            icon: typeof icon === 'string' ? icon : undefined,
            iconIsBase64: typeof icon === 'string' ? (icon.length > 0) : undefined,
            hideTitle: typeof hideTitle === 'boolean' ? hideTitle : undefined,
            nsfw: typeof nsfw === 'boolean' ? nsfw : undefined,
        });
        if (ok) {
            // Sync hook: sync the category this sound belongs to
            const updatedSound = soundDb.getAllSounds().find(s => s.id === id);
            if (updatedSound)
                (0, store_sync_1.trySyncIfPublic)(soundDb, updatedSound.category);
            notifySseClients();
            res.json({ message: 'Sound details updated' });
        }
        else {
            res.status(404).json({ error: 'Sound not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update sound details' });
    }
});
// Toggle NSFW flag on a sound
router.post('/sounds/:id/toggle-nsfw', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        const ok = soundDb.updateSoundDetails(id, {
            nsfw: req.body.nsfw === true,
        });
        if (ok) {
            notifySseClients();
            res.json({ message: 'Sound NSFW flag updated' });
        }
        else {
            res.status(404).json({ error: 'Sound not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update sound NSFW flag' });
    }
});
// Delete a sound by id
router.delete('/sounds/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        const deleted = soundDb.deleteSound(id);
        if (!deleted) {
            res.status(404).json({ error: 'Sound not found' });
            return;
        }
        // Delete the actual file
        const filePath = path.join(soundDb.getSoundsDir(), deleted.fileName);
        try {
            fs.unlinkSync(filePath);
        }
        catch { /* file may not exist */ }
        // Also delete uncropped backup if present
        const ext = path.extname(deleted.fileName);
        const base = path.basename(deleted.fileName, ext);
        const uncroppedPath = path.join(soundDb.getSoundsDir(), `${base}_uncropped${ext}`);
        try {
            fs.unlinkSync(uncroppedPath);
        }
        catch { /* ignore */ }
        // Sync hook: we need to find the category - look up from request context
        // Since the sound is deleted, check all public categories for sync
        const publicCats = soundDb.getPublicCategories();
        for (const cat of publicCats) {
            (0, store_sync_1.trySyncIfPublic)(soundDb, cat.name);
        }
        notifySseClients();
        res.json({ message: 'Sound deleted' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete sound' });
    }
});
// Reorder a sound
router.post('/sounds/reorder', (req, res) => {
    try {
        const { soundId, targetCategory, targetPosition } = req.body;
        if (typeof soundId !== 'number' || isNaN(soundId)) {
            res.status(400).json({ error: 'soundId must be a valid number' });
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
        // Resolve category by name
        const cat = soundDb.getCategoryByName(targetCategory.trim());
        if (!cat) {
            res.status(404).json({ error: `Category "${targetCategory}" not found` });
            return;
        }
        const ok = soundDb.reorderSound(soundId, cat.id, targetPosition);
        if (ok) {
            notifySseClients();
            res.json({ message: 'Sound reordered' });
        }
        else {
            res.status(404).json({ error: 'Sound not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to reorder sound' });
    }
});
// Reorder a category
router.post('/categories/reorder', (req, res) => {
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
        const cat = soundDb.getCategoryByName(categoryName.trim());
        if (!cat) {
            res.status(404).json({ error: `Category "${categoryName}" not found` });
            return;
        }
        const ok = soundDb.reorderCategory(cat.id, targetPosition);
        if (ok) {
            notifySseClients();
            res.json({ message: 'Category reordered' });
        }
        else {
            res.status(500).json({ error: 'Failed to reorder category' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to reorder category' });
    }
});
// ── Delete category ───────────────────────────────────────────────────────
router.delete('/categories/:name', (req, res) => {
    try {
        const categoryName = decodeURIComponent(req.params.name);
        // Remove from store server first if public
        (0, store_sync_1.removeCategoryFromStore)(soundDb, categoryName).catch(() => { });
        const deleted = soundDb.deleteCategory(categoryName);
        if (!deleted) {
            res.status(404).json({ error: 'Category not found' });
            return;
        }
        // Delete sound files from disk
        for (const fileName of deleted.fileNames) {
            const filePath = path.join(soundDb.getSoundsDir(), fileName);
            try {
                fs.unlinkSync(filePath);
            }
            catch { /* file may not exist */ }
            // Also delete uncropped backup if present
            const ext = path.extname(fileName);
            const base = path.basename(fileName, ext);
            const uncroppedPath = path.join(soundDb.getSoundsDir(), `${base}_uncropped${ext}`);
            try {
                fs.unlinkSync(uncroppedPath);
            }
            catch { /* ignore */ }
        }
        notifySseClients();
        res.json({ message: 'Category deleted' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete category' });
    }
});
// ── Category icons ─────────────────────────────────────────────────────────
router.get('/category-icons', (_req, res) => {
    try {
        const icons = soundDb.getCategoryIcons();
        res.json(icons);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get category icons' });
    }
});
router.put('/category-icon', (req, res) => {
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
        const ok = soundDb.setCategoryIcon(categoryName.trim(), iconBase64.trim());
        if (ok) {
            (0, store_sync_1.trySyncIfPublic)(soundDb, categoryName.trim());
            notifySseClients();
            res.json({ message: 'Category icon updated' });
        }
        else {
            res.status(404).json({ error: 'Category not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update category icon' });
    }
});
// ── Category NSFW ─────────────────────────────────────────────────────────
router.put('/category-nsfw', (req, res) => {
    try {
        const { categoryName, nsfw } = req.body;
        if (typeof categoryName !== 'string' || !categoryName.trim()) {
            res.status(400).json({ error: 'categoryName must be a non-empty string' });
            return;
        }
        if (typeof nsfw !== 'boolean') {
            res.status(400).json({ error: 'nsfw must be a boolean' });
            return;
        }
        const ok = soundDb.setCategoryNsfw(categoryName.trim(), nsfw);
        if (ok) {
            (0, store_sync_1.trySyncIfPublic)(soundDb, categoryName.trim());
            notifySseClients();
            res.json({ message: 'Category NSFW flag updated' });
        }
        else {
            res.status(404).json({ error: 'Category not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update category NSFW flag' });
    }
});
// ── Categories ─────────────────────────────────────────────────────────────
router.get('/categories', (_req, res) => {
    try {
        const categories = soundDb.getCategoriesList();
        res.json(categories);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get categories' });
    }
});
// ── Category Visibility ──────────────────────────────────────────────────
router.put('/category-visibility', async (req, res) => {
    try {
        const { categoryName, visibility } = req.body;
        if (typeof categoryName !== 'string' || !categoryName.trim()) {
            res.status(400).json({ error: 'categoryName must be a non-empty string' });
            return;
        }
        if (visibility !== 'private' && visibility !== 'public') {
            res.status(400).json({ error: 'visibility must be "private" or "public"' });
            return;
        }
        const ok = soundDb.setCategoryVisibility(categoryName.trim(), visibility);
        if (!ok) {
            res.status(404).json({ error: 'Category not found' });
            return;
        }
        // Trigger sync/unsync based on new visibility
        if (visibility === 'public') {
            (0, store_sync_1.syncCategoryToStore)(soundDb, categoryName.trim()).catch(err => {
                console.warn(`[store-sync] Failed to publish category "${categoryName}":`, err);
            });
        }
        else {
            (0, store_sync_1.removeCategoryFromStore)(soundDb, categoryName.trim()).catch(err => {
                console.warn(`[store-sync] Failed to unpublish category "${categoryName}":`, err);
            });
        }
        notifySseClients();
        res.json({ message: `Category visibility set to ${visibility}` });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update category visibility' });
    }
});
// ── Store proxy endpoints ──────────────────────────────────────────────────
router.get('/store/categories', async (_req, res) => {
    try {
        const storeUrl = (0, database_1.getSetting)('storeServerUrl') || 'http://localhost:9090';
        const response = await fetch(`${storeUrl}/api/categories`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            res.status(response.status).json({ error: 'Store server error' });
            return;
        }
        const data = await response.json();
        res.json(data);
    }
    catch (error) {
        res.status(502).json({ error: 'Cannot reach store server' });
    }
});
router.get('/store/categories/:id', async (req, res) => {
    try {
        const storeUrl = (0, database_1.getSetting)('storeServerUrl') || 'http://localhost:9090';
        const response = await fetch(`${storeUrl}/api/categories/${req.params.id}`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            res.status(response.status).json({ error: 'Store server error' });
            return;
        }
        const data = await response.json();
        // Reshape: the store server returns a flat object with sounds array;
        // the frontend expects { category: {...}, sounds: [...] }
        const { sounds, ...categoryFields } = data;
        res.json({ category: categoryFields, sounds: sounds || [] });
    }
    catch (error) {
        res.status(502).json({ error: 'Cannot reach store server' });
    }
});
// ── Local category names (for "already downloaded" check) ─────────────────
router.get('/store/local-category-names', (_req, res) => {
    try {
        const categories = soundDb.getCategoriesList();
        const names = categories.map((c) => c.name);
        res.json(names);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get local categories' });
    }
});
// ── Store sound file proxy (for preview playback) ─────────────────────────
router.get('/store/sound-file/:fileName', async (req, res) => {
    try {
        const storeUrl = (0, database_1.getSetting)('storeServerUrl') || 'http://localhost:9090';
        const fileName = req.params.fileName;
        const response = await fetch(`${storeUrl}/api/sound-files/${encodeURIComponent(fileName)}`, {
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
            res.status(response.status).json({ error: 'Store server error' });
            return;
        }
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    }
    catch (error) {
        res.status(502).json({ error: 'Cannot reach store server' });
    }
});
// ── Store download ─────────────────────────────────────────────────────────
router.post('/store/download/:categoryId', async (req, res) => {
    try {
        const storeUrl = (0, database_1.getSetting)('storeServerUrl') || 'http://localhost:9090';
        const categoryId = req.params.categoryId;
        // SSE headers for progress
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        const send = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        // Fetch manifest
        send('phase', { phase: 'fetching_manifest' });
        const manifestRes = await fetch(`${storeUrl}/api/categories/${categoryId}/download`, {
            signal: AbortSignal.timeout(15000),
        });
        if (!manifestRes.ok) {
            send('error', { message: 'Failed to fetch category manifest' });
            res.end();
            return;
        }
        const manifest = await manifestRes.json();
        // Create local category
        const localCatName = manifest.category.name;
        let localCatId = soundDb.getOrCreateCategory(localCatName);
        // Set icon if provided
        if (manifest.category.icon && manifest.category.icon_is_base64) {
            soundDb.setCategoryIcon(localCatName, manifest.category.icon);
        }
        // Download each sound
        const totalSounds = manifest.sounds.length;
        let downloaded = 0;
        send('phase', { phase: 'downloading_sounds', total: totalSounds });
        for (const sound of manifest.sounds) {
            try {
                const soundUrl = sound.download_url.startsWith('http')
                    ? sound.download_url
                    : `${storeUrl}${sound.download_url}`;
                const soundRes = await fetch(soundUrl, {
                    signal: AbortSignal.timeout(60000),
                });
                if (!soundRes.ok) {
                    console.warn(`[store-download] Failed to download sound "${sound.title}": ${soundRes.statusText}`);
                    downloaded++;
                    send('progress', { current: downloaded, total: totalSounds, title: sound.title, status: 'failed' });
                    continue;
                }
                const arrayBuffer = await soundRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                // Generate unique filename
                const ext = path.extname(sound.file_name).toLowerCase();
                const baseName = path.basename(sound.file_name, ext).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
                let fileName = `${baseName}${ext}`;
                let destPath = path.join(soundDb.getSoundsDir(), fileName);
                let counter = 1;
                while (fs.existsSync(destPath)) {
                    fileName = `${baseName}_${counter}${ext}`;
                    destPath = path.join(soundDb.getSoundsDir(), fileName);
                    counter++;
                }
                fs.writeFileSync(destPath, buffer);
                soundDb.addSound({
                    title: sound.title,
                    fileName,
                    artist: sound.artist || '',
                    durationMs: sound.duration_ms || 0,
                    categoryId: localCatId,
                    icon: sound.icon || '',
                    iconIsBase64: sound.icon_is_base64 || false,
                    hideTitle: sound.hide_title || false,
                });
                downloaded++;
                send('progress', { current: downloaded, total: totalSounds, title: sound.title, status: 'ok' });
            }
            catch (err) {
                downloaded++;
                send('progress', { current: downloaded, total: totalSounds, title: sound.title, status: 'failed' });
                console.warn(`[store-download] Error downloading sound "${sound.title}":`, err);
            }
        }
        notifySseClients();
        send('done', { categoryName: localCatName, totalDownloaded: downloaded });
        res.end();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to download category';
        try {
            res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        }
        catch { /* headers may already be sent */ }
        res.end();
    }
});
// ── Add sound ──────────────────────────────────────────────────────────────
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
        const displayName = req.body.displayName?.trim() || undefined;
        const artist = typeof req.body.artist === 'string' ? req.body.artist : '';
        const durationSeconds = parseInt(req.body.durationSeconds, 10) || 0;
        const icon = typeof req.body.icon === 'string' ? req.body.icon : '';
        const hideTitle = req.body.hideTitle === 'true' || req.body.hideTitle === '1';
        // Get or create the category
        const categoryId = soundDb.getOrCreateCategory(categoryName.trim());
        // Generate a unique filename
        const ext = path.extname(soundFile.originalname).toLowerCase();
        const baseName = displayName
            ? displayName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
            : path.basename(soundFile.originalname, ext).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        let fileName = `${baseName}${ext}`;
        let destPath = path.join(soundDb.getSoundsDir(), fileName);
        // Avoid collisions
        let counter = 1;
        while (fs.existsSync(destPath)) {
            fileName = `${baseName}_${counter}${ext}`;
            destPath = path.join(soundDb.getSoundsDir(), fileName);
            counter++;
        }
        // Copy uploaded file to sounds dir
        fs.copyFileSync(soundFile.path, destPath);
        try {
            fs.unlinkSync(soundFile.path);
        }
        catch { /* ignore */ }
        // Handle uncropped original backup
        let hasUncropped = false;
        if (originalFile) {
            const origExt = path.extname(originalFile.originalname).toLowerCase();
            const uncroppedName = `${path.basename(fileName, ext)}_uncropped${origExt}`;
            const uncroppedDest = path.join(soundDb.getSoundsDir(), uncroppedName);
            fs.copyFileSync(originalFile.path, uncroppedDest);
            try {
                fs.unlinkSync(originalFile.path);
            }
            catch { /* ignore */ }
            hasUncropped = true;
        }
        const soundTitle = displayName || path.basename(soundFile.originalname, ext);
        soundDb.addSound({
            title: soundTitle,
            fileName,
            artist,
            durationMs: durationSeconds * 1000,
            categoryId,
            hasUncropped,
            icon,
            iconIsBase64: icon.length > 0,
            hideTitle,
        });
        // Sync hook: sync the category if public
        (0, store_sync_1.trySyncIfPublic)(soundDb, categoryName.trim());
        notifySseClients();
        res.json({ message: `Sound "${soundTitle}" added` });
    }
    catch (error) {
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
// ── Stream sound audio ─────────────────────────────────────────────────────
router.get('/sounds/:id/audio', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        const filePath = soundDb.getSoundFilePath(id);
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
        res.status(500).json({ error: 'Failed to serve sound audio' });
    }
});
// ── Update sound file ──────────────────────────────────────────────────────
router.post('/sounds/:id/update-file', upload.single('soundFile'), (req, res) => {
    const soundFile = req.file;
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            if (soundFile)
                try {
                    fs.unlinkSync(soundFile.path);
                }
                catch { /* ignore */ }
            res.status(400).json({ error: 'Invalid sound id' });
            return;
        }
        if (!soundFile) {
            res.status(400).json({ error: 'No sound file uploaded' });
            return;
        }
        const currentPath = soundDb.getSoundFilePath(id);
        if (!currentPath) {
            try {
                fs.unlinkSync(soundFile.path);
            }
            catch { /* ignore */ }
            res.status(404).json({ error: 'Sound not found' });
            return;
        }
        // Overwrite the existing file
        fs.copyFileSync(soundFile.path, currentPath);
        try {
            fs.unlinkSync(soundFile.path);
        }
        catch { /* ignore */ }
        notifySseClients();
        res.json({ message: 'Sound file updated' });
    }
    catch (error) {
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
// ── Uncropped backups ──────────────────────────────────────────────────────
router.get('/sounds/uncropped-list', (_req, res) => {
    try {
        const list = soundDb.getUncroppedList();
        res.json({ urls: list.map(l => l.url) });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to list uncropped backups' });
    }
});
router.post('/sounds/reset-crop', (req, res) => {
    try {
        const { url: soundUrl } = req.body;
        if (!soundUrl || typeof soundUrl !== 'string') {
            res.status(400).json({ error: 'Sound URL is required' });
            return;
        }
        const ext = path.extname(soundUrl);
        const base = path.basename(soundUrl, ext);
        const dir = path.dirname(soundUrl);
        const uncroppedPath = path.join(dir, `${base}_uncropped${ext}`);
        if (!fs.existsSync(uncroppedPath)) {
            res.status(404).json({ error: 'Uncropped backup not found' });
            return;
        }
        // Replace cropped with uncropped
        fs.copyFileSync(uncroppedPath, soundUrl);
        fs.unlinkSync(uncroppedPath);
        // Update DB flag
        // Find the sound by matching its file path
        const fileName = path.basename(soundUrl);
        const sounds = soundDb.getAllSounds();
        const sound = sounds.find(s => path.basename(s.url) === fileName);
        if (sound) {
            soundDb.setHasUncropped(sound.id, false);
        }
        notifySseClients();
        res.json({ message: 'Crop reset successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to reset crop' });
    }
});
// ── YouTube fetch ──────────────────────────────────────────────────────────
function getYtDlpPath() {
    if (process.env['RAGE_PAD_YT_DLP'])
        return process.env['RAGE_PAD_YT_DLP'];
    const localBin = path.join(__dirname, '../../src-tauri/binaries/yt-dlp.exe');
    if (fs.existsSync(localBin))
        return localBin;
    return 'yt-dlp';
}
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
router.post('/youtube/fetch', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string') {
            res.status(400).json({ error: 'YouTube URL is required' });
            return;
        }
        const videoUrl = url.trim();
        const cacheKey = extractVideoId(videoUrl);
        // Check cache first
        const cached = ytCache.get(cacheKey);
        if (cached) {
            console.log(`[youtube/fetch] Cache hit for ${cacheKey}`);
            res.setHeader('Content-Type', cached.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cached.fileName)}"`);
            res.setHeader('X-Video-Title', encodeURIComponent(cached.title));
            res.setHeader('X-Video-Duration', String(cached.durationSeconds));
            res.setHeader('Access-Control-Expose-Headers', 'X-Video-Title, X-Video-Duration, Content-Disposition');
            res.send(cached.buffer);
            return;
        }
        const tmpDir = process.env['RAGE_PAD_TMP_DIR'] || os.tmpdir();
        let videoTitle = 'youtube_audio';
        let videoDurationSeconds = 0;
        let videoThumbnail = '';
        try {
            const metaJson = await runYtDlp([
                '--no-download', '-j', '--no-warnings', videoUrl
            ]);
            const meta = JSON.parse(metaJson);
            videoTitle = meta.title || meta.fulltitle || 'youtube_audio';
            videoDurationSeconds = meta.duration || 0;
            videoThumbnail = meta.thumbnail || '';
        }
        catch (metaErr) {
            console.warn('[youtube/fetch] Could not fetch metadata:', metaErr);
        }
        const safeTitle = videoTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'youtube_audio';
        const outTemplate = path.join(tmpDir, `${safeTitle}.%(ext)s`);
        await runYtDlp([
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '-o', outTemplate,
            '--no-playlist',
            '--no-warnings',
            '--force-overwrites',
            videoUrl
        ]);
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
        const ext = path.extname(outPath).slice(1);
        const mimeMap = {
            m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/opus',
            ogg: 'audio/ogg', mp3: 'audio/mpeg',
        };
        const fileBuffer = fs.readFileSync(outPath);
        try {
            fs.unlinkSync(outPath);
        }
        catch { /* ignore */ }
        const fileName = `${safeTitle}.${ext}`;
        const mimeType = mimeMap[ext] || 'application/octet-stream';
        // Store in URL cache
        ytCache.set(cacheKey, {
            buffer: fileBuffer,
            fileName,
            mimeType,
            title: videoTitle,
            durationSeconds: videoDurationSeconds,
            thumbnail: videoThumbnail,
            videoUrl: videoUrl,
            cachedAt: Date.now(),
        });
        res.setHeader('Content-Type', mimeType);
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
function getYtCacheTtl() {
    const minutes = (0, database_1.getSetting)('youtubeCacheTtlMinutes');
    return (minutes > 0 ? minutes : 4320) * 60 * 1000;
}
function getYtCacheMaxSizeBytes() {
    const mb = (0, database_1.getSetting)('youtubeCacheMaxSizeMb');
    return (mb > 0 ? mb : 100) * 1024 * 1024;
}
const ytCache = new Map();
function extractVideoId(url) {
    try {
        const u = new URL(url);
        if (u.hostname === 'youtu.be')
            return u.pathname.slice(1).split('/')[0];
        const v = u.searchParams.get('v');
        if (v)
            return v;
        const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
        if (embedMatch)
            return embedMatch[1];
    }
    catch { /* ignore */ }
    return url; // fallback: use raw URL as key
}
const tempDownloads = new Map();
setInterval(() => {
    const now = Date.now();
    const ttl = getYtCacheTtl();
    const maxBytes = getYtCacheMaxSizeBytes();
    for (const [id, entry] of tempDownloads) {
        if (now - entry.createdAt > 5 * 60 * 1000) {
            tempDownloads.delete(id);
        }
    }
    for (const [id, entry] of ytCache) {
        if (now - entry.cachedAt > ttl) {
            ytCache.delete(id);
        }
    }
    // Enforce max cache size
    enforceYtCacheMaxSize(maxBytes);
}, 60000);
function getYtCacheTotalSize() {
    let total = 0;
    for (const entry of ytCache.values()) {
        total += entry.buffer.length;
    }
    return total;
}
function enforceYtCacheMaxSize(maxBytes) {
    if (maxBytes <= 0)
        return;
    let totalSize = getYtCacheTotalSize();
    if (totalSize <= maxBytes)
        return;
    // Sort entries by cachedAt ascending (oldest first)
    const entries = [...ytCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    for (const [id, entry] of entries) {
        if (totalSize <= maxBytes)
            break;
        totalSize -= entry.buffer.length;
        ytCache.delete(id);
    }
}
// ── YouTube fetch with SSE progress ────────────────────────────────────────
router.get('/youtube/fetch-stream', async (req, res) => {
    const url = (req.query.url || '').trim();
    if (!url) {
        res.status(400).json({ error: 'YouTube URL is required' });
        return;
    }
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let killed = false;
    let ytProcess = null;
    req.on('close', () => {
        killed = true;
        if (ytProcess) {
            ytProcess.kill();
        }
    });
    const cacheKey = extractVideoId(url);
    try {
        // Check cache first
        const cached = ytCache.get(cacheKey);
        if (cached) {
            console.log(`[youtube/fetch-stream] Cache hit for ${cacheKey}`);
            sendEvent('metadata', { title: cached.title, durationSeconds: cached.durationSeconds, thumbnail: cached.thumbnail });
            const fileId = crypto_1.default.randomUUID();
            tempDownloads.set(fileId, {
                buffer: cached.buffer,
                fileName: cached.fileName,
                mimeType: cached.mimeType,
                title: cached.title,
                durationSeconds: cached.durationSeconds,
                createdAt: Date.now(),
            });
            sendEvent('done', { fileId, fileName: cached.fileName, title: cached.title, durationSeconds: cached.durationSeconds, cached: true });
            res.end();
            return;
        }
        // Phase 1: Metadata
        sendEvent('phase', { phase: 'metadata' });
        let videoTitle = 'youtube_audio';
        let videoDurationSeconds = 0;
        let videoThumbnail = '';
        try {
            const metaJson = await runYtDlp([
                '--no-download', '-j', '--no-warnings', url
            ]);
            const meta = JSON.parse(metaJson);
            videoTitle = meta.title || meta.fulltitle || 'youtube_audio';
            videoDurationSeconds = meta.duration || 0;
            videoThumbnail = meta.thumbnail || '';
        }
        catch (metaErr) {
            console.warn('[youtube/fetch-stream] Could not fetch metadata:', metaErr);
        }
        if (killed)
            return;
        sendEvent('metadata', { title: videoTitle, durationSeconds: videoDurationSeconds, thumbnail: videoThumbnail });
        // Phase 2: Download with progress
        sendEvent('phase', { phase: 'downloading' });
        const tmpDir = process.env['RAGE_PAD_TMP_DIR'] || os.tmpdir();
        const safeTitle = videoTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'youtube_audio';
        const outTemplate = path.join(tmpDir, `${safeTitle}.%(ext)s`);
        const ytDlpPath = getYtDlpPath();
        const args = [
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '-o', outTemplate,
            '--no-playlist',
            '--no-warnings',
            '--force-overwrites',
            '--newline',
            url
        ];
        await new Promise((resolve, reject) => {
            ytProcess = (0, child_process_1.spawn)(ytDlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            const progressRegex = /\[download]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\S+)\s+at\s+([\d.]+\S+\/s)\s+ETA\s+(\S+)/;
            let stderrChunks = '';
            ytProcess.stdout.on('data', (chunk) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    const match = line.match(progressRegex);
                    if (match) {
                        sendEvent('progress', {
                            percent: parseFloat(match[1]),
                            totalSize: match[2],
                            speed: match[3],
                            eta: match[4],
                        });
                    }
                }
            });
            ytProcess.stderr.on('data', (chunk) => {
                stderrChunks += chunk.toString();
            });
            ytProcess.on('close', (code) => {
                ytProcess = null;
                if (killed) {
                    reject(new Error('Aborted'));
                }
                else if (code !== 0) {
                    reject(new Error(stderrChunks || `yt-dlp exited with code ${code}`));
                }
                else {
                    resolve();
                }
            });
            ytProcess.on('error', (err) => {
                ytProcess = null;
                reject(err);
            });
        });
        if (killed)
            return;
        // Phase 3: Processing / finding output file
        sendEvent('phase', { phase: 'processing' });
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
            sendEvent('error', { message: 'yt-dlp did not produce an output file' });
            res.end();
            return;
        }
        const ext = path.extname(outPath).slice(1);
        const mimeMap = {
            m4a: 'audio/mp4', webm: 'audio/webm', opus: 'audio/opus',
            ogg: 'audio/ogg', mp3: 'audio/mpeg',
        };
        const fileBuffer = fs.readFileSync(outPath);
        try {
            fs.unlinkSync(outPath);
        }
        catch { /* ignore */ }
        const fileName = `${safeTitle}.${ext}`;
        const mimeType = mimeMap[ext] || 'application/octet-stream';
        // Store in URL cache
        ytCache.set(cacheKey, {
            buffer: fileBuffer,
            fileName,
            mimeType,
            title: videoTitle,
            durationSeconds: videoDurationSeconds,
            thumbnail: videoThumbnail,
            videoUrl: url,
            cachedAt: Date.now(),
        });
        const fileId = crypto_1.default.randomUUID();
        tempDownloads.set(fileId, {
            buffer: fileBuffer,
            fileName,
            mimeType,
            title: videoTitle,
            durationSeconds: videoDurationSeconds,
            createdAt: Date.now(),
        });
        sendEvent('done', { fileId, fileName, title: videoTitle, durationSeconds: videoDurationSeconds });
        res.end();
    }
    catch (error) {
        if (killed)
            return;
        const message = error instanceof Error ? error.message : 'Failed to fetch YouTube audio';
        console.error('[youtube/fetch-stream] Error:', error);
        sendEvent('error', { message });
        res.end();
    }
});
// ── Download completed YouTube file by ID ──────────────────────────────────
router.get('/youtube/download/:fileId', (req, res) => {
    const { fileId } = req.params;
    const entry = tempDownloads.get(fileId);
    if (!entry) {
        res.status(404).json({ error: 'File not found or expired' });
        return;
    }
    tempDownloads.delete(fileId);
    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.fileName)}"`);
    res.setHeader('X-Video-Title', encodeURIComponent(entry.title));
    res.setHeader('X-Video-Duration', String(entry.durationSeconds));
    res.setHeader('Access-Control-Expose-Headers', 'X-Video-Title, X-Video-Duration, Content-Disposition');
    res.send(entry.buffer);
});
// ── List cached YouTube videos ─────────────────────────────────────────────
router.get('/youtube/cache-list', (_req, res) => {
    try {
        const now = Date.now();
        const ttl = getYtCacheTtl();
        const items = [];
        for (const [videoId, entry] of ytCache) {
            if (now - entry.cachedAt > ttl)
                continue; // skip expired
            items.push({
                videoId,
                title: entry.title,
                thumbnail: entry.thumbnail,
                videoUrl: entry.videoUrl,
                durationSeconds: entry.durationSeconds,
                cachedAt: entry.cachedAt,
            });
        }
        // Sort by most recently cached first
        items.sort((a, b) => b.cachedAt - a.cachedAt);
        res.json(items);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to list cached YouTube videos' });
    }
});
// ── Clear YouTube cache ────────────────────────────────────────────────────
router.delete('/youtube/cache', (_req, res) => {
    try {
        const count = ytCache.size;
        ytCache.clear();
        console.log(`[youtube/cache] Cleared ${count} cached entries`);
        res.json({ message: `Cleared ${count} cached videos`, cleared: count });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to clear YouTube cache' });
    }
});
// ── YouTube cache info ─────────────────────────────────────────────────────
router.get('/youtube/cache-info', (_req, res) => {
    try {
        const totalSizeBytes = getYtCacheTotalSize();
        const entryCount = ytCache.size;
        const maxSizeMb = (0, database_1.getSetting)('youtubeCacheMaxSizeMb');
        const ttlMinutes = (0, database_1.getSetting)('youtubeCacheTtlMinutes');
        const cachePath = (0, database_1.getSetting)('youtubeCachePath');
        res.json({
            entryCount,
            totalSizeBytes,
            totalSizeMb: Math.round(totalSizeBytes / (1024 * 1024) * 100) / 100,
            maxSizeMb: maxSizeMb > 0 ? maxSizeMb : 500,
            ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 120,
            cachePath: cachePath || '',
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get cache info' });
    }
});
// ── Image proxy (avoids CORS issues with external thumbnails) ──────────────
router.get('/proxy-image', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        res.status(400).json({ error: 'url query parameter is required' });
        return;
    }
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'rage-pad/1.0' },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok || !response.body) {
            res.status(502).json({ error: 'Failed to fetch image' });
            return;
        }
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    }
    catch {
        res.status(502).json({ error: 'Failed to fetch image' });
    }
});
// ── VB-Cable status ─────────────────────────────────────────────────────────
router.get('/vbcable/status', async (_req, res) => {
    try {
        const devices = await audioEngine.listDevices();
        const allDevices = [...devices.input, ...devices.output];
        const inputDevice = devices.input.find(d => d.toUpperCase().includes('CABLE')) || null;
        const outputDevice = devices.output.find(d => d.toUpperCase().includes('CABLE')) || null;
        const installed = !!(inputDevice || outputDevice);
        res.json({ installed, devices: allDevices, inputDevice, outputDevice });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to check VB-Cable status' });
    }
});
// ── SSE endpoint ───────────────────────────────────────────────────────────
router.get('/config-watch', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
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
//# sourceMappingURL=routes.js.map