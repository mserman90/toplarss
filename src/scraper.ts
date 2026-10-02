import * as cheerio from 'cheerio';
import { RSSConfig, RSSItem } from './types';

export { RSSConfig, RSSItem };

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
export function parseDateFlexible(dateStr?: string | null): Date | undefined {
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

  // Handle relative time strings (e.g. "3m", "2h", "1d", "3w", "5 dakika önce", "2 hours ago")
  const relMatch = cleanStr.match(/^(\d+)\s*(s|sec|seconds?|saniye|m|min|minutes?|dakika|dk|h|hr|hours?|saat|d|days?|gün|gun|w|weeks?|hafta|mo|months?|ay|y|years?|yıl|yil)(?:\s+(?:ago|önce))?$/i);
  if (relMatch) {
    const num = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const now = Date.now();
    let ms = 0;
    if (unit.startsWith('s')) {
      ms = num * 1000;
    } else if (unit.startsWith('m') && !unit.startsWith('mo')) {
      ms = num * 60 * 1000;
    } else if (unit.startsWith('h') || unit === 'saat') {
      ms = num * 3600 * 1000;
    } else if (unit.startsWith('d') || unit.startsWith('g')) {
      ms = num * 86400 * 1000;
    } else if (unit.startsWith('w') || unit.startsWith('haf')) {
      ms = num * 7 * 86400 * 1000;
    } else if (unit.startsWith('mo') || unit === 'ay') {
      ms = num * 30 * 86400 * 1000;
    } else if (unit.startsWith('y')) {
      ms = num * 365 * 86400 * 1000;
    }
    if (ms > 0) {
      return new Date(now - ms);
    }
  }

  return undefined;
}

/**
 * Resolves a potentially relative URL against the base URL.
 */
export function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).href;
  } catch {
    return relativeOrAbsolute;
  }
}

/**
 * Scrapes RSS items from HTML using selectors configured in RSSConfig.
 * Limits extraction to maximum 100 items. Converts relative URLs to absolute.
 */
export function scrape(html: string, cfg: RSSConfig): RSSItem[] {
  if (!html || !cfg.itemSelector) {
    return [];
  }

  const baseUrl = cfg.baseUrl || cfg.url || 'http://localhost';
  const $ = cheerio.load(html);
  const matchedElements = $(cfg.itemSelector);
  const items: RSSItem[] = [];

  matchedElements.each((idx, el) => {
    // 100 item limit
    if (items.length >= 100) {
      return false; // break cheerio loop
    }

    const $item = $(el);

    // Extract Title
    let title = '';
    if (cfg.titleSelector && cfg.titleSelector.trim()) {
      const $title = $item.find(cfg.titleSelector).first();
      title = $title.text().trim() || $title.attr('title') || '';
    }
    // Fallback: If title is empty, check common headings or anchors
    if (!title) {
      const fallbackTitle = $item.find('h1, h2, h3, h4, h5, h6, strong, a').first();
      title = fallbackTitle.text().trim() || fallbackTitle.attr('title') || $item.text().trim();
    }

    // Extract Link
    let rawLink = '';
    const linkAttr = cfg.linkAttr?.trim() || 'href';
    if (cfg.linkSelector && cfg.linkSelector.trim()) {
      const $link = $item.find(cfg.linkSelector).first();
      if ($link.length) {
        rawLink = $link.attr(linkAttr) || $link.attr('href') || '';
      }
    }
    // Fallback: If linkSelector did not find link, find first anchor tag or check item itself
    if (!rawLink) {
      if ($item.is('a') && $item.attr('href')) {
        rawLink = $item.attr('href') || '';
      } else {
        const $anchor = $item.find('a[href]').first();
        rawLink = $anchor.attr('href') || '';
      }
    }

    const resolvedLink = rawLink ? resolveUrl(rawLink, baseUrl) : baseUrl;

    // Helper to search within the element or in subsequent siblings (useful for flat HTML streams)
    const findInOrNear = (sel: string) => {
      let found = $item.find(sel).first();
      if (!found.length) {
        found = $item.next(sel);
      }
      if (!found.length) {
        found = $item.nextAll(sel).first();
      }
      if (!found.length) {
        found = $item.nextAll().find(sel).first();
      }
      if (!found.length && $item.parent().length && !$item.parent().is('body, html, main')) {
        found = $item.parent().nextAll(sel).first();
        if (!found.length) {
          found = $item.parent().nextAll().find(sel).first();
        }
      }
      return found;
    };

    // Extract Description
    const descSel = (cfg.descSelector || cfg.descriptionSelector)?.trim();
    let description: string | undefined;
    if (descSel) {
      const $desc = findInOrNear(descSel);
      if ($desc.length) {
        description = $desc.text().trim() || undefined;
      }
    }

    // Extract Date
    let pubDate: Date | undefined;
    if (cfg.dateSelector && cfg.dateSelector.trim()) {
      const $date = findInOrNear(cfg.dateSelector);
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
    const imageAttr = cfg.imageAttr?.trim() || 'src';
    if (cfg.imageSelector && cfg.imageSelector.trim()) {
      const $img = findInOrNear(cfg.imageSelector);
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
        title: title || 'Başlıksız İçerik',
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

/**
 * Backward compatibility alias for scrape()
 */
export function scrapeItems(html: string, baseUrl: string, config: RSSConfig): RSSItem[] {
  return scrape(html, { ...config, baseUrl: baseUrl || config.baseUrl || config.url });
}
