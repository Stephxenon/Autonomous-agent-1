# 🤖 Autonomous Amazon Image Sourcer

> **No clicking. No waiting. No extensions.** Paste your Amazon URLs, run one command, and the agent downloads every high-resolution product image autonomously.

---

## ⚡ Quick Start

### 1. Add your Amazon URLs

Open `urls.txt` and paste your Amazon product links, one per line:

```
https://www.amazon.com/dp/B08N5WRWNW
https://www.amazon.com/dp/0735211299
https://www.amazon.com/dp/0399592520
```

### 2. Run the agent

```bash
npm start
```

That's it. The agent will:
- 🚀 Launch a stealth browser
- 📖 Navigate to each product page
- 🖼️ Extract ALL product images at maximum resolution
- 💾 Download them into organized folders (`./downloads/<ASIN - Title>/`)
- 📊 Print a summary when done

---

## 🎮 Usage Modes

| Command | What it does |
|---------|-------------|
| `npm start` | Process URLs from `urls.txt` |
| `npm run start:fast` | Faster mode (reduced delays, higher detection risk) |
| `npm run start:headless` | Run without visible browser window |
| `node index.js <url>` | Process a single URL |
| `node index.js <url1> <url2>` | Process multiple URLs inline |
| `node index.js --help` | Show full help |

---

## 🏗️ Architecture

```
index.js          ← CLI entry point (argument parsing)
src/
  agent.js        ← Brain — orchestrates the full pipeline
  extractor.js    ← 4-strategy image extraction engine
  downloader.js   ← Download manager with retry & progress
  stealth.js      ← Anti-detection patches (webdriver, fingerprint)
  config.js       ← All tunable parameters
urls.txt          ← Your Amazon URLs go here
downloads/        ← Output folder (auto-created)
```

### Image Extraction Strategies (in order)

1. **`colorImages` JSON** — Parses Amazon's inline JS data for the highest-res URLs
2. **`data-a-dynamic-image`** — Reads the dynamic image attribute on the landing image
3. **Thumbnail clicking** — Clicks each product thumbnail to trigger hi-res loads
4. **DOM scraping** — Falls back to scraping all `<img>` tags in the image block

All URLs are then **upgraded to maximum resolution** by stripping Amazon's CDN size modifiers (e.g., `._AC_SL1500_.` → `.`).

---

## 🛡️ Anti-Detection Features

- Custom User-Agent mimicking a real Chrome browser
- WebDriver flag removal
- Fake plugins and languages
- WebGL vendor/renderer masking
- Random delays between page loads (2–5 seconds)
- CAPTCHA detection with manual-solve pause

---

## ⚙️ Configuration

Edit `src/config.js` to tune:

| Setting | Default | Description |
|---------|---------|-------------|
| `headless` | `false` | Show browser window |
| `slowMo` | `50ms` | Delay between actions |
| `imageLoadDelay` | `3000ms` | Wait for lazy images |
| `betweenPageDelay` | `2-5s` | Random delay between pages |
| `minImageWidth` | `300px` | Skip tiny images |
| `navigationTimeout` | `60s` | Max page load wait |

---

## 🚨 CAPTCHA Handling

If Amazon shows a CAPTCHA:
1. The agent **detects it automatically**
2. The browser window stays open — **solve it manually**
3. The agent resumes automatically after you solve it

---

## 📁 Output Structure

```
downloads/
  B08N5WRWNW - Atomic Habits/
    image_001.jpg
    image_002.jpg
    image_003.jpg
    _metadata.json       ← URLs, timestamps, stats
  0735211299 - The Power of Habit/
    image_001.jpg
    image_002.jpg
    _metadata.json
```

---

## 💡 Pro Tips

- **For large batches (100+ books):** Use `--fast` mode but add a VPN/proxy rotation
- **If images are missing:** Some books have DRM-protected viewer images — the agent gets everything accessible via the standard product page
- **Resumable:** The agent skips already-downloaded images, so you can re-run safely
