import express, { Request, Response, Router } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SoundpadClient from './soundpad-client';

const router: Router = express.Router();
const soundpadClient = new SoundpadClient();

// --- Multer setup for file uploads ---
const ALLOWED_AUDIO_EXTENSIONS = [
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus', '.aiff', '.ape'
];

const upload = multer({
  dest: path.join(os.tmpdir(), 'rage-pad-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(', ')}`));
    }
  }
});

// --- SSE config-watch setup ---
const soundlistPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Leppsoft',
  'soundlist.spl'
);

// Set of active SSE response objects
const sseClients = new Set<Response>();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

function notifySseClients(): void {
  for (const client of sseClients) {
    client.write('event: reload\ndata: {}\n\n');
  }
}

// Watch the soundlist.spl file for changes
if (fs.existsSync(soundlistPath)) {
  fs.watch(soundlistPath, (eventType) => {
    if (eventType === 'change') {
      // Debounce: Soundpad may write the file multiple times in quick succession
      if (debounceTimer) clearTimeout(debounceTimer);
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
} else {
  console.warn(`[config-watch] soundlist.spl not found at ${soundlistPath}; watcher not started`);
}

// Get connection status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const isConnected = await soundpadClient.isConnected();
    res.json({ connected: isConnected });
  } catch (error) {
    res.status(500).json({
      connected: false,
      error: 'Failed to check connection status'
    });
  }
});

// Get all sounds
router.get('/sounds', async (req: Request, res: Response) => {
  try {
    const result = await soundpadClient.getSoundList();
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sounds' });
  }
});

// Search sounds
router.get('/sounds/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string || '';
    const result = await soundpadClient.searchSounds(query);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to search sounds' });
  }
});

// Play a sound by index
router.post('/sounds/:index/play', async (req: Request, res: Response) => {
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
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to play sound' });
  }
});

// Stop current sound
router.post('/stop', async (req: Request, res: Response) => {
  try {
    const result = await soundpadClient.stopSound();
    if (result.success) {
      res.json({ message: 'Sound stopped' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop sound' });
  }
});

// Toggle pause
router.post('/pause', async (req: Request, res: Response) => {
  try {
    const result = await soundpadClient.togglePause();
    if (result.success) {
      res.json({ message: 'Pause toggled' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle pause' });
  }
});

// Set volume
router.post('/volume', async (req: Request, res: Response) => {
  try {
    const { volume } = req.body;
    if (typeof volume !== 'number' || volume < 0 || volume > 100) {
      res.status(400).json({ error: 'Volume must be a number between 0 and 100' });
      return;
    }

    const result = await soundpadClient.setVolume(volume);
    if (result.success) {
      res.json({ message: 'Volume set', volume });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to set volume' });
  }
});

// Rename a sound by index
router.post('/sounds/:index/rename', async (req: Request, res: Response) => {
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
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename sound' });
  }
});

// Restart Soundpad (optionally with rename: renames the tag in soundlist.spl then kills/relaunches Soundpad)
router.post('/restart', async (req: Request, res: Response) => {
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
      const result = await soundpadClient.restartSoundpad(index as number, (title as string).trim());
      sseSuppressed = false;
      if (result.success) {
        console.log('[restart] Soundpad restarted with rename – notifying SSE clients');
        notifySseClients();
        res.json({ message: 'Sound renamed and Soundpad restarting', data: result.data });
      } else {
        res.status(500).json({ error: result.error });
      }
    } else {
      // Plain restart without rename
      const result = await soundpadClient.restartSoundpadOnly();
      sseSuppressed = false;
      if (result.success) {
        console.log('[restart] Soundpad restarted – notifying SSE clients');
        notifySseClients();
        res.json({ message: 'Soundpad restarting', data: result.data });
      } else {
        res.status(500).json({ error: result.error });
      }
    }
  } catch (error) {
    sseSuppressed = false;
    res.status(500).json({ error: 'Failed to restart Soundpad' });
  }
});

// Serve category images from local file system
router.get('/category-image', async (req: Request, res: Response) => {
  try {
    const imagePath = req.query.path as string;

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
    const mimeTypes: { [key: string]: string } = {
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
  } catch (error) {
    console.error('Error serving category image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Get category icons from soundlist.spl
router.get('/category-icons', async (req: Request, res: Response) => {
  try {
    const result = await soundpadClient.getCategoryIcons();
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get category icons' });
  }
});

// Get categories list (for add-sound modal dropdown)
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const categories = soundpadClient.getCategoriesList();
    res.json(categories);
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// Add a new sound file to Soundpad
router.post('/sounds/add', upload.single('soundFile'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No sound file uploaded' });
      return;
    }

    const categoryName = req.body.category as string;
    if (!categoryName) {
      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(400).json({ error: 'Category name is required' });
      return;
    }

    // Optional custom display name provided by the user
    const displayName = (req.body.displayName as string | undefined)?.trim() || undefined;

    // Optional artist and title metadata
    const artist = typeof req.body.artist === 'string' ? req.body.artist : '';
    const title = typeof req.body.title === 'string' ? req.body.title : '';

    // Suppress SSE notifications while we kill/restart Soundpad.
    // The file watcher would otherwise fire before Soundpad is back up,
    // causing the client to hit a dead pipe and get an empty sound list.
    sseSuppressed = true;

    const result = await soundpadClient.addSound(
      req.file.path,
      req.file.originalname,
      categoryName,
      displayName,
      artist,
      title
    );

    // Re-enable SSE and notify clients now that Soundpad is ready
    sseSuppressed = false;

    if (result.success) {
      // Notify all SSE clients so they refresh their sound list
      console.log('[sounds/add] Sound added successfully – notifying SSE clients');
      notifySseClients();
      res.json({ message: result.data });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    // Always re-enable SSE on error
    sseSuppressed = false;

    // Clean up temp file on error
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }

    // Handle multer errors specifically
    if (error instanceof multer.MulterError) {
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

// SSE endpoint: client subscribes here to receive reload events
router.get('/config-watch', (req: Request, res: Response) => {
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

export default router;
