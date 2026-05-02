/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              AUTONOMOUS AMAZON IMAGE SOURCER AGENT              ║
 * ║                                                                  ║
 * ║  The brain of the operation. This module orchestrates the full   ║
 * ║  pipeline: launch browser → navigate → extract → download.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const { chromium } = require('playwright');
const config = require('./config');
const { applyStealthScripts } = require('./stealth');
const { extractProductImages, extractProductTitle, extractASIN } = require('./extractor');
const { downloadAllImages } = require('./downloader');
const fs = require('fs-extra');
const path = require('path');

class ImageSourcerAgent {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.options = { ...config, ...options };
    this.results = [];
    this.logger = options.logger || console;
  }

  /**
   * Launch the browser with stealth settings.
   */
  async launch() {
    this.logger.log('\n🚀 Launching stealth browser...');

    this.browser = await chromium.launch({
      headless: this.options.headless,
      slowMo: this.options.slowMo,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: this.options.userAgent,
      viewport: this.options.viewport,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: [],
      javaScriptEnabled: true,
    });

    // Apply stealth to every new page
    this.context.on('page', async (page) => {
      await applyStealthScripts(page);
    });

    this.logger.log('✅ Browser ready.\n');
  }

  /**
   * Process a single Amazon product URL.
   * @param {string} url - Amazon product URL
   * @param {number} index - Current URL index (for display)
   * @param {number} total - Total URLs (for display)
   * @returns {Promise<object>} Result object
   */
  async processUrl(url, index, total) {
    const page = await this.context.newPage();
    await applyStealthScripts(page);

    const asin = extractASIN(url) || 'unknown';
    const prefix = `[${index + 1}/${total}]`;

    this.logger.log(`${prefix} 📖 Navigating to ASIN: ${asin}`);
    this.logger.log(`${prefix}    URL: ${url}`);

    try {
      // ── Navigate ─────────────────────────────────────────────────
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.options.navigationTimeout,
      });

      // Wait for the image block to be present
      await page.waitForSelector(
        '#imageBlock, #imageBlockNew, #main-image-container, #imgBlkFront, #ebooksImgBlkFront',
        { timeout: 15000 }
      ).catch(() => {
        this.logger.log(`${prefix} ⚠️  Image block not found, trying anyway...`);
      });

      // Extra delay for lazy-loaded images
      await page.waitForTimeout(this.options.imageLoadDelay);

      // ── Check for CAPTCHA ────────────────────────────────────────
      const hasCaptcha = await page.evaluate(() => {
        return !!(
          document.querySelector('#captchacharacters') ||
          document.querySelector('.a-box-inner h4')?.textContent?.includes('robot') ||
          document.title.toLowerCase().includes('robot check')
        );
      });

      if (hasCaptcha) {
        this.logger.log(`${prefix} 🤖 CAPTCHA detected! Waiting 30s for manual solve...`);
        // Wait for CAPTCHA to be solved manually (if running headful)
        await page.waitForSelector('#productTitle, #ebooksProductTitle', {
          timeout: 120000, // 2 minutes to solve CAPTCHA
        }).catch(() => {});
      }

      // ── Extract title ────────────────────────────────────────────
      const title = await extractProductTitle(page);
      this.logger.log(`${prefix} 📚 Title: ${title.substring(0, 60)}${title.length > 60 ? '...' : ''}`);

      // ── Extract images ───────────────────────────────────────────
      const imageUrls = await extractProductImages(page);
      this.logger.log(`${prefix} 🖼️  Found ${imageUrls.length} high-res image(s)`);

      if (imageUrls.length === 0) {
        this.logger.log(`${prefix} ❌ No images found, skipping.`);
        await page.close();
        return { url, asin, title, success: false, error: 'No images found', images: 0 };
      }

      // ── Download images ──────────────────────────────────────────
      const folderName = `${asin} - ${title.substring(0, 80)}`;
      const result = await downloadAllImages(imageUrls, folderName, (done, total, res) => {
        const status = res.success ? (res.skipped ? '⏭️' : '✅') : '❌';
        this.logger.log(`${prefix}    ${status} Image ${done}/${total}`);
      });

      this.logger.log(`${prefix} 💾 Saved ${result.downloaded} images → ${result.dir}`);

      await page.close();

      const outcome = {
        url,
        asin,
        title,
        success: true,
        images: result.downloaded,
        failed: result.failed,
        dir: result.dir,
      };
      this.results.push(outcome);
      return outcome;

    } catch (error) {
      this.logger.log(`${prefix} ❌ Error: ${error.message}`);
      await page.close().catch(() => {});
      const outcome = { url, asin, success: false, error: error.message, images: 0 };
      this.results.push(outcome);
      return outcome;
    }
  }

  /**
   * Process a list of Amazon URLs autonomously.
   * @param {string[]} urls - Array of Amazon product URLs
   */
  async processAll(urls) {
    this.logger.log(`\n${'═'.repeat(60)}`);
    this.logger.log(`  🤖 AUTONOMOUS IMAGE SOURCER — ${urls.length} product(s) queued`);
    this.logger.log(`${'═'.repeat(60)}\n`);

    await this.launch();

    for (let i = 0; i < urls.length; i++) {
      await this.processUrl(urls[i], i, urls.length);

      // Random delay between pages (anti-detection)
      if (i < urls.length - 1) {
        const delay = randomBetween(
          this.options.betweenPageDelay.min,
          this.options.betweenPageDelay.max
        );
        this.logger.log(`\n⏳ Cooling down for ${(delay / 1000).toFixed(1)}s...\n`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    await this.shutdown();
    this.printSummary();
  }

  /**
   * Print final summary of all operations.
   */
  printSummary() {
    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);
    const totalImages = successful.reduce((sum, r) => sum + r.images, 0);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📊 MISSION COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  ✅ Successful:    ${successful.length}/${this.results.length} products`);
    console.log(`  🖼️  Total images:  ${totalImages}`);
    if (failed.length > 0) {
      console.log(`  ❌ Failed:        ${failed.length}`);
      for (const f of failed) {
        console.log(`     • ${f.asin}: ${f.error}`);
      }
    }
    console.log(`  📁 Downloads:     ${config.downloadDir}`);
    console.log(`${'═'.repeat(60)}\n`);
  }

  /**
   * Gracefully close the browser.
   */
  async shutdown() {
    if (this.browser) {
      await this.browser.close();
      this.logger.log('\n🛑 Browser closed.');
    }
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { ImageSourcerAgent };
