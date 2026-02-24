import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import soundpadRoutes from './routes';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Redirect ytdl-core debug files (e.g. player-script.js) to ./tmp instead of
// the project root.  The tmp directory is listed in .gitignore.
// When packaged as a Tauri sidecar, RAGE_PAD_TMP_DIR points to a writable location.
const ytdlTmpDir = process.env['RAGE_PAD_TMP_DIR']
  ? path.resolve(process.env['RAGE_PAD_TMP_DIR'])
  : path.resolve(__dirname, '../../tmp');
if (!fs.existsSync(ytdlTmpDir)) {
  fs.mkdirSync(ytdlTmpDir, { recursive: true });
}
process.env.YTDL_DEBUG_PATH = ytdlTmpDir;

// Clean up any stale ytdl debug files left in tmp from previous runs.
try {
  const staleFiles = fs.readdirSync(ytdlTmpDir).filter(f => f.endsWith('-player-script.js'));
  for (const f of staleFiles) {
    try { fs.unlinkSync(path.join(ytdlTmpDir, f)); } catch { /* ignore */ }
  }
  if (staleFiles.length > 0) {
    console.log(`[startup] Cleaned up ${staleFiles.length} stale ytdl debug file(s) from tmp/`);
  }
} catch { /* ignore */ }

console.log(`Server running on port ${PORT}`);

// Middleware
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api', soundpadRoutes);

// Serve Angular static files in production.
// When packaged as a Tauri sidecar, RAGE_PAD_CLIENT_DIST points to the
// Angular build that Tauri bundles as resources alongside the installer.
const clientDistPath = process.env['RAGE_PAD_CLIENT_DIST']
  ? path.resolve(process.env['RAGE_PAD_CLIENT_DIST'])
  : path.join(__dirname, '../../client/dist/rage-pad-client/browser');
app.use(express.static(clientDistPath));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all route for Angular routing (SPA)
app.get('*', (req: Request, res: Response) => {
  // Only serve index.html for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response) => {
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

export default app;
