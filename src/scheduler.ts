import cron, { ScheduledTask } from 'node-cron';
import { getDueFeeds, getFeed, updateFeedCache, updateFeedError } from './db';
import { fetchPage } from './fetcher';
import { scrape } from './scraper';
import { generateRssXml } from './rss';
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
    feed = getFeed(feedOrId);
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
      config = JSON.parse(feed.config_json);
    } catch {
      throw new Error('Feed yapılandırma verisi (JSON) bozuk.');
    }

    const targetUrl = config.url || feed.url;
    if (!targetUrl) {
      throw new Error('Hedef sayfa URL adresi eksik.');
    }

    // 1. Fetch HTML (Axios or Playwright based on config.render)
    const html = await fetchPage(targetUrl, config.render, config.waitSelector);

    // 2. Scrape items
    const items = scrape(html, config);
    if (!items || items.length === 0) {
      throw new Error('Belirtilen seçicilerle sayfadan hiçbir içerik çıkarılamadı.');
    }

    // 3. Generate RSS 2.0 XML
    const xml = generateRssXml(
      {
        name: feed.name,
        url: targetUrl,
        feedId: feed.id,
        publicUrl,
      },
      items
    );

    // 4. Update database cache
    updateFeedCache(feed.id, xml);

    return { success: true, itemCount: items.length };
  } catch (err: any) {
    const errorMsg = err?.message || 'Bilinmeyen bir hata oluştu.';
    // Preserve existing cached XML, only record last_error
    updateFeedError(feed.id, errorMsg, timestamp);
    return { success: false, error: errorMsg };
  }
}

/**
 * Starts the minute-by-minute scheduler that checks and refreshes due feeds.
 * Schedule: '* * * * *'
 */
export function startScheduler(publicUrl?: string): void {
  if (scheduledTask) {
    return;
  }

  // Runs every minute
  scheduledTask = cron.schedule('* * * * *', async () => {
    try {
      const dueFeeds = getDueFeeds();
      for (const feed of dueFeeds) {
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
 * Stops the scheduler cleanly.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
