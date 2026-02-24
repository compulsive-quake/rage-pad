import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import soundpadRoutes from './routes';
import { getSetting, getAllSettings, setSetting, updateSettings, closeDb } from './database';

// ── File logging for release builds ─────────────────────────────────────────
function setupLogging(): void {
  const dataDir = process.env['RAGE_PAD_DATA_DIR'];
  if (!dataDir) return; // dev mode — keep default console behaviour

  const logPath = path.join(dataDir, 'server.log');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  const timestamp = () => new Date().toISOString();

  console.log = (...args: unknown[]) => {
    logStream.write(`[${timestamp()}] [LOG] ${args.join(' ')}\n`);
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    logStream.write(`[${timestamp()}] [ERROR] ${args.join(' ')}\n`);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
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

const app: Application = express();
const startupPort = Number(process.env.PORT) || getSetting('serverPort');
let currentPort = startupPort;

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

console.log(`Server running on port ${startupPort}`);

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

// Return the port the server is currently listening on
app.get('/api/current-port', (_req: Request, res: Response) => {
  res.json({ port: currentPort });
});

// ── Settings API ─────────────────────────────────────────────────────────────

app.get('/api/settings', (_req: Request, res: Response) => {
  res.json(getAllSettings());
});

app.put('/api/settings', (req: Request, res: Response) => {
  const body = { ...req.body };
  // Port changes go through /api/change-port — strip it here
  delete body.serverPort;
  const updated = updateSettings(body);
  res.json(updated);
});

// Change the server port at runtime
app.post('/api/change-port', (req: Request, res: Response) => {
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
    setSetting('serverPort', newPort);

    // Re-attach graceful-shutdown handlers to the new server instance
    const shutdownNew = () => {
      closeDb();
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

  newServer.on('error', (err: NodeJS.ErrnoException) => {
    const message = err.code === 'EADDRINUSE'
      ? `Port ${newPort} is already in use`
      : `Failed to listen on port ${newPort}: ${err.message}`;
    res.status(409).json({ error: message });
  });
});

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
let server = app.listen(startupPort, () => {
  console.log(`Rage Pad server running on http://localhost:${startupPort}`);
  console.log(`API available at http://localhost:${startupPort}/api`);
  console.log(`Soundpad integration ready`);
});

// Graceful shutdown so nodemon can restart cleanly without EADDRINUSE
const shutdown = () => {
  closeDb();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
