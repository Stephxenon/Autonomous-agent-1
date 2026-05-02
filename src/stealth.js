/**
 * Stealth utilities to make Playwright look like a real browser.
 * Injects overrides to defeat common bot-detection fingerprinting.
 */

/**
 * Apply stealth patches to a Playwright page instance.
 * This masks webdriver flags, plugin arrays, language settings, etc.
 */
async function applyStealthScripts(page) {
  await page.addInitScript(() => {
    // ── 1. Hide webdriver flag ──────────────────────────────────────
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // ── 2. Fake plugins array ───────────────────────────────────────
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
    });

    // ── 3. Fake languages ───────────────────────────────────────────
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // ── 4. Mask Chrome runtime ──────────────────────────────────────
    window.chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {},
    };

    // ── 5. Override permissions query ───────────────────────────────
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // ── 6. Fake WebGL vendor/renderer ───────────────────────────────
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });
}

module.exports = { applyStealthScripts };
