/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                    EXPRESS API SERVER                            ║
 * ║                                                                  ║
 * ║  HTTP endpoints for searching Amazon and triggering downloads.  ║
 * ║  Can be called by the Telegram bot, n8n, or any HTTP client.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { searchAmazon } = require('./searcher');
const { ImageSourcerAgent } = require('./agent');
const { extractASIN } = require('./extractor');
const db = require('./db');

function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Initialize database
  db.initDB();

  // Track active downloads
  const activeDownloads = new Map();

  // ── Health Check ───────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── Search Amazon ──────────────────────────────────────────────────
  app.post('/search', async (req, res) => {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Missing "query" field' });
    }

    try {
      const result = await searchAmazon(query, { headless: true });
      res.json(result);
    } catch (error) {
      console.error('Search error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Trigger Download ───────────────────────────────────────────────
  app.post('/download', async (req, res) => {
    const { url, title, requestedBy } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Missing "url" field' });
    }

    const asin = extractASIN(url);
    if (!asin) {
      return res.status(400).json({ error: 'Could not extract ASIN from URL' });
    }

    // Check if already downloaded
    const existing = db.isAlreadyDownloaded(asin);
    if (existing) {
      return res.json({
        status: 'already_done',
        message: `Already downloaded on ${existing.completed_at}`,
        book: existing,
      });
    }

    // Add to database
    const book = db.addBook(asin, title || 'Unknown', url, requestedBy || 'api');
    db.markDownloading(asin);

    // Start download asynchronously
    const downloadPromise = runDownload(url, asin);
    activeDownloads.set(asin, downloadPromise);

    res.json({
      status: 'downloading',
      message: 'Download started',
      asin,
    });
  });

  // ── Check Status ───────────────────────────────────────────────────
  app.get('/status/:asin', (req, res) => {
    const book = db.getBook(req.params.asin);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(book);
  });

  // ── Download History ───────────────────────────────────────────────
  app.get('/history', (req, res) => {
    const { userId, limit } = req.query;
    const history = db.getHistory(userId, parseInt(limit) || 20);
    res.json(history);
  });

  // ── Stats ──────────────────────────────────────────────────────────
  app.get('/stats', (req, res) => {
    res.json(db.getStats());
  });

  /**
   * Run the download agent for a single URL.
   * Updates database status when done.
   */
  async function runDownload(url, asin) {
    const agent = new ImageSourcerAgent({ headless: true });

    try {
      await agent.launch();
      const result = await agent.processUrl(url, 0, 1);
      await agent.shutdown();

      if (result.success) {
        db.markDone(asin, result.images, result.dir);
      } else {
        db.markFailed(asin, result.error || 'Unknown error');
      }

      activeDownloads.delete(asin);
      return result;
    } catch (error) {
      await agent.shutdown().catch(() => {});
      db.markFailed(asin, error.message);
      activeDownloads.delete(asin);
      throw error;
    }
  }

  // Expose runDownload for the bot to use directly
  app.runDownload = runDownload;

  return app;
}

module.exports = { createServer };
