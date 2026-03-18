// Dev proxy: forward /api calls to the dev server (port 8088)
module.exports = {
  '/api': {
    target: process.env.SERVER_PORT ? `http://localhost:${process.env.SERVER_PORT}` : 'http://localhost:8088',
    secure: false,
  },
};
