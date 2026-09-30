# toplarss (Web → RSS 2.0 Besleme Üretici)

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Canl%C4%B1%20Web%20Uygulamas%C4%B1-brightgreen?logo=github)](https://mserman90.github.io/toplarss/)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/mserman90/toplarss)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mserman90/toplarss)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new?template=https://github.com/mserman90/toplarss)

Herhangi bir web sitesinden, tarayıcı üzerinden görsel olarak tıklanan CSS seçicileriyle standart RSS 2.0 beslemesi üreten, SSRF korumalı ve Playwright JavaScript render destekli modern web uygulaması.

Arayüz ve hata mesajları **Türkçe**, kod mimarisi ve tanımlayıcılar **İngilizce** ve katı kurallı TypeScript (strict CommonJS) olarak geliştirilmiştir.

---

## 🚀 Özellikler

- **Görsel CSS Seçici (Visual Picker):** Hedef web sayfası güvenli sandbox (`sandbox="allow-scripts"`, script etiketleri temizlenmiş) iframe içinde gösterilir. Kullanıcı tıkladığı anda öğeler otomatik vurgulanır ve optimum CSS seçicisi form alanına yazılır.
- **Dinamik JS & SPA Desteği:** Playwright Chromium altyapısı sayesinde istemci tarafında JavaScript ile render edilen (React, Vue vb.) dinamik sayfalar sorunsuz taranır.
- **Eşzamanlılık Sınırı (Concurrency Limiter):** Playwright tarayıcı oturumları paylaşılan tek bir Chromium örneği üzerinde `PW_MAX_PAGES` sınırıyla yönetilir. Bellek sızıntılarını önlemek için her istekte taze izole bağlam açılır ve kapatılır.
- **Kapsamlı SSRF Koruması:** Dışarıya giden hem axios hem de Playwright'ın sayfa içi tüm alt ağ istekleri `assertPublicUrl` kontrolünden geçer. `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254` (AWS/GCP metadata) gibi yerel ve bulut içi özel IP'ler ve `localhost`, `.local`, `.internal` alan adları kesin olarak engellenir.
- **Yönlendirme Denetimi (Redirect Validation):** `safeGet` fonksiyonu her HTTP 3xx yönlendirmesinde yeni hedef URL'yi sıfırdan DNS çözümlemesine ve güvenlik kontrolüne tabi tutar.
- **Hata Toleranslı Önbellekleme:** Zamanlayıcı veya tarayıcı bir hata ile karşılaşırsa, önceden üretilmiş geçerli `cached_xml` asla silinmez; yalnızca `last_error` ve `last_scraped_at` güncellenir.
- **Hız Sınırlaması ve API Anahtarı:** `/api/proxy`, `/api/preview`, `/api/feeds` uç noktaları `express-rate-limit` ile korunur. Ortam değişkeni `API_KEY` tanımlandığında API anahtarı doğrulaması aktifleşir.

---

## 🛠️ Kurulum ve Çalıştırma

### Gereksinimler
- Node.js 18+ (Node 24 test edilmiştir)
- npm

### 1. Bağımlılıkları Yükleme
```bash
npm install
```

### 2. Playwright Chromium Kurulumu (İlk kez bir defa)
```bash
npm run setup
```

### 3. Geliştirme Modu (Hot-reload)
```bash
npm run dev
# Tarayıcınızda açın: http://localhost:3000
```

### 4. Üretim Derlemesi ve Başlatma
```bash
npm run build
npm start
```

### 5. Otomatik Testleri Çalıştırma
```bash
npm test
```

---

## ⚙️ Ortam Değişkenleri (.env)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | HTTP sunucunun dinleyeceği port |
| `PUBLIC_URL` | `http://localhost:3000` | Üretilen RSS XML ve feed linklerinin genel adresi |
| `DB_PATH` | `feeds.db` | SQLite veritabanı dosya yolu |
| `PW_MAX_PAGES` | `2` | Playwright eşzamanlı sayfa açma limiti |
| `PW_NO_SANDBOX`| `0` | Docker ve root ortamları için `--no-sandbox` bayrağı (1: aktif) |
| `API_KEY` | *(Boş)* | Tanımlanırsa `/api/*` isteklerinde `x-api-key` başlığı zorunlu olur |

---

## 📁 Dosya Haritası

```
fetchrss-clone/
├── src/
│   ├── types.ts       # RSSConfig, RSSItem, FeedRecord tipleri
│   ├── security.ts    # SSRF koruması: assertPublicUrl, isPrivateIp, safeGet
│   ├── browser.ts     # Playwright: paylaşılan tarayıcı, renderPage, istek denetimi
│   ├── fetcher.ts     # fetchPage: render bayrağına göre axios veya Playwright
│   ├── scraper.ts     # Cheerio ile RSSItem[] çıkarma (göreli seçiciler)
│   ├── rss.ts         # 'feed' paketiyle RSS 2.0 XML üretimi
│   ├── proxy.ts       # Görsel seçici HTML proxy + seçici script enjeksiyonu
│   ├── db.ts          # SQLite feeds tablosu ve CRUD sorguları
│   ├── scheduler.ts   # node-cron ile her dakika feed yenileme
│   └── server.ts      # Express rotaları, clean() girdi temizleme, graceful shutdown
├── public/
│   └── index.html     # Türkçe görsel seçici arayüzü (Vanilla JS, no-build)
├── test/
│   ├── test_all.ts    # SSRF, Scraper, RSS, DB, Playwright birim testleri
│   ├── test_api.ts    # REST API ve entegrasyon testleri
│   └── run_tests.ts   # Çapraz platform test yürütücü
├── Dockerfile         # Resmi Playwright tabanlı üretim imajı
├── docker-compose.yml # Hazır servis tanımı ve veri hacmi eşlemesi
├── tsconfig.json      # Strict CommonJS TypeScript ayarları
└── package.json
```

---

## 🔌 REST API Dokümantasyonu

### 1. Görsel Proxy
- **`GET /api/proxy?url=<URL>&render=1&waitSelector=<SEL>`**
  - Hedef sayfadaki `<script>`, `<iframe>` gibi tehlikeli etiketleri temizler.
  - Vurgulayıcı ve `postMessage` seçici script'ini enjekte ederek HTML döner.

### 2. Canlı Önizleme
- **`POST /api/preview`**
  - Gövde (`RSSConfig` JSON):
    ```json
    {
      "url": "https://news.ycombinator.com",
      "render": false,
      "itemSelector": "tr.athing",
      "titleSelector": ".titleline > a",
      "linkSelector": ".titleline > a",
      "dateSelector": ".subtext span.age"
    }
    ```
  - Yanıt: İlk 10 eşleşen öğenin önizlemesi ve toplam eşleşme sayısı.

### 3. Feed Oluşturma
- **`POST /api/feeds`**
  - Gövde:
    ```json
    {
      "name": "Hacker News RSS",
      "intervalMins": 60,
      "config": { ... }
    }
    ```
  - Feed kaydedilir, anında ilk tarama yapılarak `cached_xml` üretilir.

### 4. Feed Listesi ve Yönetimi
- **`GET /api/feeds`** → Kayıtlı tüm feed'leri listeler.
- **`GET /api/feeds/:id`** → Tek bir feed'in detaylarını getirir.
- **`PUT /api/feeds/:id`** → Feed adını, yenileme sıklığını veya yapılandırmasını günceller.
- **`DELETE /api/feeds/:id`** → Feed'i siler.
- **`POST /api/feeds/:id/refresh`** → Zamanlayıcıyı beklemeden elle anında yeniler.

### 5. RSS 2.0 XML Çıktısı
- **`GET /feed/:id.xml`**
  - `Content-Type: application/rss+xml; charset=utf-8` başlığıyla önbelleğe alınmış güncel RSS 2.0 XML belgesini sunar.

---

## 🐳 Docker ile Çalıştırma

Hazır Dockerfile resmi Playwright imajını (`mcr.microsoft.com/playwright`) kullanır ve Chromium tarayıcısını hazır içerir.

```bash
# Docker Compose ile başlatma:
docker compose up -d --build

# Logları izleme:
docker compose logs -f
```

Besleme veritabanı `./data` klasörüne bağlanarak konteyner yeniden başlatmalarında korunur.
