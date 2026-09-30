import assert from 'assert';
import { startServer } from '../src/server';
import axios from 'axios';
import { closeDb } from '../src/db';
import { closeBrowser } from '../src/browser';
import { stopScheduler } from '../src/scheduler';

async function testApi() {
  const testPort = 3055;
  const server = startServer(testPort);
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    console.log('\n--- Test 1: GET /api/feeds ---');
    const resFeeds = await axios.get(`${baseUrl}/api/feeds`);
    assert.strictEqual(resFeeds.status, 200);
    assert.strictEqual(resFeeds.data.success, true);
    console.log(`✓ GET /api/feeds başarılı! Toplam feed: ${resFeeds.data.feeds.length}`);

    console.log('\n--- Test 2: POST /api/preview ---');
    const previewRes = await axios.post(`${baseUrl}/api/preview`, {
      url: 'https://news.ycombinator.com',
      itemSelector: 'tr.athing',
      titleSelector: '.titleline > a',
      linkSelector: '.titleline > a',
      dateSelector: '.subtext span.age',
    });
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewRes.data.success, true);
    assert.ok(previewRes.data.items.length > 0, 'Hacker News öğeleri çıkarılabilmeli');
    console.log(`✓ POST /api/preview başarılı! Çıkarılan öğe sayısı: ${previewRes.data.items.length}`);
    console.log(`  İlk öğe: "${previewRes.data.items[0].title}" -> ${previewRes.data.items[0].link}`);

    console.log('\n--- Test 3: POST /api/feeds (Yeni Feed Kaydetme) ---');
    const createRes = await axios.post(`${baseUrl}/api/feeds`, {
      name: 'HN Entegrasyon Test Feed',
      intervalMins: 30,
      config: {
        url: 'https://news.ycombinator.com',
        itemSelector: 'tr.athing',
        titleSelector: '.titleline > a',
        linkSelector: '.titleline > a',
      },
    });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.data.success, true);
    const feedId = createRes.data.feed.id;
    console.log(`✓ POST /api/feeds başarılı! Feed ID: ${feedId}`);

    console.log('\n--- Test 4: GET /feed/:id.xml (RSS 2.0 XML Sunumu) ---');
    const xmlRes = await axios.get(`${baseUrl}/feed/${feedId}.xml`);
    assert.strictEqual(xmlRes.status, 200);
    assert.ok(xmlRes.headers['content-type']?.includes('xml'), 'Content-Type xml olmalı');
    assert.ok(xmlRes.data.includes('<rss version="2.0">'), 'RSS 2.0 XML olmalı');
    assert.ok(xmlRes.data.includes('<channel>'), '<channel> etiketi bulunmalı');
    console.log('✓ GET /feed/:id.xml başarılı! XML boyutu: ' + xmlRes.data.length + ' karakter');

    console.log('\n--- Test 5: PUT /api/feeds/:id (Feed Güncelleme) ---');
    const putRes = await axios.put(`${baseUrl}/api/feeds/${feedId}`, {
      name: 'HN Entegrasyon Test Feed (Güncellendi)',
      intervalMins: 45,
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.data.feed.name, 'HN Entegrasyon Test Feed (Güncellendi)');
    assert.strictEqual(putRes.data.feed.interval_mins, 45);
    console.log('✓ PUT /api/feeds/:id feed güncellemesi başarılı!');

    console.log('\n--- Test 6: DELETE /api/feeds/:id ---');
    const deleteRes = await axios.delete(`${baseUrl}/api/feeds/${feedId}`);
    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.data.success, true);
    console.log('✓ DELETE /api/feeds/:id başarılı!');

    console.log('\n--- Test 7: SSRF Engelleme /api/proxy?url=http://127.0.0.1:22 ---');
    const ssrfProxyRes = await axios.get(`${baseUrl}/api/proxy?url=http://127.0.0.1:22`, {
      validateStatus: () => true,
    });
    assert.strictEqual(ssrfProxyRes.status, 400);
    assert.ok(ssrfProxyRes.data.includes('Güvenlik engeli'), 'Proxy SSRF isteğini reddetmeli');
    console.log('✓ SSRF isteği /api/proxy tarafından başarıyla engellendi!');

    console.log('\n🎉 TÜM API VE ENTEGRASYON TESTLERİ EKSİKSİZ GEÇTİ!');
  } finally {
    stopScheduler();
    await closeBrowser();
    closeDb();
    server.close(() => {
      process.exit(0);
    });
  }
}

testApi().catch((err) => {
  console.error('API Test Hatası:', err?.response?.data || err.message);
  process.exit(1);
});
