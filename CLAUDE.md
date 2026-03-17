# CLAUDE.md

## Build & Deploy

- After making changes to client code, Tauri config, Android manifest/gradle files, or anything that affects the Android app, always rebuild and reinstall:
  ```
  npm run build:android && npm run android:run
  ```
