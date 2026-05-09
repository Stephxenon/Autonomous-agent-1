#!/usr/bin/env node

const { createBot } = require('./bot');
const db = require('./db');

async function main() {
  db.initDB();
  const bot = createBot();
  
  // Process pending searches from database on startup
  const pendingSearches = db.getPendingSearches();
  if (pendingSearches.length > 0) {
    console.log(`🔄 Found ${pendingSearches.length} pending search(es). Processing...`);
  }
  
  // Don't drop pending updates — get all messages from while bot was offline
  await bot.start({ dropPendingUpdates: false });
  console.log('🤖 Telegram bot started.');
}

main().catch((error) => {
  console.error('Failed to start Telegram bot:', error);
  process.exit(1);
});
