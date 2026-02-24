# Rage Pad - Soundpad Remote Control

A Node.js application with an Angular frontend that integrates with Soundpad software API to list and play sounds.

## Features

- 🎵 Browse all sounds from your Soundpad library
- 🔍 Search sounds by title or artist
- ▶️ Play sounds with a single click
- ⏸️ Pause/Resume and Stop playback controls
- 🔊 Volume control
- 📡 Real-time connection status indicator
- 🎨 Clean, modern dark-themed UI
- 📱 Responsive design for all screen sizes

## Prerequisites

- **Soundpad** software installed and running on Windows
- Soundpad's Remote Control feature must be enabled

## Installation (Windows)

1. Download the latest `.exe` installer from the [Releases](https://github.com/AceOfRage/rage-pad/releases) page.
2. Run the installer and follow the on-screen prompts.
3. Launch **Rage Pad** from the Start Menu or desktop shortcut.

That's it — the bundled app includes everything it needs to run.

## Development Setup

If you want to build from source or contribute to the project, follow the steps below.

### Development Prerequisites

- **Node.js** (v18 or higher)
- **Rust** toolchain (for Tauri)
- **Tauri CLI** (`npm install -g @tauri-apps/cli`)

### Project Structure

```
rage-pad/
├── src/
│   └── server/           # Express backend
│       ├── index.ts      # Server entry point
│       ├── routes.ts     # API routes
│       └── soundpad-client.ts  # Soundpad API client
├── client/               # Angular frontend
│   └── src/
│       └── app/
│           ├── components/     # UI components
│           ├── models/         # TypeScript interfaces
│           └── services/       # Angular services
├── src-tauri/             # Tauri desktop wrapper
├── package.json
├── tsconfig.server.json
└── README.md
```

### Install Dependencies

1. **Install root dependencies:**
   ```bash
   npm install
   ```

2. **Install Angular client dependencies:**
   ```bash
   cd client
   npm install
   cd ..
   ```

### Running in Development Mode

Run both the backend server and Angular dev server concurrently:

```bash
npm run dev
```

This will start:
- Backend server at `http://localhost:3000`
- Angular dev server at `http://localhost:4200`

### Building for Production

**Build the standalone Windows installer:**

```bash
npm run build:windows
```

This will compile the server, build the Angular client, bundle everything with a portable Node.js runtime, and produce an NSIS installer in `src-tauri/target/release/bundle/nsis/`.

**Or run production mode without Tauri:**

1. **Build the Angular client:**
   ```bash
   npm run build:client
   ```

2. **Build and start the server:**
   ```bash
   npm start
   ```

The application will be available at `http://localhost:3000`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Check Soundpad connection status |
| GET | `/api/sounds` | Get all sounds from Soundpad |
| GET | `/api/sounds/search?q=query` | Search sounds by title/artist |
| POST | `/api/sounds/:index/play` | Play a sound by index |
| POST | `/api/stop` | Stop current playback |
| POST | `/api/pause` | Toggle pause/resume |
| GET | `/api/playback` | Get current playback status |
| POST | `/api/volume` | Set volume (0-100) |

## Soundpad Configuration

Make sure Soundpad is running with Remote Control enabled:

1. Open Soundpad
2. Go to **File** → **Preferences** → **Remote Control**
3. Enable **"Allow remote control"**
4. The application communicates via named pipe: `\\.\pipe\sp_remote_control`

## Technologies Used

### Backend
- Node.js
- Express.js
- TypeScript
- Named Pipes (Windows IPC)

### Frontend
- Angular 18
- TypeScript
- SCSS
- RxJS

## Troubleshooting

### "Disconnected" status
- Make sure Soundpad is running
- Verify Remote Control is enabled in Soundpad preferences
- Restart the backend server

### No sounds appearing
- Ensure Soundpad has sounds loaded in its library
- Click the "Refresh" button to reload sounds
- Check the browser console for errors

### Sounds not playing
- Verify Soundpad is not muted
- Check that the sound file exists and is valid
- Try playing the sound directly in Soundpad first

## License

MIT License
