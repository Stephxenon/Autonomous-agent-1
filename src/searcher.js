/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                 AMAZON BOOK SEARCHER                            ║
 * ║                                                                  ║
 * ║  Searches Amazon for books by title, filters for hardcover,     ║
 * ║  and applies fuzzy matching to determine confidence.            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const { chromium } = require('playwright');
const config = require('./config');
const { applyStealthScripts } = require('./stealth');
const { extractASIN } = require('./extractor');

/**
 * Search Amazon for a book by title and return top results.
 * @param {string} query - Book title (can be partial/fuzzy)
 * @param {object} options - Optional overrides
 * @returns {Promise<{results: object[], confident: boolean, bestMatch: object|null}>}
 */
async function searchAmazon(query, options = {}) {
  const browser = await chromium.launch({
    headless: options.headless ?? config.headless,
    slowMo: options.slowMo ?? config.slowMo,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: config.viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();
  await applyStealthScripts(page);

  try {
    // ── Build search URL with hardcover filter ─────────────────────
    const searchTerms = encodeURIComponent(query);
    // i=stripbooks = Books department
    // rh=p_n_feature_browse-bin:2656022011 = Hardcover filter
    const searchUrl = `https://www.amazon.com/s?k=${searchTerms}&i=stripbooks&rh=p_n_feature_browse-bin%3A2656022011`;

    console.log(`🔍 Searching Amazon: "${query}"`);
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeout,
    });

    // Wait for results to load
    await page.waitForSelector('[data-component-type="s-search-result"], .s-result-item', {
      timeout: 15000,
    }).catch(() => {
      console.log('⚠️  Search results container not found, trying anyway...');
    });

    await page.waitForTimeout(2000);

    // ── Check for CAPTCHA ──────────────────────────────────────────
    const hasCaptcha = await page.evaluate(() => {
      return !!(
        document.querySelector('#captchacharacters') ||
        document.title.toLowerCase().includes('robot check')
      );
    });

    if (hasCaptcha) {
      console.log('🤖 CAPTCHA on search page! Waiting for manual solve...');
      await page.waitForSelector('[data-component-type="s-search-result"]', {
        timeout: 120000,
      }).catch(() => {});
    }

    // ── Extract search results ─────────────────────────────────────
    const results = await page.evaluate(() => {
      const items = [];
      const resultElements = document.querySelectorAll(
        '[data-component-type="s-search-result"]'
      );

      for (const el of resultElements) {
        // Skip sponsored/ad results
        if (el.querySelector('.puis-sponsored-label-text')) continue;

        const asin = el.getAttribute('data-asin');
        if (!asin) continue;

        // Title
        const titleEl = el.querySelector('h2 a span, h2 span');
        const title = titleEl ? titleEl.textContent.trim() : '';

        // URL
        const linkEl = el.querySelector('h2 a');
        const url = linkEl ? `https://www.amazon.com${linkEl.getAttribute('href')}` : '';

        // Price
        const priceWhole = el.querySelector('.a-price-whole');
        const priceFraction = el.querySelector('.a-price-fraction');
        let price = null;
        if (priceWhole) {
          price = `$${priceWhole.textContent.trim()}${priceFraction ? priceFraction.textContent.trim() : '00'}`;
        }

        // Image
        const imgEl = el.querySelector('.s-image');
        const imageUrl = imgEl ? imgEl.getAttribute('src') : '';

        // Format (Hardcover, Paperback, etc.)
        const formatEl = el.querySelector('.a-size-base.a-link-normal, .a-text-bold');
        const format = formatEl ? formatEl.textContent.trim() : 'Hardcover';

        // Author
        const authorEl = el.querySelector('.a-size-base+ .a-size-base, .a-color-secondary .a-size-base');
        const author = authorEl ? authorEl.textContent.trim() : '';

        if (title) {
          items.push({ asin, title, author, url, price, imageUrl, format });
        }

        if (items.length >= 5) break;
      }

      return items;
    });

    console.log(`📋 Found ${results.length} search result(s)`);

    // ── Fuzzy matching ─────────────────────────────────────────────
    const scored = results.map((r) => ({
      ...r,
      score: fuzzyScore(query, r.title),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const threshold = options.confidenceThreshold ?? config.searchConfidenceThreshold;
    const bestMatch = scored.length > 0 ? scored[0] : null;
    const secondBestScore = scored.length > 1 ? scored[1].score : 0;
    const confident =
      bestMatch !== null &&
      (bestMatch.score >= threshold ||
        (bestMatch.score >= 0.45 && bestMatch.score - secondBestScore >= 0.2) ||
        (scored.length === 1 && bestMatch.score >= 0.35));

    if (bestMatch) {
      console.log(`🎯 Best match: "${bestMatch.title}" (score: ${(bestMatch.score * 100).toFixed(0)}%)`);
      console.log(`   Confident: ${confident ? '✅ YES' : '❓ NO — will ask user'}`);
    }

    await browser.close();

    return {
      results: scored,
      confident,
      bestMatch,
      query,
    };

  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Fuzzy score: what percentage of the query words appear in the target title.
 * @param {string} query - User's input (e.g., "atomic habits")
 * @param {string} title - Amazon result title
 * @returns {number} Score between 0 and 1
 */
function fuzzyScore(query, title) {
  // Normalize both strings
  const normalize = (str) =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // strip punctuation
      .split(/\s+/)
      .filter((w) => w.length > 1); // drop single-char words

  const queryWords = normalize(query);
  const titleWords = normalize(title);

  if (queryWords.length === 0) return 0;

  const titleSet = new Set(titleWords);
  let exactCount = 0;
  let partialCount = 0;

  for (const qw of queryWords) {
    if (titleSet.has(qw)) {
      exactCount += 1;
      partialCount += 1;
      continue;
    }
    if (titleWords.some((tw) => tw.includes(qw) || qw.includes(tw))) {
      partialCount += 1;
    }
  }

  const exactRatio = exactCount / queryWords.length;
  const partialRatio = partialCount / queryWords.length;
  const lengthPenalty = Math.max(0.5, 1 - Math.abs(titleWords.length - queryWords.length) * 0.05);

  return Math.min(1, exactRatio * 0.65 + partialRatio * 0.35) * lengthPenalty;
}

module.exports = { searchAmazon, fuzzyScore };
