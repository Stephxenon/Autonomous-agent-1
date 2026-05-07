/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                    TELEGRAM BOT (grammY)                        ║
 * ║                                                                  ║
 * ║  Autonomous book image sourcer bot.                             ║
 * ║  Send a book title → get images downloaded automatically.       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const { Bot, InlineKeyboard, GrammyError, HttpError } = require('grammy');
const config = require('./config');
const { searchAmazon } = require('./searcher');
const { ImageSourcerAgent } = require('./agent');
const { extractASIN } = require('./extractor');
const db = require('./db');

/**
 * Create and configure the Telegram bot.
 * @returns {Bot} Configured grammY bot instance
 */
function createBot() {
  if (!config.telegramBotToken || config.telegramBotToken === 'your_telegram_bot_token_here') {
    throw new Error(
      '❌ No Telegram bot token! Set TELEGRAM_BOT_TOKEN in your .env file.\n' +
      '   Get one from @BotFather on Telegram.'
    );
  }

  const bot = new Bot(config.telegramBotToken);

  // ── /start Command ─────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    await ctx.reply(
      `🤖 *Autonomous Amazon Image Sourcer*\n\n` +
      `Send me a book title and I'll find the hardcover edition on Amazon and download all product images automatically.\n\n` +
      `*How it works:*\n` +
      `1️⃣ Send me a book title (e.g., "Atomic Habits")\n` +
      `2️⃣ I'll search Amazon for the hardcover version\n` +
      `3️⃣ If I'm confident, I'll download automatically\n` +
      `4️⃣ If not sure, I'll show you options to pick from\n\n` +
      `*Pro tip:* Send multiple book titles separated by new lines and I'll process each automatically.\n\n` +
      `*Commands:*\n` +
      `/search <title> — Search for a book\n` +
      `/history — View download history\n` +
      `/stats — View overall stats\n` +
      `/help — Show this message`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 *Commands:*\n\n` +
      `• Just send any book title to search & download\n` +
      `• Send multiple titles on separate lines to process a batch\n` +
      `• /search <title> — Search without auto-download\n` +
      `• /history — Recent downloads\n` +
      `• /stats — Download statistics\n\n` +
      `💡 *Tips:*\n` +
      `• Include the author for better results\n` +
      `• I filter for hardcover editions by default\n` +
      `• If a book was already downloaded, I'll tell you`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /stats Command ─────────────────────────────────────────────────
  bot.command('stats', async (ctx) => {
    const stats = db.getStats();
    await ctx.reply(
      `📊 *Download Stats*\n\n` +
      `📚 Total books: ${stats.total}\n` +
      `✅ Downloaded: ${stats.done}\n` +
      `❌ Failed: ${stats.failed}\n` +
      `⏳ In progress: ${stats.pending}\n` +
      `🖼️ Total images: ${stats.totalImages}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /history Command ───────────────────────────────────────────────
  bot.command('history', async (ctx) => {
    const userId = String(ctx.from.id);
    const history = db.getHistory(userId, 10);

    if (history.length === 0) {
      return ctx.reply('📭 No downloads yet. Send me a book title to get started!');
    }

    let msg = '📚 *Recent Downloads:*\n\n';
    for (const book of history) {
      const statusEmoji = book.status === 'done' ? '✅' : book.status === 'failed' ? '❌' : '⏳';
      msg += `${statusEmoji} *${book.title}*\n`;
      msg += `   ASIN: \`${book.asin}\` | Images: ${book.images_count || 0}\n\n`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // ── /search Command (explicit search, show results) ────────────────
  bot.command('search', async (ctx) => {
    const query = ctx.match?.trim();
    if (!query) {
      return ctx.reply('Usage: /search <book title>\nExample: /search Atomic Habits');
    }
    await handleSearch(ctx, query, false); // Don't auto-download
  });

  // ── Callback Query Handler (user picks a search result) ────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('dl:')) {
      // Format: dl:<asin>
      const asin = data.substring(3);
      await ctx.answerCallbackQuery({ text: '⏳ Starting download...' });

      // Find the URL from the search results (stored in callback data)
      const url = `https://www.amazon.com/dp/${asin}`;
      await handleDownload(ctx, url, asin);

    } else if (data === 'cancel') {
      await ctx.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.editMessageText('❌ Search cancelled.');
    }
  });

  // ── Text Message Handler (any text = book search) ──────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();

    // Skip if it looks like a command
    if (text.startsWith('/')) return;

    // If it's an Amazon URL, download directly
    if (text.includes('amazon.')) {
      const asin = extractASIN(text);
      if (asin) {
        await handleDownload(ctx, text, asin);
        return;
      }
    }

    // If the user sent multiple book titles, process them sequentially.
    const titles = splitBookTitles(text);
    if (titles.length > 1) {
      await ctx.reply(`📚 Processing ${titles.length} book titles...`);
      for (const title of titles) {
        await handleSearch(ctx, title, true);
      }
      return;
    }

    // Otherwise, treat as a book title search with auto-download
    await handleSearch(ctx, titles[0], true);
  });

  /**
   * Handle searching for a book.
   * @param {*} ctx - grammY context
   * @param {string} query - Search query
   * @param {boolean} autoDownload - If confident, auto-download?
   */
  async function handleSearch(ctx, query, autoDownload) {
    const userId = String(ctx.from.id);
    const statusMsg = await ctx.reply(`🔍 Searching Amazon for "${query}"...`);

    try {
      const searchResult = await searchAmazon(query, { headless: true });

      if (searchResult.results.length === 0) {
        return ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `😕 No results found for "${query}". Try a more specific title or include the author.`
        );
      }

      // ── Always show options (up to 5) ─────────────────────────────
      const keyboard = new InlineKeyboard();
      let msg = `📚 *Found ${searchResult.results.length} result(s) for "${query}":*\n\n`;

      const maxResults = Math.min(searchResult.results.length, 5);
      for (let i = 0; i < maxResults; i++) {
        const r = searchResult.results[i];
        const scoreBar = '█'.repeat(Math.round(r.score * 5)) + '░'.repeat(5 - Math.round(r.score * 5));
        msg += `*${i + 1}.* ${r.title}\n`;
        msg += `   ${r.author ? `✍️ ${r.author} | ` : ''}💰 ${formatPrice(r.price)} | Match: ${scoreBar}\n\n`;

        keyboard.text(`📥 ${i + 1}. ${r.title.substring(0, 30)}...`, `dl:${r.asin}`).row();
      }

      keyboard.text('❌ Cancel', 'cancel').row();

      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

    } catch (error) {
      console.error('Search error:', error);
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `❌ Search failed: ${error.message}\n\nTry again in a moment.`
      );
    }
  }

  function splitBookTitles(text) {
    const titles = text
      .split(/[\r\n;]+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return titles.length > 1 ? titles : [text.trim()];
  }

  function formatPrice(rawPrice) {
    if (!rawPrice) return 'N/A';
    if (rawPrice.includes('₦')) return rawPrice;

    const numeric = parseFloat(rawPrice.replace(/[^0-9\.]/g, ''));
    if (Number.isNaN(numeric)) {
      return rawPrice.replace('$', '₦');
    }

    const converted = numeric * (config.nairaExchangeRate || 1500);
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    }).format(converted);
  }

  /**
   * Handle downloading images for a specific book.
   * @param {*} ctx - grammY context
   * @param {string} url - Amazon product URL
   * @param {string} asin - Product ASIN
   * @param {string} title - Product title (optional)
   * @param {number} editMsgId - Message ID to edit with updates (optional)
   */
  async function handleDownload(ctx, url, asin, title, editMsgId) {
    const userId = String(ctx.from.id);

    // Check if already downloaded
    const existing = db.isAlreadyDownloaded(asin);
    if (existing) {
      const msg = `✅ *Already downloaded!*\n\n📚 ${existing.title}\n📅 ${existing.completed_at}\n🖼️ ${existing.images_count} images`;
      if (editMsgId) {
        return ctx.api.editMessageText(ctx.chat.id, editMsgId, msg, { parse_mode: 'Markdown' });
      }
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // Add to DB
    db.addBook(asin, title || 'Unknown', url, userId);
    db.markDownloading(asin);

    const statusText = `⏳ *Downloading images...*\n\nASIN: \`${asin}\`\nThis may take 15-30 seconds.`;
    let msgId = editMsgId;
    if (!msgId) {
      const sent = await ctx.reply(statusText, { parse_mode: 'Markdown' });
      msgId = sent.message_id;
    } else {
      await ctx.api.editMessageText(ctx.chat.id, msgId, statusText, { parse_mode: 'Markdown' });
    }

    // Run the download
    const agent = new ImageSourcerAgent({ headless: true });
    try {
      await agent.launch();
      const result = await agent.processUrl(url, 0, 1);
      await agent.shutdown();

      if (result.success) {
        db.markDone(asin, result.images, result.dir);

        await ctx.api.editMessageText(
          ctx.chat.id,
          msgId,
          `✅ *Download Complete!*\n\n` +
          `📚 *${result.title}*\n` +
          `🖼️ ${result.images} image(s) saved\n` +
          `📁 ${result.dir}\n\n` +
          `Send another title to keep going! 🚀`,
          { parse_mode: 'Markdown' }
        );
      } else {
        db.markFailed(asin, result.error);

        await ctx.api.editMessageText(
          ctx.chat.id,
          msgId,
          `❌ *Download Failed*\n\nASIN: \`${asin}\`\nError: ${result.error}\n\nTry sending the full Amazon URL instead.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      await agent.shutdown().catch(() => {});
      db.markFailed(asin, error.message);

      await ctx.api.editMessageText(
        ctx.chat.id,
        msgId,
        `❌ *Error:* ${error.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ── Error Handler ──────────────────────────────────────────────────
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;

    if (e instanceof GrammyError) {
      console.error('Error in request:', e.description);
    } else if (e instanceof HttpError) {
      console.error('Could not contact Telegram:', e);
    } else {
      console.error('Unknown error:', e);
    }
  });

  return bot;
}

module.exports = { createBot };
