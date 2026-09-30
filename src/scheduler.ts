import cron, { ScheduledTask } from 'node-cron';
import { getFeedsDueForScrape, getFeedById, updateFeedXml, updateFeedError } from './db';
import { fetchPage } from './fetcher';
import { scrapeItems } from './scraper';
import { generateRss } from './rss';
import { FeedRecord, RSSConfig } from './types';

let scheduledTask: ScheduledTask | null = null;

/**
 * Refreshes an individual feed by fetching, scraping, generating RSS XML,
 * and saving it to the SQLite database. Preserves previous cached XML on error.
 */
export async function refreshFeed(
  feedOrId: FeedRecord | string,
  publicUrl?: string
): Promise<{ success: boolean; itemCount?: number; error?: string }> {
  let feed: FeedRecord | undefined;

  if (typeof feedOrId === 'string') {
    feed = getFeedById(feedOrId);
  } else {
    feed = feedOrId;
  }

  if (!feed) {
    return { success: false, error: 'Feed bulunamadı.' };
  }

  const timestamp = new Date().toISOString();

  try {
    let config: RSSConfig;
    try {
      config = JSON.parse(feed.config);
    } catch {
      throw new Error('Feed yapılandırma verisi (JSON) bozuk.');
    }

    // 1. Fetch HTML (Axios or Playwright based on config.render)
    const html = await fetchPage(feed.url, config.render, config.waitSelector);

    // 2. Scrape items
    const items = scrapeItems(html, feed.url, config);
    if (!items || items.length === 0) {
      throw new Error('Belirtilen seçicilerle sayfadan hiçbir içerik çıkarılamadı.');
    }

    // 3. Generate RSS 2.0 XML
    const xml = generateRss(feed.name, feed.url, items, publicUrl, feed.id);

    // 4. Update database with fresh XML
    updateFeedXml(feed.id, xml, timestamp);

    return { success: true, itemCount: items.length };
  } catch (err: any) {
    const errorMsg = err?.message || 'Bilinmeyen bir hata oluştu.';
    // Preserve existing cached XML, only update last_error
    updateFeedError(feed.id, errorMsg, timestamp);
    return { success: false, error: errorMsg };
  }
}

/**
 * Starts the minute-by-minute scheduler that checks and refreshes expired feeds.
 */
export function startScheduler(publicUrl?: string): void {
  if (scheduledTask) {
    return;
  }

  // Runs every minute
  scheduledTask = cron.schedule('* * * * *', async () => {
    try {
      const dueFeeds = getFeedsDueForScrape();
      for (const feed of dueFeeds) {
        // Run refresh sequentially or with light spacing to prevent overload
        await refreshFeed(feed, publicUrl).catch((err) => {
          console.error(`Feed [${feed.id}] yenilenirken beklenmeyen hata:`, err);
        });
      }
    } catch (err) {
      console.error('Zamanlayıcı çalışırken hata oluştu:', err);
    }
  });
}

/**
 * Stops the scheduler.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
