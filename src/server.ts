import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { assertPublicUrl } from './security';
import { fetchPage } from './fetcher';
import { scrapeItems } from './scraper';
import { proxyHtmlForPicker } from './proxy';
import {
  getAllFeeds,
  getFeedById,
  createFeed,
  updateFeed,
  deleteFeed,
  closeDb,
} from './db';
import { startScheduler, stopScheduler, refreshFeed } from './scheduler';
import { closeBrowser } from './browser';
import { RSSConfig, FeedCreateInput } from './types';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const API_KEY = process.env.API_KEY || '';

export const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting middleware for heavy endpoints
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Çok fazla istek gönderildi. Lütfen bir süre sonra tekrar deneyin.',
  },
});

// Optional API Key middleware (active only when API_KEY is set in environment)
function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) {
    return next();
  }

  const providedKey = (req.headers['x-api-key'] as string) || (req.query.api_key as string);
  if (!providedKey || providedKey !== API_KEY) {
    res.status(401).json({
      success: false,
      error: 'Yetkilendirme başarısız: Geçersiz veya eksik API anahtarı.',
    });
    return;
  }
  next();
}

// Serve static frontend files
app.use(express.static(path.join(process.cwd(), 'public')));

/**
 * Sanitizes and normalizes a generic string input.
 */
function cleanString(val: any, maxLength = 1000): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLength);
}

/**
 * Sanitizes and validates an RSSConfig object before any operation.
 */
function cleanConfig(raw: any): RSSConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Geçersiz yapılandırma verisi.');
  }

  const url = cleanString(raw.url, 2048);
  if (!url) {
    throw new Error('Hedef URL alanı zorunludur.');
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Hedef URL yalnızca HTTP veya HTTPS protokolüne sahip olmalıdır.');
    }
  } catch {
    throw new Error('Geçersiz hedef URL formatı.');
  }

  const itemSelector = cleanString(raw.itemSelector, 500);
  if (!itemSelector) {
    throw new Error('Liste öğesi seçicisi (itemSelector) zorunludur.');
  }

  const titleSelector = cleanString(raw.titleSelector, 500);
  const linkSelector = cleanString(raw.linkSelector, 500);

  const cleaned: RSSConfig = {
    url,
    render: Boolean(raw.render === true || raw.render === '1' || raw.render === 'true'),
    itemSelector,
    titleSelector,
    linkSelector,
    linkAttr: cleanString(raw.linkAttr || 'href', 50) || 'href',
    descriptionSelector: cleanString(raw.descriptionSelector, 500) || undefined,
    dateSelector: cleanString(raw.dateSelector, 500) || undefined,
    imageSelector: cleanString(raw.imageSelector, 500) || undefined,
    imageAttr: cleanString(raw.imageAttr || 'src', 50) || 'src',
    waitSelector: cleanString(raw.waitSelector, 500) || undefined,
  };

  return cleaned;
}

/**
 * Sanitizes and validates feed creation input.
 */
function cleanFeedInput(raw: any): FeedCreateInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Geçersiz istek gövdesi.');
  }

  const name = cleanString(raw.name, 200);
  if (!name) {
    throw new Error('Feed adı zorunludur.');
  }

  let intervalMins = parseInt(raw.intervalMins, 10);
  if (isNaN(intervalMins) || intervalMins < 1) {
    intervalMins = 60; // Default 60 minutes
  } else if (intervalMins > 10080) {
    intervalMins = 10080; // Max 1 week
  }

  const config = cleanConfig(raw.config);

  return {
    name,
    intervalMins,
    config,
  };
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

/**
 * GET /api/proxy?url=&render=1&waitSelector=
 * Returns sanitized HTML with visual selector script injected.
 */
app.get('/api/proxy', heavyLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const rawUrl = req.query.url as string;
    const targetUrl = cleanString(rawUrl, 2048);
    if (!targetUrl) {
      res.status(400).send('<h1>Hata: URL parametresi eksik.</h1>');
      return;
    }

    const render = req.query.render === '1' || req.query.render === 'true';
    const waitSelector = cleanString(req.query.waitSelector as string, 500) || undefined;

    // Check SSRF before processing
    await assertPublicUrl(targetUrl);

    const proxiedHtml = await proxyHtmlForPicker(targetUrl, render, waitSelector);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self';");
    res.send(proxiedHtml);
  } catch (err: any) {
    res.status(400).send(`
      <div style="font-family: sans-serif; padding: 20px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;">
        <h3>Sayfa Yüklenemedi</h3>
        <p>${err?.message || 'Bilinmeyen hata'}</p>
      </div>
    `);
  }
});

/**
 * POST /api/preview
 * Scrapes and returns up to 10 sample items for immediate preview.
 */
app.post('/api/preview', heavyLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const config = cleanConfig(req.body);
    await assertPublicUrl(config.url);

    const html = await fetchPage(config.url, config.render, config.waitSelector);
    const items = scrapeItems(html, config.url, config);

    res.json({
      success: true,
      totalMatched: items.length,
      items: items.slice(0, 10),
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err?.message || 'Önizleme oluşturulurken hata meydana geldi.',
    });
  }
});

/**
 * GET /api/feeds
 * Returns list of all feeds.
 */
app.get('/api/feeds', apiKeyAuth, (_req: Request, res: Response) => {
  try {
    const feeds = getAllFeeds().map((f) => ({
      ...f,
      config: JSON.parse(f.config),
      feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${f.id}.xml`,
    }));
    res.json({ success: true, feeds });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed listesi alınamadı.' });
  }
});

/**
 * GET /api/feeds/:id
 * Returns a single feed by ID.
 */
app.get('/api/feeds/:id', apiKeyAuth, (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const feed = getFeedById(id);
    if (!feed) {
      res.status(404).json({ success: false, error: 'Feed bulunamadı.' });
      return;
    }

    res.json({
      success: true,
      feed: {
        ...feed,
        config: JSON.parse(feed.config),
        feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${feed.id}.xml`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed bilgisi alınamadı.' });
  }
});

/**
 * POST /api/feeds
 * Creates a new feed with { name, intervalMins, config } and triggers initial scrape.
 */
app.post('/api/feeds', heavyLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const input = cleanFeedInput(req.body);
    const feedId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    const created = createFeed({
      id: feedId,
      name: input.name,
      url: input.config.url,
      interval_mins: input.intervalMins || 60,
      config: JSON.stringify(input.config),
    });

    // Run initial scrape and RSS generation
    const refreshResult = await refreshFeed(created, PUBLIC_URL);

    const latest = getFeedById(feedId)!;

    res.status(201).json({
      success: true,
      feed: {
        ...latest,
        config: JSON.parse(latest.config),
        feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${latest.id}.xml`,
      },
      initialRefresh: refreshResult,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err?.message || 'Feed oluşturulurken hata meydana geldi.',
    });
  }
});

/**
 * PUT /api/feeds/:id
 * Updates an existing feed configuration or settings.
 */
app.put('/api/feeds/:id', heavyLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const existing = getFeedById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Düzenlenecek feed bulunamadı.' });
      return;
    }

    const updates: { name?: string; interval_mins?: number; config?: string; url?: string } = {};

    if (req.body.name !== undefined) {
      const name = cleanString(req.body.name, 200);
      if (!name) {
        res.status(400).json({ success: false, error: 'Feed adı boş olamaz.' });
        return;
      }
      updates.name = name;
    }

    if (req.body.intervalMins !== undefined) {
      const mins = parseInt(req.body.intervalMins, 10);
      if (!isNaN(mins) && mins >= 1 && mins <= 10080) {
        updates.interval_mins = mins;
      }
    }

    if (req.body.config !== undefined) {
      const config = cleanConfig(req.body.config);
      updates.config = JSON.stringify(config);
      updates.url = config.url;
    }

    const updated = updateFeed(id, updates);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Feed güncellenemedi.' });
      return;
    }

    // Refresh updated feed
    await refreshFeed(updated, PUBLIC_URL);

    const latest = getFeedById(id)!;
    res.json({
      success: true,
      feed: {
        ...latest,
        config: JSON.parse(latest.config),
        feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${latest.id}.xml`,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Feed güncellenirken hata oluştu.' });
  }
});

/**
 * DELETE /api/feeds/:id
 * Deletes a feed.
 */
app.delete('/api/feeds/:id', apiKeyAuth, (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const deleted = deleteFeed(id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Silinecek feed bulunamadı.' });
      return;
    }
    res.json({ success: true, message: 'Feed başarıyla silindi.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed silinemedi.' });
  }
});

/**
 * POST /api/feeds/:id/refresh
 * Triggers manual scrape and XML refresh for a feed.
 */
app.post('/api/feeds/:id/refresh', heavyLimiter, apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const result = await refreshFeed(id, PUBLIC_URL);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    const feed = getFeedById(id);
    res.json({
      success: true,
      feed: feed ? { ...feed, config: JSON.parse(feed.config) } : null,
      itemCount: result.itemCount,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed yenilenemedi.' });
  }
});

/**
 * GET /feed/:id.xml
 * Serves the cached RSS 2.0 XML document.
 */
app.get('/feed/:id.xml', (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const feed = getFeedById(id);
    if (!feed) {
      res.status(404).type('text/plain').send('Hata 404: RSS beslemesi bulunamadı.');
      return;
    }

    if (!feed.cached_xml) {
      res.status(503).type('text/plain').send('RSS beslemesi henüz hazırlanıyor, lütfen biraz sonra tekrar deneyin.');
      return;
    }

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(feed.cached_xml);
  } catch (err: any) {
    res.status(500).type('text/plain').send(`Sunucu hatası: ${err?.message || 'Bilinmeyen hata'}`);
  }
});

// -------------------------------------------------------------
// Server Start & Graceful Shutdown
// -------------------------------------------------------------

export function startServer(port = PORT) {
  const server = app.listen(port, () => {
    console.log(`toplarss sunucusu çalışıyor: http://localhost:${port}`);
    console.log(`Public URL: ${PUBLIC_URL}`);
    startScheduler(PUBLIC_URL);
  });

  let isShuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${signal} sinyali alındı. Sunucu kapatılıyor...`);

    stopScheduler();

    server.close(async () => {
      try {
        await closeBrowser();
        closeDb();
        console.log('Tüm kaynaklar temizlendi ve sunucu güvenle kapatıldı.');
        process.exit(0);
      } catch (err) {
        console.error('Kapanış sırasında hata:', err);
        process.exit(1);
      }
    });

    setTimeout(() => {
      console.error('Zorunlu kapatma uygulandı.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
}

// Start server automatically if executed directly
if (require.main === module) {
  startServer();
}

export default app;
