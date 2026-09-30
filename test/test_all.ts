import assert from 'assert';
import { isPrivateIp, assertPublicUrl } from '../src/security';
import { scrapeItems } from '../src/scraper';
import { generateRss } from '../src/rss';
import { renderPage, closeBrowser } from '../src/browser';
import { createFeed, getFeedById, deleteFeed, closeDb, updateFeedXml, updateFeedError } from '../src/db';
import { RSSConfig } from '../src/types';

async function runTests() {
  console.log('--- 1. SSRF Koruması Testleri (isPrivateIp & assertPublicUrl) ---');

  // IPv4 Private IPs
  assert.strictEqual(isPrivateIp('127.0.0.1'), true, '127.0.0.1 özel olmalı');
  assert.strictEqual(isPrivateIp('10.0.0.5'), true, '10.0.0.5 özel olmalı');
  assert.strictEqual(isPrivateIp('172.16.1.1'), true, '172.16.1.1 özel olmalı');
  assert.strictEqual(isPrivateIp('192.168.1.1'), true, '192.168.1.1 özel olmalı');
  assert.strictEqual(isPrivateIp('169.254.169.254'), true, '169.254.169.254 özel olmalı');
  assert.strictEqual(isPrivateIp('0.0.0.0'), true, '0.0.0.0 özel olmalı');

  // IPv6 Private IPs
  assert.strictEqual(isPrivateIp('::1'), true, '::1 özel olmalı');
  assert.strictEqual(isPrivateIp('fe80::1'), true, 'fe80::1 özel olmalı');
  assert.strictEqual(isPrivateIp('::ffff:127.0.0.1'), true, 'IPv4-mapped ::ffff:127.0.0.1 özel olmalı');

  // Public IPs
  assert.strictEqual(isPrivateIp('8.8.8.8'), false, '8.8.8.8 genel olmalı');
  assert.strictEqual(isPrivateIp('1.1.1.1'), false, '1.1.1.1 genel olmalı');
  assert.strictEqual(isPrivateIp('93.184.216.34'), false, 'example.com genel olmalı');

  console.log('✓ isPrivateIp testleri başarılı!');

  // assertPublicUrl checks
  await assert.rejects(
    async () => assertPublicUrl('http://127.0.0.1:3000/test'),
    /Güvenlik engeli/,
    'Localhost IP engellenmeli'
  );

  await assert.rejects(
    async () => assertPublicUrl('http://localhost:8080/'),
    /Güvenlik engeli/,
    'localhost alan adı engellenmeli'
  );

  await assert.rejects(
    async () => assertPublicUrl('file:///etc/passwd'),
    /Geçersiz URL protokolü/,
    'file:// protokolü engellenmeli'
  );

  await assert.rejects(
    async () => assertPublicUrl('ftp://ftp.example.com'),
    /Geçersiz URL protokolü/,
    'ftp:// protokolü engellenmeli'
  );

  const publicCheck = await assertPublicUrl('https://example.com');
  assert.ok(publicCheck.ip, 'example.com IP adresi çözümlenmeli');
  console.log('✓ assertPublicUrl testleri başarılı (SSRF koruması devrede)!');

  console.log('\n--- 2. Scraper ve Cheerio Testleri (HTML Fixture) ---');
  const sampleHtml = `
    <html>
      <body>
        <div class="news-list">
          <div class="article-card">
            <h2 class="title"><a href="/news/first-post">İlk Haber Başlığı</a></h2>
            <p class="summary">Bu birinci haberin özet açıklamasıdır.</p>
            <time datetime="2026-09-30T10:00:00Z">30 Eylül 2026</time>
            <img class="thumb" src="/images/post1.jpg" alt="Haber 1" />
          </div>
          <div class="article-card">
            <h2 class="title"><a href="https://other.com/news/second-post">İkinci Haber Başlığı</a></h2>
            <p class="summary">Bu ikinci haberin açıklamasıdır.</p>
            <time datetime="2026-09-29T15:30:00Z">29 Eylül 2026</time>
            <img class="thumb" src="https://other.com/post2.png" alt="Haber 2" />
          </div>
        </div>
      </body>
    </html>
  `;

  const config: RSSConfig = {
    url: 'https://example.com/blog',
    itemSelector: '.article-card',
    titleSelector: '.title a',
    linkSelector: '.title a',
    descriptionSelector: '.summary',
    dateSelector: 'time',
    imageSelector: 'img.thumb',
  };

  const items = scrapeItems(sampleHtml, config.url, config);
  assert.strictEqual(items.length, 2, '2 öğe çıkarılmalı');
  assert.strictEqual(items[0].title, 'İlk Haber Başlığı');
  assert.strictEqual(items[0].link, 'https://example.com/news/first-post', 'Relative URL çözümlenmeli');
  assert.strictEqual(items[0].description, 'Bu birinci haberin özet açıklamasıdır.');
  assert.strictEqual(items[0].imageUrl, 'https://example.com/images/post1.jpg', 'Relative görsel URL çözümlenmeli');
  assert.strictEqual(items[1].link, 'https://other.com/news/second-post');
  console.log('✓ Scraper HTML fixture testi başarılı!');

  console.log('\n--- 3. RSS 2.0 XML Üretim Testi ---');
  const rssXml = generateRss('Test Yayını', 'https://example.com/blog', items, 'http://localhost:3000', 'feed123');
  assert.ok(rssXml.includes('<?xml version="1.0"'), 'XML bildirim başlığı olmalı');
  assert.ok(rssXml.includes('<rss version="2.0"'), 'RSS 2.0 kök elemanı olmalı');
  assert.ok(rssXml.includes('<title><![CDATA[İlk Haber Başlığı]]></title>') || rssXml.includes('<title>İlk Haber Başlığı</title>'));
  assert.ok(rssXml.includes('https://example.com/news/first-post'));
  console.log('✓ RSS 2.0 XML üretim testi başarılı!');

  console.log('\n--- 4. SQLite Veritabanı ve Hata Saklama Testi ---');
  const testId = 'test_feed_' + Date.now();
  const created = createFeed({
    id: testId,
    name: 'Test SQLite Feed',
    url: 'https://example.com',
    interval_mins: 30,
    config: JSON.stringify(config),
    cached_xml: '<rss>initial</rss>',
  });
  assert.strictEqual(created.id, testId);

  // Update XML
  updateFeedXml(testId, '<rss>updated</rss>', new Date().toISOString());
  let fetched = getFeedById(testId);
  assert.strictEqual(fetched?.cached_xml, '<rss>updated</rss>');
  assert.strictEqual(fetched?.last_error, null);

  // Update error: Must preserve cached_xml!
  updateFeedError(testId, 'Test hata mesajı', new Date().toISOString());
  fetched = getFeedById(testId);
  assert.strictEqual(fetched?.cached_xml, '<rss>updated</rss>', 'Hata oluştuğunda eski cached_xml korunmalı!');
  assert.strictEqual(fetched?.last_error, 'Test hata mesajı');

  deleteFeed(testId);
  assert.strictEqual(getFeedById(testId), undefined, 'Feed silinebilmeli');
  console.log('✓ SQLite veritabanı kuralları testi başarılı!');

  console.log('\n--- 5. Playwright JS Render & SSRF Kontrolü Testi ---');
  // SSRF attempt with Playwright
  await assert.rejects(
    async () => renderPage('http://127.0.0.1:9999/private'),
    /Güvenlik engeli/,
    'Playwright yerel adresi engellemeli'
  );
  console.log('✓ Playwright SSRF engeli doğrulandı!');

  // Real public site render test with Playwright
  console.log('Gerçek genel site (https://example.com) Playwright ile test ediliyor...');
  const renderedHtml = await renderPage('https://example.com');
  assert.ok(renderedHtml.includes('Example Domain'), 'Example Domain HTML içeriği render edilmeli');
  console.log('✓ Playwright renderPage uçtan uca çalıştı ve başarıyla içerik çekti!');

  await closeBrowser();
  closeDb();
  console.log('\n🎉 TÜM TESTLER BAŞARIYLA TAMAMLANDI!');
}

runTests().catch((err) => {
  console.error('Test hatası:', err);
  process.exit(1);
});
