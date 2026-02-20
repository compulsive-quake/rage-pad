import express, { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import SoundpadClient from './soundpad-client';

const router: Router = express.Router();
const soundpadClient = new SoundpadClient();

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

// Set play mode
router.post('/play-mode', async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    if (typeof mode !== 'number') {
      res.status(400).json({ error: 'Mode must be a number' });
      return;
    }

    const result = await soundpadClient.setPlayMode(mode);
    if (result.success) {
      res.json({ message: 'Play mode set', mode });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to set play mode' });
  }
});

// Set speakers only mode
router.post('/speakers-only', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Enabled must be a boolean' });
      return;
    }
    
    const result = await soundpadClient.setSpeakersOnly(enabled);
    if (result.success) {
      res.json({ message: 'Speakers only mode set', enabled });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to set speakers only mode' });
  }
});

// Restart Soundpad
router.post('/restart', async (req: Request, res: Response) => {
  try {
    const result = await soundpadClient.restartSoundpad();
    if (result.success) {
      res.json({ message: 'Soundpad restarting' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
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

export default router;
