import { Feed } from 'feed';
import { RSSItem } from './types';

export interface FeedInfo {
  name: string;
  url: string;
  feedId?: string;
  publicUrl?: string;
  description?: string;
}

/**
 * Generates an RSS 2.0 valid XML document using the 'feed' library.
 */
export function generateRssXml(feedInfo: FeedInfo, items: RSSItem[]): string {
  const normalizedPublic = feedInfo.publicUrl ? feedInfo.publicUrl.replace(/\/+$/, '') : '';
  const feedXmlUrl =
    feedInfo.feedId && normalizedPublic
      ? `${normalizedPublic}/feed/${feedInfo.feedId}.xml`
      : undefined;

  const feed = new Feed({
    title: feedInfo.name || 'FetchRSS Clone Feed',
    description: feedInfo.description || `${feedInfo.name || 'Web beslemesi'} (${feedInfo.url})`,
    id: feedInfo.url,
    link: feedInfo.url,
    language: 'tr',
    image: items.find((i) => i.imageUrl)?.imageUrl,
    copyright: 'Tüm hakları kaynak yayına aittir',
    updated: items.length > 0 && items[0].pubDate ? items[0].pubDate : new Date(),
    generator: 'fetchrss-clone (Web -> RSS 2.0)',
    feedLinks: feedXmlUrl ? { rss2: feedXmlUrl } : undefined,
  });

  for (const item of items) {
    feed.addItem({
      title: item.title,
      id: item.guid || item.link,
      link: item.link,
      description: item.description || item.title,
      content: item.description,
      date: item.pubDate || new Date(),
      image: item.imageUrl,
      author: item.author ? [{ name: item.author }] : undefined,
    });
  }

  return feed.rss2();
}

/**
 * Compatibility signature for generateRss
 */
export function generateRss(
  feedName: string,
  targetUrl: string,
  items: RSSItem[],
  publicUrl?: string,
  feedId?: string
): string {
  return generateRssXml(
    {
      name: feedName,
      url: targetUrl,
      publicUrl,
      feedId,
    },
    items
  );
}
