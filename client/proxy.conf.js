// Dev proxy: forward /api calls to the dev server (port 3000)
module.exports = {
  '/api': {
    target: 'http://localhost:3000',
    secure: false,
  },
};
