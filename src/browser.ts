import { chromium, Browser } from 'playwright';
import { assertPublicUrl } from './security';

const PW_MAX_PAGES = parseInt(process.env.PW_MAX_PAGES || '2', 10);
const PW_NO_SANDBOX = process.env.PW_NO_SANDBOX === '1';

class ConcurrencyLimiter {
  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.activeCount--;
          this.next();
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.activeCount--;
            this.next();
          }
        });
      });
    });
  }

  private next() {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
      const nextFn = this.queue.shift();
      if (nextFn) {
        nextFn();
      }
    }
  }
}

const limiter = new ConcurrencyLimiter(PW_MAX_PAGES > 0 ? PW_MAX_PAGES : 2);

let sharedBrowser: Browser | null = null;
let browserLaunchingPromise: Promise<Browser> | null = null;

/**
 * Returns or launches the single shared Playwright browser instance.
 */
export async function getSharedBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  if (browserLaunchingPromise) {
    return browserLaunchingPromise;
  }

  const launchArgs = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-zygote',
  ];

  if (PW_NO_SANDBOX) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  browserLaunchingPromise = chromium
    .launch({
      headless: true,
      args: launchArgs,
    })
    .then((browser) => {
      sharedBrowser = browser;
      browserLaunchingPromise = null;
      return browser;
    })
    .catch((err) => {
      browserLaunchingPromise = null;
      throw new Error(`Playwright Chromium tarayıcısı başlatılamadı: ${err.message}`);
    });

  return browserLaunchingPromise;
}

/**
 * Renders a web page with JavaScript execution using Playwright.
 * Enforces SSRF assertion on the main URL and every outbound network request.
 * Creates and closes a fresh browser context per request.
 */
export async function renderPage(url: string, waitSelector?: string): Promise<string> {
  // SSRF validation for the target page URL
  await assertPublicUrl(url);

  const releaseSlot = await limiter.acquire();
  let browser: Browser;
  try {
    browser = await getSharedBrowser();
  } catch (err: any) {
    releaseSlot();
    throw err;
  }

  // Fresh context per request with blocked service workers & downloads disabled
  const context = await browser.newContext({
    serviceWorkers: 'block',
    acceptDownloads: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 fetchrss-clone/1.0',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await context.newPage();

    // Inspect and filter every single outbound network request
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
        await route.continue();
        return;
      }

      try {
        await assertPublicUrl(reqUrl);
        await route.continue();
      } catch {
        // Block request if target is non-public or invalid
        await route.abort('accessdenied');
      }
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err: any) {
      throw new Error(`Sayfa yüklenirken Playwright hatası oluştu: ${err.message || err}`);
    }

    if (waitSelector && waitSelector.trim()) {
      try {
        await page.waitForSelector(waitSelector.trim(), { timeout: 10000 });
      } catch {
        // If waitSelector is not found within timeout, proceed with current content
      }
    } else {
      // Short grace period for client-side JavaScript rendering to settle
      await page.waitForTimeout(1000);
    }

    const html = await page.content();
    return html;
  } finally {
    try {
      await context.close();
    } catch {
      // Ignore context close errors
    }
    releaseSlot();
  }
}

/**
 * Closes the shared browser instance cleanly on shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      // Ignore
    }
    sharedBrowser = null;
  }
}
