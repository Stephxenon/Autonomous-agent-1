/**
 * Configuration for the Amazon Image Sourcer Agent
 */
const path = require('path');
require('dotenv').config();

const isHeadless = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
const port = parseInt(process.env.PORT, 10) || 3456;
const searchConfidenceThreshold = parseFloat(process.env.SEARCH_CONFIDENCE_THRESHOLD) || 0.65;
const nairaExchangeRate = parseFloat(process.env.NAIRA_EXCHANGE_RATE) || 1500;
const dbPath = path.resolve(__dirname, '..', 'data', 'books.db');

module.exports = {
  // ── Download Settings ──────────────────────────────────────────────
  downloadDir: path.resolve(__dirname, '..', 'downloads'),
  dbPath,

  // ── Browser Settings ─────────────────────────────────────────────────
  headless: typeof process.env.HEADLESS !== 'undefined' ? isHeadless : false,
  slowMo: 50, // Milliseconds to slow down actions (human-like)

  // ── Timing ────────────────────────────────────────────────────────
  navigationTimeout: 60000, // 60s max wait for page load
  imageLoadDelay: 3000, // Wait for lazy-loaded images
  betweenPageDelay: { min: 2000, max: 5000 }, // Random delay between pages

  // ── Image Quality ─────────────────────────────────────────────────
  // Amazon image URL modifiers — we strip these to get max resolution
  // e.g., ._AC_SL1500_ → remove to get original
  imageModifierRegex: /\._[A-Z0-9,_]+_\./g,

  // Minimum image dimensions to download (skip tiny icons/badges)
  minImageWidth: 300,
  minImageHeight: 300,

  // ── Stealth Settings ──────────────────────────────────────────────
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',

  viewport: { width: 1440, height: 900 },
  // ── Feature flags / integration ──────────────────────────────────────
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  port,
  searchConfidenceThreshold,
  // ── Concurrency ───────────────────────────────────────────────────
  maxConcurrentPages: 1, // Keep at 1 to avoid detection; increase at your own risk
};
