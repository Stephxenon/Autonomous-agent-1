#!/usr/bin/env node

const { createServer } = require('./server');
const config = require('./config');

const app = createServer();
app.listen(config.port, () => {
  console.log(`🌐 Amazon Image Sourcer API running on http://localhost:${config.port}`);
});
