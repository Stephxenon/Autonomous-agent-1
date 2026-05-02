/**
 * Amazon Product Image Extractor
 * 
 * Extracts ALL product images from an Amazon product page at the
 * highest available resolution by:
 * 
 *   1. Parsing the `data-a-dynamic-image` JSON on the landing image
 *   2. Clicking through each thumbnail to trigger hi-res loads
 *   3. Extracting `colorImages` data from the page's inline JS
 *   4. Stripping Amazon CDN size modifiers to get original resolution
 */

const config = require('./config');

/**
 * Extract all high-resolution image URLs from the current Amazon product page.
 * @param {import('playwright').Page} page - Playwright page instance
 * @returns {Promise<string[]>} Array of unique high-res image URLs
 */
async function extractProductImages(page) {
  const images = new Set();

  // ── Strategy 1: colorImages JSON embedded in page script ─────────
  try {
    const colorImagesData = await page.evaluate(() => {
      // Amazon embeds a JS object like: 'colorImages': { 'initial': [...] }
      const scripts = document.querySelectorAll('script[type="text/javascript"]');
      for (const script of scripts) {
        const text = script.textContent || '';
        // Look for the colorImages data structure
        const match = text.match(/'colorImages'\s*:\s*\{[^}]*'initial'\s*:\s*(\[[\s\S]*?\])\s*\}/);
        if (match) {
          try {
            return JSON.parse(match[1]);
          } catch (e) {
            // Try a more lenient parse
          }
        }
      }
      return null;
    });

    if (colorImagesData && Array.isArray(colorImagesData)) {
      for (const imgObj of colorImagesData) {
        // Each object has 'hiRes', 'large', 'thumb' etc.
        const url = imgObj.hiRes || imgObj.large || imgObj.main?.url;
        if (url) images.add(url);
      }
    }
  } catch (e) {
    // Strategy 1 failed, continue to fallbacks
  }

  // ── Strategy 2: data-a-dynamic-image attribute ───────────────────
  try {
    const dynamicImages = await page.evaluate(() => {
      const mainImg = document.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront');
      if (!mainImg) return null;
      const dataAttr = mainImg.getAttribute('data-a-dynamic-image');
      if (!dataAttr) return null;
      try {
        // This is a JSON dict of { url: [width, height], ... }
        return JSON.parse(dataAttr);
      } catch (e) {
        return null;
      }
    });

    if (dynamicImages) {
      // Pick the URL with the largest dimensions
      let bestUrl = null;
      let bestArea = 0;
      for (const [url, dims] of Object.entries(dynamicImages)) {
        if (Array.isArray(dims) && dims.length >= 2) {
          const area = dims[0] * dims[1];
          if (area > bestArea) {
            bestArea = area;
            bestUrl = url;
          }
        }
      }
      if (bestUrl) images.add(bestUrl);
    }
  } catch (e) {
    // Strategy 2 failed
  }

  // ── Strategy 3: Click through thumbnails ─────────────────────────
  try {
    const thumbnails = await page.$$('#altImages .imageThumbnail, #altImages .a-button-thumbnail');
    
    for (const thumb of thumbnails) {
      try {
        await thumb.click();
        await page.waitForTimeout(800); // Wait for hi-res to load

        const hiResUrl = await page.evaluate(() => {
          // Check the main image viewer
          const img = document.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront');
          if (img) return img.src;
          
          // Check the immersive view
          const immersive = document.querySelector('.imgTagWrapper img');
          if (immersive) return immersive.src;
          
          return null;
        });

        if (hiResUrl && !hiResUrl.includes('sprite') && !hiResUrl.includes('icon')) {
          images.add(hiResUrl);
        }
      } catch (e) {
        // Skip broken thumbnails
      }
    }
  } catch (e) {
    // Strategy 3 failed
  }

  // ── Strategy 4: Scrape all large images from the image block ─────
  try {
    const allImgSrcs = await page.evaluate(() => {
      const results = [];
      const imgs = document.querySelectorAll(
        '#imageBlock img, #imageBlockNew img, #main-image-container img, .imgTagWrapper img'
      );
      for (const img of imgs) {
        const src = img.src || img.getAttribute('data-old-hires') || '';
        if (src && src.startsWith('http')) {
          results.push(src);
        }
      }
      return results;
    });

    for (const src of allImgSrcs) {
      if (!src.includes('sprite') && !src.includes('icon') && !src.includes('play-button')) {
        images.add(src);
      }
    }
  } catch (e) {
    // Strategy 4 failed
  }

  // ── Post-process: Upgrade all URLs to maximum resolution ─────────
  const upgraded = new Set();
  for (const url of images) {
    upgraded.add(upgradeToMaxResolution(url));
  }

  return [...upgraded];
}

/**
 * Strip Amazon's CDN size modifiers to get the original full-resolution image.
 * e.g., "._AC_SL1500_." → "."
 *       "._SY346_."     → "."
 */
function upgradeToMaxResolution(url) {
  // Pattern: ._ANYTHING_. between the image ID and extension
  // Example: https://m.media-amazon.com/images/I/81abc123._AC_SL1500_.jpg
  //       → https://m.media-amazon.com/images/I/81abc123.jpg
  return url.replace(/\._[A-Za-z0-9,_]+_\./g, '.');
}

/**
 * Extract the product title for folder naming.
 */
async function extractProductTitle(page) {
  try {
    const title = await page.evaluate(() => {
      const el = document.querySelector('#productTitle, #ebooksProductTitle, span#title');
      return el ? el.textContent.trim() : null;
    });
    return title || 'untitled-product';
  } catch (e) {
    return 'untitled-product';
  }
}

/**
 * Extract the ASIN (Amazon Standard Identification Number) from a URL or page.
 */
function extractASIN(url) {
  // ASIN patterns: /dp/ASIN, /gp/product/ASIN, /ASIN/ 
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/([A-Z0-9]{10})(?:\/|\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

module.exports = { extractProductImages, extractProductTitle, extractASIN, upgradeToMaxResolution };
