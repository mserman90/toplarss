# FetchRSS Clone (Web → RSS 2.0)

Herhangi bir web sitesinden görsel olarak seçilen CSS seçicileriyle otomatik ve kalıcı **RSS 2.0 beslemesi** üreten tam kapsamlı Node.js uygulaması.

FetchRSS servisinin sağladığı tüm görsel seçici ve periyodik besleme özelliklerini kendi sunucunuzda, tam veri egemenliği ve yüksek güvenlik ile çalıştırmanızı sağlar.

---

## 🚀 Temel Özellikler

- **Görsel CSS Seçici (Visual Picker Toolbar):** Hedef web sayfası güvenli bir iframe (`sandbox="allow-scripts"`) içinde açılır. Sayfa üstündeki araç çubuğu ile *Öğe*, *Başlık*, *Link*, *Açıklama*, *Görsel* ve *Tarih* modları arasında geçiş yaparak öğeleri doğrudan tıklayarak seçebilirsiniz.
- **Akıllı CSS Seçici Motoru:** Tıklanan öğelerin `id > class > nth-of-type` hiyerarşisiyle (maksimum 4 seviye) kararlı CSS seçicileri üretilir.
- **Çift Tarama Motoru:**
  - **Playwright Chromium:** Dinamik JavaScript (SPA / React / Angular / Vue) ile render edilen sayfalar için eşzamanlılık kontrollü (`PW_MAX_PAGES=2`) başsız tarayıcı.
  - **Hızlı Axios (Statik):** JavaScript gerektirmeyen klasik HTML sayfaları için minimum kaynak tüketen doğrudan çekme.
- **Kurumsal Güvenlik (ASLA Taviz Verilmez - SSRF Koruması):**
  - Tüm giden HTTP istekleri ve yönlendirmeleri (redirects) `assertPublicUrl` üzerinden DNS çözümlemesi ile IP kontrolüne tabi tutulur.
  - Yerel ağlar (`10.0.0.0/8`, `192.168.0.0/16`, `172.16-31`, `127.0.0.0/8`, `0.0.0.0/8`), bulut metadata IP'leri (`169.254.169.254`) ve IPv6 (`::1`, `fc00::/7`, `fe80::/10`) tamamen engellenir.
  - Proxy edilen HTML içeriğinden tehlikeli `<script>`, `<iframe>` etiketleri ve `<meta http-equiv="refresh">` otomatik temizlenir.
  - Iframe içinde `allow-same-origin` kesinlikle kullanılmaz.
- **Kalıcı SQLite Veritabanı:** `better-sqlite3` ve WAL (Write-Ahead Logging) modunda yüksek hızlı, kesintisiz veri saklama.
- **Otomatik Arka Plan Zamanlayıcı:** `node-cron` ile her dakika çalışan (`* * * * *`) görev yöneticisi; süresi dolan beslemeleri arka planda yeniler, hata durumunda son geçerli XML önbelleğini korur.
- **Canlı Önizleme:** Seçicilerin doğruluğunu test etmek için anlık olarak ilk 10 içeriği kartlar halinde görselleştirir.

---

## 📦 Kurulum ve Çalıştırma

### Gereksinimler
- Node.js 18+ veya 20+
- npm veya yarn

### 1. Bağımlılıkları Yükleyin ve Tarayıcıyı Kurun
```bash
npm install
npm run setup
```
*(Bu komut Playwright için gerekli Chromium başsız tarayıcısını kurar)*

### 2. Geliştirme Modunda Çalıştırma
```bash
npm run dev
```
Sunucu `http://localhost:3000` adresinde başlayacaktır.

### 3. Üretim Modunda Derleme ve Başlatma
```bash
npm run build
npm start
```

### 4. Güvenlik ve Birim Testleri
```bash
npm test
```
Vitest ile SSRF ve IP güvenlik testleri çalıştırılır.

---

## 🏛️ Özel Entegrasyon: SYGM Haber Arşivi Kalıcı RSS

Tarım ve Orman Bakanlığı Su Yönetimi Genel Müdürlüğü (SYGM) Haber Arşivi için kalıcı besleme yapılandırması:

- **Hedef URL:** `https://www.tarimorman.gov.tr/SYGM/HaberArsivi`
- **Render Modu:** `true` (Playwright)
- **Öğe Seçici (itemSelector):** `div:has(> h4)`
- **Başlık Seçici (titleSelector):** `h4`
- **Link Seçici (linkSelector):** `a`
- **Beklenecek Seçici (waitSelector):** `h4`
- **Kalıcı Slug (ID):** `sygm-haberarsivi`
- **Canlı RSS Besleme Adresi:**
  ```text
  http://localhost:3000/feed/sygm-haberarsivi.xml
  ```
*(Veya dağıtılan sunucunuzun alan adıyla: `https://sunucunuz.com/feed/sygm-haberarsivi.xml`)*

---

## 🌐 GitHub Pages Statik Besleme Desteği

Uygulama, bağımsız bir sunucu olmadan GitHub Pages üzerinde de statik olarak çalışabilir:
- `github-pages/` dizini altında doğrudan barındırılabilir.
- Statik besleme linki: `https://KULLANICI.github.io/fetchrss-clone/feed/sygm-haberarsivi.xml`
- `github-pages-rss.zip` arşivi GitHub Pages reposuna doğrudan açılarak dağıtılabilir.

---

## 🐳 Docker ile Dağıtım

```bash
docker build -t fetchrss-clone .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name fetchrss fetchrss-clone
```

### Ortam Değişkenleri (.env)
| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `PORT` | `3000` | HTTP dinleme portu |
| `PUBLIC_URL` | `http://localhost:3000` | Dışa açık sunucu URL'si (RSS linkleri için) |
| `DB_PATH` | `feeds.db` | SQLite veritabanı dosya yolu |
| `PW_MAX_PAGES` | `2` | Playwright eşzamanlı sayfa render limiti |
| `PW_NO_SANDBOX`| `1` | Docker içinde sandbox bayrağı |
| `TRUST_PROXY` | - | Reverse proxy arkasında gerçek istemci IP tespiti (`1` veya `true`) |
| `API_KEY` | - | Ayarlanırsa yazma işlemlerinde API anahtarı zorunlu olur (`X-API-KEY`) |

---

## 📄 Lisans
MIT License.
