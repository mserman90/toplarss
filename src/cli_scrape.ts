import fs from 'fs';
import path from 'path';
import { fetchPage } from './fetcher';
import { scrapeItems } from './scraper';
import { generateRss } from './rss';
import { RSSConfig } from './types';
import { closeBrowser } from './browser';

interface StaticFeedConfig {
  id: string;
  name: string;
  url: string;
  intervalMins?: number;
  config: RSSConfig;
}

async function runCliScrape() {
  const feedsJsonPath = path.join(process.cwd(), 'feeds.json');
  const outputDir = path.join(process.cwd(), 'public/feeds');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (!fs.existsSync(feedsJsonPath)) {
    console.log('feeds.json bulunamadı, örnek yapılandırma oluşturuluyor...');
    const defaultFeeds: StaticFeedConfig[] = [
      {
        id: 'hackernews',
        name: 'Hacker News En İyiler',
        url: 'https://news.ycombinator.com',
        intervalMins: 60,
        config: {
          url: 'https://news.ycombinator.com',
          render: false,
          itemSelector: 'tr.athing',
          titleSelector: '.titleline > a',
          linkSelector: '.titleline > a',
          dateSelector: '.subtext span.age',
        },
      },
    ];
    fs.writeFileSync(feedsJsonPath, JSON.stringify(defaultFeeds, null, 2), 'utf-8');
  }

  const raw = fs.readFileSync(feedsJsonPath, 'utf-8');
  const feeds: StaticFeedConfig[] = JSON.parse(raw);

  console.log(`[toplarss] ${feeds.length} adet feed taranıyor...`);
  const publicBaseUrl = process.env.PUBLIC_URL || 'https://mserman90.github.io/toplarss';

  const manifest: Array<{ id: string; name: string; url: string; xmlUrl: string; lastUpdated: string; itemCount: number }> = [];

  for (const feed of feeds) {
    console.log(`[*] Taranıyor: ${feed.name} (${feed.url})`);
    try {
      const html = await fetchPage(feed.config.url, feed.config.render, feed.config.waitSelector);
      const items = scrapeItems(html, feed.config.url, feed.config.render ? feed.config : feed.config);
      console.log(`    -> ${items.length} öğe bulundu.`);

      const xml = generateRss(feed.name, feed.url, items, publicBaseUrl, feed.id);
      const targetFilePath = path.join(outputDir, `${feed.id}.xml`);
      fs.writeFileSync(targetFilePath, xml, 'utf-8');

      manifest.push({
        id: feed.id,
        name: feed.name,
        url: feed.url,
        xmlUrl: `${publicBaseUrl}/feeds/${feed.id}.xml`,
        lastUpdated: new Date().toISOString(),
        itemCount: items.length,
      });
      console.log(`    -> RSS kaydedildi: ${targetFilePath}`);
    } catch (err: any) {
      console.error(`    [-] Hata oluştu: ${err.message}`);
    }
  }

  // Write manifest index.json
  fs.writeFileSync(path.join(outputDir, 'index.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('[toplarss] Tarama ve RSS üretimi tamamlandı!');

  await closeBrowser();
}

runCliScrape().catch((err) => {
  console.error('Fatal CLI Scrape Hatası:', err);
  process.exit(1);
});
