import * as cheerio from 'cheerio';
import { RSSConfig, RSSItem } from './types';

const TURKISH_MONTHS: Record<string, number> = {
  ocak: 0,
  şubat: 1,
  subat: 1,
  mart: 2,
  nisan: 3,
  mayıs: 4,
  mayis: 4,
  haziran: 5,
  temmuz: 6,
  ağustos: 7,
  agustos: 7,
  eylül: 8,
  eylul: 8,
  ekim: 9,
  kasım: 10,
  kasim: 10,
  aralık: 11,
  aralik: 11,
};

/**
 * Parses diverse date string formats including Turkish month names.
 */
function parseDateFlexible(dateStr?: string | null): Date | undefined {
  if (!dateStr || !dateStr.trim()) {
    return undefined;
  }

  const cleanStr = dateStr.trim();

  // Try standard JS Date parsing
  const timestamp = Date.parse(cleanStr);
  if (!isNaN(timestamp)) {
    return new Date(timestamp);
  }

  // Handle DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY (with optional HH:mm)
  const dmyMatch = cleanStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const d = new Date(year, month, day, hours, minutes);
    if (!isNaN(d.getTime())) return d;
  }

  // Handle Turkish textual date: "30 Eylül 2026" or "15 Mayıs 2026 14:30"
  const trMatch = cleanStr.match(/(\d{1,2})\s+([a-zA-ZçğıöşüÇĞİÖŞÜ]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);
  if (trMatch) {
    const day = parseInt(trMatch[1], 10);
    const monthName = trMatch[2].toLowerCase();
    const year = parseInt(trMatch[3], 10);
    const hours = trMatch[4] ? parseInt(trMatch[4], 10) : 0;
    const minutes = trMatch[5] ? parseInt(trMatch[5], 10) : 0;

    if (TURKISH_MONTHS[monthName] !== undefined) {
      const d = new Date(year, TURKISH_MONTHS[monthName], day, hours, minutes);
      if (!isNaN(d.getTime())) return d;
    }
  }

  return undefined;
}

/**
 * Resolves a potentially relative URL against the base URL.
 */
function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).href;
  } catch {
    return relativeOrAbsolute;
  }
}

/**
 * Scrapes RSS items from HTML using selectors configured in RSSConfig.
 * Sub-selectors are evaluated relative to each item matched by itemSelector.
 */
export function scrapeItems(html: string, baseUrl: string, config: RSSConfig): RSSItem[] {
  if (!html || !config.itemSelector) {
    return [];
  }

  const $ = cheerio.load(html);
  const matchedElements = $(config.itemSelector);
  const items: RSSItem[] = [];

  matchedElements.each((_, el) => {
    const $item = $(el);

    // Extract Title
    let title = '';
    if (config.titleSelector && config.titleSelector.trim()) {
      const $title = $item.find(config.titleSelector).first();
      title = $title.text().trim() || $title.attr('title') || '';
    }
    // Fallback: If title is empty, check if item itself has text
    if (!title) {
      const fallbackTitle = $item.find('h1, h2, h3, h4, h5, h6, strong, a').first();
      title = fallbackTitle.text().trim() || fallbackTitle.attr('title') || $item.text().trim();
    }

    // Extract Link
    let rawLink = '';
    const linkAttr = config.linkAttr?.trim() || 'href';
    if (config.linkSelector && config.linkSelector.trim()) {
      const $link = $item.find(config.linkSelector).first();
      if ($link.length) {
        rawLink = $link.attr(linkAttr) || $link.attr('href') || '';
      }
    }
    // Fallback: If linkSelector did not find link, find first anchor tag
    if (!rawLink) {
      if ($item.is('a') && $item.attr('href')) {
        rawLink = $item.attr('href') || '';
      } else {
        const $anchor = $item.find('a[href]').first();
        rawLink = $anchor.attr('href') || '';
      }
    }

    const resolvedLink = rawLink ? resolveUrl(rawLink, baseUrl) : baseUrl;

    // Extract Description
    let description: string | undefined;
    if (config.descriptionSelector && config.descriptionSelector.trim()) {
      const $desc = $item.find(config.descriptionSelector).first();
      if ($desc.length) {
        description = $desc.text().trim() || undefined;
      }
    }

    // Extract Date
    let pubDate: Date | undefined;
    if (config.dateSelector && config.dateSelector.trim()) {
      const $date = $item.find(config.dateSelector).first();
      if ($date.length) {
        const rawDate =
          $date.attr('datetime') ||
          $date.attr('data-date') ||
          $date.attr('data-timestamp') ||
          $date.text().trim();
        pubDate = parseDateFlexible(rawDate);
      }
    }

    // Extract Image URL
    let imageUrl: string | undefined;
    const imageAttr = config.imageAttr?.trim() || 'src';
    if (config.imageSelector && config.imageSelector.trim()) {
      const $img = $item.find(config.imageSelector).first();
      if ($img.length) {
        const rawImg =
          $img.attr(imageAttr) ||
          $img.attr('data-src') ||
          $img.attr('data-original') ||
          $img.attr('data-lazy-src') ||
          $img.attr('src');
        if (rawImg) {
          imageUrl = resolveUrl(rawImg, baseUrl);
        }
      }
    }

    // Only include items that have at least title or distinct link
    if (title || (rawLink && rawLink !== '#')) {
      items.push({
        title: title || 'Başlıksız',
        link: resolvedLink,
        description,
        pubDate,
        imageUrl,
        guid: resolvedLink,
      });
    }
  });

  return items;
}
