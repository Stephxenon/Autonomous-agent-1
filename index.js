#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          AMAZON IMAGE SOURCER — CLI ENTRY POINT                 ║
 * ║                                                                  ║
 * ║  Usage:                                                          ║
 * ║    node index.js <url>                   # Single product        ║
 * ║    node index.js -f urls.txt             # File of URLs          ║
 * ║    node index.js <url1> <url2> <url3>    # Multiple products     ║
 * ║                                                                  ║
 * ║  Options:                                                        ║
 * ║    -f, --file <path>     Read URLs from a text file              ║
 * ║    --headless            Run without visible browser             ║
 * ║    --fast                Reduce delays (risky for detection)     ║
 * ║    -h, --help            Show this help message                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const fs = require('fs-extra');
const path = require('path');
const { ImageSourcerAgent } = require('./src/agent');

// ── Parse CLI Arguments ──────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║            🤖 AUTONOMOUS AMAZON IMAGE SOURCER                   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Downloads ALL high-resolution product images from Amazon        ║
║  autonomously. No extensions needed, no manual clicking.         ║
║                                                                  ║
║  USAGE:                                                          ║
║    node index.js <url>                   Single product          ║
║    node index.js -f urls.txt             File of URLs            ║
║    node index.js <url1> <url2> <url3>    Multiple products       ║
║                                                                  ║
║  OPTIONS:                                                        ║
║    -f, --file <path>     Read URLs from a text file              ║
║    --headless            Run without visible browser              ║
║    --fast                Reduce delays (risky for bot detection)  ║
║    -h, --help            Show this help message                  ║
║                                                                  ║
║  EXAMPLES:                                                       ║
║    node index.js "https://amazon.com/dp/B0XXXXXXX"               ║
║    node index.js -f my_books.txt                                 ║
║    node index.js -f my_books.txt --fast                          ║
║                                                                  ║
║  TIPS:                                                           ║
║    • Create a urls.txt file with one Amazon URL per line         ║
║    • Lines starting with # are treated as comments               ║
║    • Images are saved to ./downloads/<ASIN - Title>/             ║
║    • If CAPTCHA appears, solve it manually (browser stays open)  ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);
  process.exit(0);
}

async function main() {
  let urls = [];
  const options = {};

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-f' || arg === '--file') {
      const filePath = args[++i];
      if (!filePath) {
        console.error('❌ Error: --file requires a file path argument');
        process.exit(1);
      }
      const resolvedPath = path.resolve(filePath);
      if (!(await fs.pathExists(resolvedPath))) {
        console.error(`❌ Error: File not found: ${resolvedPath}`);
        process.exit(1);
      }
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const fileUrls = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      urls.push(...fileUrls);

    } else if (arg === '--headless') {
      options.headless = true;

    } else if (arg === '--fast') {
      options.slowMo = 0;
      options.betweenPageDelay = { min: 500, max: 1500 };
      options.imageLoadDelay = 1500;

    } else if (arg.startsWith('http')) {
      urls.push(arg);
    }
  }

  // Validate URLs
  urls = urls.filter((url) => {
    const isAmazon = url.includes('amazon.');
    if (!isAmazon) {
      console.warn(`⚠️  Skipping non-Amazon URL: ${url}`);
    }
    return isAmazon;
  });

  if (urls.length === 0) {
    console.error('❌ No valid Amazon URLs provided. Use --help for usage info.');
    process.exit(1);
  }

  // Deduplicate
  urls = [...new Set(urls)];

  // ── Launch Agent ───────────────────────────────────────────────────
  const agent = new ImageSourcerAgent(options);

  // Graceful shutdown on Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Interrupted! Shutting down gracefully...');
    await agent.shutdown();
    agent.printSummary();
    process.exit(0);
  });

  try {
    await agent.processAll(urls);
  } catch (error) {
    console.error(`\n💥 Fatal error: ${error.message}`);
    await agent.shutdown();
    process.exit(1);
  }
}

main();
