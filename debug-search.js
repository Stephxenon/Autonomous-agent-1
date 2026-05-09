#!/usr/bin/env node

/**
 * Debug script to visualize Amazon search results in a browser
 * Usage: node debug-search.js "book title"
 */

const { searchAmazon } = require('./src/searcher');
const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const noFilters = args.includes('--no-filters');
  const query = args.filter(arg => arg !== '--no-filters').join(' ') || 'Ego is the enemy ryan holiday';

  console.log(`🔍 Searching Amazon for: "${query}"${noFilters ? ' (no filters)' : ' (with filters)'}`);

  try {
    const searchResult = await searchAmazon(query, { headless: true, useFilters: !noFilters });

    console.log(`📋 Found ${searchResult.results.length} results`);
    console.log(`🎯 Confident: ${searchResult.confident}`);
    if (searchResult.bestMatch) {
      console.log(`🏆 Best match: "${searchResult.bestMatch.title}" (score: ${(searchResult.bestMatch.score * 100).toFixed(0)}%)`);
    }

    // Generate HTML
    const html = generateResultsHTML(query, searchResult);

    // Save to temp file
    const tempFile = path.join(__dirname, 'debug-results.html');
    await fs.writeFile(tempFile, html);

    // Open in browser
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(`file://${tempFile}`);

    console.log(`🌐 Opened results in browser: ${tempFile}`);
    console.log('Press Ctrl+C to exit...');

    // Keep browser open
    process.on('SIGINT', async () => {
      await browser.close();
      await fs.remove(tempFile);
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

function generateResultsHTML(query, searchResult) {
  const results = searchResult.results;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Amazon Search Results Debug - "${query}"</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .result {
            background: white;
            padding: 20px;
            margin-bottom: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .result.best-match {
            border-left: 4px solid #ff9900;
        }
        .title {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-bottom: 8px;
        }
        .meta {
            color: #666;
            font-size: 14px;
            margin-bottom: 8px;
        }
        .score {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            margin-right: 10px;
        }
        .score.high { background: #d4edda; color: #155724; }
        .score.medium { background: #fff3cd; color: #856404; }
        .score.low { background: #f8d7da; color: #721c24; }
        .asin {
            font-family: monospace;
            background: #f8f9fa;
            padding: 2px 6px;
            border-radius: 3px;
        }
        .url {
            color: #007bff;
            text-decoration: none;
        }
        .url:hover {
            text-decoration: underline;
        }
        .stats {
            background: #e9ecef;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Amazon Search Results Debug</h1>
        <p><strong>Query:</strong> "${query}"</p>
        <p><strong>Total Results:</strong> ${results.length}</p>
        <p><strong>Confident Match:</strong> ${searchResult.confident ? '✅ Yes' : '❌ No'}</p>
        ${searchResult.bestMatch ? `<p><strong>Best Match:</strong> "${searchResult.bestMatch.title}" (${(searchResult.bestMatch.score * 100).toFixed(0)}% match)</p>` : ''}
    </div>

    <div class="stats">
        <h3>📊 Search Statistics</h3>
        <p><strong>Search URL:</strong> <a href="https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=stripbooks&rh=p_n_feature_browse-bin%3A2656022011" target="_blank">View on Amazon</a></p>
        <p><strong>Filters Applied:</strong> Books department, Hardcover editions only</p>
    </div>

    <h2>📚 Search Results (${results.length})</h2>

    ${results.map((result, index) => `
        <div class="result ${searchResult.bestMatch && result.asin === searchResult.bestMatch.asin ? 'best-match' : ''}">
            <div class="title">
                ${index + 1}. ${result.title}
                ${searchResult.bestMatch && result.asin === searchResult.bestMatch.asin ? ' 🏆' : ''}
            </div>
            <div class="meta">
                <span class="score ${getScoreClass(result.score)}">
                    ${(result.score * 100).toFixed(0)}% match
                </span>
                ${result.author ? `✍️ ${result.author} | ` : ''}
                💰 ${result.price || 'N/A'} |
                📖 ${result.format || 'Unknown'} |
                <span class="asin">${result.asin}</span>
            </div>
            <div class="meta">
                <strong>URL:</strong> <a href="${result.url}" class="url" target="_blank">${result.url}</a>
            </div>
            ${result.imageUrl ? `<div class="meta"><strong>Image:</strong> <a href="${result.imageUrl}" target="_blank">${result.imageUrl}</a></div>` : ''}
        </div>
    `).join('')}

    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => {
            location.reload();
        }, 30000);
    </script>
</body>
</html>`;
}

function getScoreClass(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

if (require.main === module) {
  main();
}
