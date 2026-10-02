import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { assertPublicUrl } from './security';
import { fetchPage } from './fetcher';
import { scrape } from './scraper';
import { proxyHtmlForPicker } from './proxy';
import {
  listFeeds,
  getFeed,
  createFeed,
  updateFeedConfig,
  deleteFeed,
  closeDb,
} from './db';
import { startScheduler, stopScheduler, refreshFeed } from './scheduler';
import { closeBrowser } from './browser';
import { RSSConfig, FeedCreateInput } from './types';
import { cleanInput, cleanString, validateAndCleanConfig } from './validation';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const API_KEY = process.env.API_KEY || '';

export const app = express();

// Trust proxy configuration (for reverse proxies like Nginx, Cloudflare, Render)
if (process.env.TRUST_PROXY) {
  const val = process.env.TRUST_PROXY.trim();
  if (val === '1' || val === 'true') {
    app.set('trust proxy', 1);
  } else {
    app.set('trust proxy', val);
  }
}

// Enable CORS
app.use(cors());

// Body parsing with 1MB limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting: 60 requests per minute for /api/ routes
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Çok fazla istek gönderildi. Lütfen bir dakika sonra tekrar deneyin.',
  },
});
app.use('/api/', apiRateLimiter);

// API Key authentication for write operations (POST, PUT, DELETE)
function apiKeyAuthForWrites(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) {
    return next();
  }

  const writeMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (writeMethods.includes(req.method.toUpperCase())) {
    const providedKey =
      (req.headers['x-api-key'] as string) ||
      (req.headers['authorization']?.replace(/^Bearer\s+/i, '') as string) ||
      (req.query.api_key as string);

    if (!providedKey || providedKey !== API_KEY) {
      res.status(401).json({
        success: false,
        error: 'Yetkilendirme başarısız: Geçersiz veya eksik API anahtarı.',
      });
      return;
    }
  }

  next();
}

app.use('/api/', apiKeyAuthForWrites);

// Serve static frontend files
app.use(express.static(path.join(process.cwd(), 'public')));

/**
 * Health check route
 */
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/proxy?url=&render=1&waitSelector=
 * Returns sanitized HTML with visual selector script & toolbar injected.
 */
app.get('/api/proxy', async (req: Request, res: Response) => {
  try {
    const rawUrl = req.query.url as string;
    const targetUrl = cleanString(rawUrl, 2000);
    if (!targetUrl) {
      res.status(400).send('<h1>Hata: URL parametresi eksik.</h1>');
      return;
    }

    const render = req.query.render === '1' || req.query.render === 'true';
    const waitSelector = cleanString(req.query.waitSelector as string, 500) || undefined;

    // Check SSRF before making request
    await assertPublicUrl(targetUrl);

    const proxiedHtml = await proxyHtmlForPicker(targetUrl, render, waitSelector);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'self' http://localhost:* http://127.0.0.1:* https://*.github.io;"
    );
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
app.post('/api/preview', async (req: Request, res: Response) => {
  try {
    const config = validateAndCleanConfig(req.body);
    await assertPublicUrl(config.url);

    const html = await fetchPage(config.url, config.render, config.waitSelector);
    const items = scrape(html, config);

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
app.get('/api/feeds', (_req: Request, res: Response) => {
  try {
    const feeds = listFeeds().map((f) => {
      let cfg: any = {};
      try {
        cfg = JSON.parse(f.config_json);
      } catch {
        cfg = {};
      }
      return {
        ...f,
        config: cfg,
        feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${f.id}.xml`,
      };
    });
    res.json({ success: true, feeds });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed listesi alınamadı.' });
  }
});

/**
 * GET /api/feeds/:id
 * Returns a single feed by ID.
 */
app.get('/api/feeds/:id', (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const feed = getFeed(id);
    if (!feed) {
      res.status(404).json({ success: false, error: 'Feed bulunamadı.' });
      return;
    }

    let cfg: any = {};
    try {
      cfg = JSON.parse(feed.config_json);
    } catch {
      cfg = {};
    }

    res.json({
      success: true,
      feed: {
        ...feed,
        config: cfg,
        feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${feed.id}.xml`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed bilgisi alınamadı.' });
  }
});

/**
 * POST /api/feeds
 * Creates a new feed with optional custom ID / slug, name, intervalMins, and config.
 */
app.post('/api/feeds', async (req: Request, res: Response) => {
  try {
    const raw = cleanInput(req.body);
    if (!raw || typeof raw !== 'object') {
      res.status(400).json({ success: false, error: 'Geçersiz istek gövdesi.' });
      return;
    }

    const name = cleanString(raw.name, 200);
    if (!name) {
      res.status(400).json({ success: false, error: 'Feed adı zorunludur.' });
      return;
    }

    let intervalMins = parseInt(raw.intervalMins || raw.interval_mins, 10);
    if (isNaN(intervalMins) || intervalMins < 1) {
      intervalMins = 60;
    } else if (intervalMins > 10080) {
      intervalMins = 10080;
    }

    const config = validateAndCleanConfig(raw.config);

    // Support optional custom id / permanent slug (e.g. sygm-haberarsivi)
    let feedId = cleanString(raw.id, 100);
    if (feedId) {
      // Slugify custom id: lower + [^a-z0-9-_]=-
      feedId = feedId.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
    if (!feedId) {
      feedId = crypto.randomBytes(8).toString('hex');
    }

    // Check if feed with this ID already exists
    const existing = getFeed(feedId);
    let feedRecord;
    if (existing) {
      // Update existing
      feedRecord = updateFeedConfig(feedId, {
        name,
        interval_mins: intervalMins,
        config_json: JSON.stringify(config),
      })!;
    } else {
      feedRecord = createFeed({
        id: feedId,
        name,
        config_json: JSON.stringify(config),
        interval_mins: intervalMins,
      });
    }

    // Run initial scrape and RSS generation
    const refreshResult = await refreshFeed(feedRecord, PUBLIC_URL);
    const latest = getFeed(feedId)!;

    res.status(201).json({
      success: true,
      feed: {
        ...latest,
        config,
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
 * Updates an existing feed.
 */
app.put('/api/feeds/:id', async (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const existing = getFeed(id);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Düzenlenecek feed bulunamadı.' });
      return;
    }

    const updates: { name?: string; interval_mins?: number; config_json?: string } = {};

    if (req.body.name !== undefined) {
      const name = cleanString(req.body.name, 200);
      if (!name) {
        res.status(400).json({ success: false, error: 'Feed adı boş olamaz.' });
        return;
      }
      updates.name = name;
    }

    if (req.body.intervalMins !== undefined || req.body.interval_mins !== undefined) {
      const mins = parseInt(req.body.intervalMins || req.body.interval_mins, 10);
      if (!isNaN(mins) && mins >= 1 && mins <= 10080) {
        updates.interval_mins = mins;
      }
    }

    if (req.body.config !== undefined) {
      const config = validateAndCleanConfig(req.body.config);
      updates.config_json = JSON.stringify(config);
    }

    const updated = updateFeedConfig(id, updates);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Feed güncellenemedi.' });
      return;
    }

    // Refresh updated feed
    await refreshFeed(updated, PUBLIC_URL);

    const latest = getFeed(id)!;
    res.json({
      success: true,
      feed: {
        ...latest,
        config: JSON.parse(latest.config_json),
        feedUrl: `${PUBLIC_URL.replace(/\/+$/, '')}/feed/${latest.id}.xml`,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Feed güncellenirken hata oluştu.' });
  }
});

/**
 * DELETE /api/feeds/:id
 * Deletes a feed by ID.
 */
app.delete('/api/feeds/:id', (req: Request, res: Response) => {
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
 * POST /api/refresh/:id and POST /api/feeds/:id/refresh
 * Triggers manual scrape and XML refresh.
 */
async function handleRefresh(req: Request, res: Response) {
  try {
    const id = cleanString(req.params.id, 100);
    const result = await refreshFeed(id, PUBLIC_URL);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    const feed = getFeed(id);
    res.json({
      success: true,
      feed: feed ? { ...feed, config: JSON.parse(feed.config_json) } : null,
      itemCount: result.itemCount,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Feed yenilenemedi.' });
  }
}

app.post('/api/refresh/:id', handleRefresh);
app.post('/api/feeds/:id/refresh', handleRefresh);

/**
 * GET /feed/:id.xml
 * Serves the cached RSS 2.0 XML document.
 */
app.get('/feed/:id.xml', (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id, 100);
    const feed = getFeed(id);
    if (!feed) {
      res.status(404).type('text/plain').send('Hata 404: RSS beslemesi bulunamadı.');
      return;
    }

    if (!feed.cached_xml) {
      res
        .status(503)
        .type('text/plain')
        .send('RSS beslemesi henüz hazırlanıyor, lütfen biraz sonra tekrar deneyin.');
      return;
    }

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(feed.cached_xml);
  } catch (err: any) {
    res.status(500).type('text/plain').send(`Sunucu hatası: ${err?.message || 'Bilinmeyen hata'}`);
  }
});

/**
 * Wildcard handler -> index.html for single-page application navigation
 */
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/feed/') || req.path.startsWith('/api/')) {
    res.status(404).json({ success: false, error: 'Bulunamadı' });
    return;
  }
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// -------------------------------------------------------------
// Server Start & Graceful Shutdown
// -------------------------------------------------------------

export function startServer(port = PORT) {
  const server = app.listen(port, () => {
    console.log(`FetchRSS Clone sunucusu çalışıyor: http://localhost:${port}`);
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
