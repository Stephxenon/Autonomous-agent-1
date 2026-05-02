/**
 * Image Downloader
 * 
 * Downloads images from URLs to local disk with:
 *   - Organized folder structure (per product)
 *   - Duplicate detection via URL dedup
 *   - Retry logic for failed downloads
 *   - Progress reporting
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');

/**
 * Download a single image to the specified directory.
 * @param {string} url - Image URL
 * @param {string} destDir - Destination directory
 * @param {number} index - Image index (for naming)
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function downloadImage(url, destDir, index) {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Determine file extension from URL
      const ext = getExtension(url);
      const filename = `image_${String(index + 1).padStart(3, '0')}${ext}`;
      const filePath = path.join(destDir, filename);

      // Skip if already downloaded
      if (await fs.pathExists(filePath)) {
        return { success: true, path: filePath, skipped: true };
      }

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': config.userAgent,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.amazon.com/',
        },
      });

      // Verify it's actually an image
      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('image')) {
        return { success: false, error: `Not an image: ${contentType}` };
      }

      await fs.ensureDir(destDir);
      await fs.writeFile(filePath, response.data);
      
      return { success: true, path: filePath };
    } catch (error) {
      if (attempt === maxRetries) {
        return { success: false, error: error.message };
      }
      // Wait before retry (exponential backoff)
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Download all images for a product.
 * @param {string[]} urls - Array of image URLs
 * @param {string} productFolder - Folder name for this product
 * @param {Function} onProgress - Callback(downloaded, total)
 * @returns {Promise<{downloaded: number, failed: number, dir: string}>}
 */
async function downloadAllImages(urls, productFolder, onProgress) {
  // Sanitize folder name
  const safeName = productFolder
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);

  const destDir = path.join(config.downloadDir, safeName);
  await fs.ensureDir(destDir);

  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < urls.length; i++) {
    const result = await downloadImage(urls[i], destDir, i);
    if (result.success) {
      downloaded++;
    } else {
      failed++;
    }
    if (onProgress) onProgress(i + 1, urls.length, result);
  }

  // Write metadata
  await fs.writeJson(path.join(destDir, '_metadata.json'), {
    downloadedAt: new Date().toISOString(),
    totalImages: urls.length,
    downloaded,
    failed,
    urls,
  }, { spaces: 2 });

  return { downloaded, failed, dir: destDir };
}

/**
 * Get the file extension from a URL.
 */
function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'].includes(ext)) {
      return ext;
    }
  } catch (e) {
    // fallback
  }
  return '.jpg'; // Default to jpg for Amazon images
}

module.exports = { downloadImage, downloadAllImages };
