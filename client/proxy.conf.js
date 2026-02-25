const fs = require('fs');
const path = require('path');

// Read the server port from settings, fall back to 3000
let port = 3000;
try {
  const settings = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'settings.json'), 'utf8')
  );
  if (settings.serverPort) port = settings.serverPort;
} catch {}

module.exports = {
  '/api': {
    target: `http://localhost:${port}`,
    secure: false,
  },
};
