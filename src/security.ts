import dns from 'dns';
import net from 'net';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * Checks whether an IP address is private, loopback, link-local, or reserved.
 */
export function isPrivateIp(ip: string): boolean {
  // Handle IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    const ipv4 = ip.substring(7);
    if (net.isIPv4(ipv4)) {
      return isPrivateIp(ipv4);
    }
  }

  // IPv4 check
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.0.0/24, 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0) return true;
    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future use)
    if (a >= 240) return true;

    return false;
  }

  // IPv6 check
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback
    if (normalized === '::1') return true;
    // Unspecified
    if (normalized === '::') return true;
    // Unique local address fc00::/7 (fc00:: - fdff::)
    if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;
    // Link-local unicast fe80::/10 (fe80:: - febf::)
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
    // Multicast ff00::/8
    if (normalized.startsWith('ff')) return true;

    return false;
  }

  return true;
}

/**
 * Asserts that a URL is public and safe to fetch (SSRF prevention).
 * Throws Turkish descriptive error messages if the URL is invalid or unsafe.
 */
export async function assertPublicUrl(urlStr: string): Promise<{ parsedUrl: URL; ip: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    throw new Error('Geçersiz URL biçimi. Lütfen http:// veya https:// ile başlayan tam bir adres girin.');
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Geçersiz URL protokolü: Yalnızca HTTP ve HTTPS adreslerine izin verilir.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!hostname) {
    throw new Error('URL alan adı veya ana makine bilgisi içermiyor.');
  }

  // Block obvious localhost and local hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.corp')
  ) {
    throw new Error(`Güvenlik engeli: '${hostname}' yerel bir alan adıdır ve erişilemez.`);
  }

  // Check if hostname is an IP address
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Güvenlik engeli: Yerel veya özel IP adreslerine (${hostname}) erişim engellendi.`);
    }
    return { parsedUrl, ip: hostname };
  }

  // Resolve DNS to verify all IP records
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err: any) {
    throw new Error(`Alan adı çözümlenemedi (DNS hatası): ${err?.message || hostname}`);
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`Alan adına ait IP adresi bulunamadı: ${hostname}`);
  }

  for (const record of addresses) {
    if (isPrivateIp(record.address)) {
      throw new Error(`Güvenlik engeli: '${hostname}' adresi yerel veya özel ağ IP'sine (${record.address}) işaret ediyor.`);
    }
  }

  return { parsedUrl, ip: addresses[0].address };
}

/**
 * Performs a safe GET request verifying that the initial URL and all subsequent
 * redirect URLs point to public IP addresses (re-validated on each hop).
 */
export async function safeGet(
  targetUrl: string,
  options?: AxiosRequestConfig
): Promise<{ data: string; status: number; finalUrl: string }> {
  let currentUrl = targetUrl;
  const maxRedirects = 5;
  const defaultTimeout = 15000;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Assert current URL is public before making outbound request
    await assertPublicUrl(currentUrl);

    try {
      const response: AxiosResponse<string> = await axios.get(currentUrl, {
        ...options,
        maxRedirects: 0, // Handle redirects manually to re-verify public safety on every hop
        validateStatus: (status) => (status >= 200 && status < 400) || status === 404,
        timeout: options?.timeout || defaultTimeout,
        responseType: 'text',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 fetchrss-clone/1.0',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
          ...(options?.headers || {}),
        },
      });

      // Handle redirect status codes
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const redirectLocation = response.headers['location'];
        if (!redirectLocation) {
          throw new Error(`Hedef sunucu ${response.status} yönlendirme kodu verdi ancak konum belirtmedi.`);
        }

        // Resolve redirect URL relative to current URL
        currentUrl = new URL(redirectLocation, currentUrl).href;
        continue;
      }

      if (response.status >= 400) {
        throw new Error(`Hedef sayfa hata yanıtı döndürdü (HTTP ${response.status}).`);
      }

      return {
        data: response.data,
        status: response.status,
        finalUrl: currentUrl,
      };
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        throw new Error('Hedef sunucuya bağlanırken zaman aşımı oluştu (15 saniye).');
      }
      if (err.message && err.message.startsWith('Güvenlik engeli')) {
        throw err;
      }
      if (err.response && err.response.status >= 400) {
        throw new Error(`Hedef sayfa hata yanıtı döndürdü (HTTP ${err.response.status}).`);
      }
      throw new Error(`Sayfa yüklenirken hata oluştu: ${err.message || 'Bilinmeyen ağ hatası'}`);
    }
  }

  throw new Error('Çok fazla yönlendirme tespit edildi (Maksimum 5).');
}
