#!/usr/bin/env node

const { createBot } = require('./bot');
const db = require('./db');

async function main() {
  db.initDB();
  const bot = createBot();
  await bot.start({ dropPendingUpdates: true });
  console.log('🤖 Telegram bot started.');
}

main().catch((error) => {
  console.error('Failed to start Telegram bot:', error);
  process.exit(1);
});
