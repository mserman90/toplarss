import { RSSConfig } from './types';

/**
 * Strips ASCII control characters except standard newlines/tabs,
 * trims leading/trailing whitespace, and enforces maximum character length (default 2000).
 */
export function cleanString(val: unknown, maxLength = 2000): string {
  if (typeof val !== 'string') return '';
  // Remove non-printable control characters (\x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F)
  return val
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Generic input sanitization function:
 * Recursively cleans strings, arrays, and objects, removing control characters
 * and trimming values up to maxLength (default 2000).
 */
export function cleanInput<T>(input: T, maxLength = 2000): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return cleanString(input, maxLength) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => cleanInput(item, maxLength)) as unknown as T;
  }

  if (typeof input === 'object') {
    const cleanedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      const cleanKey = cleanString(key, 256);
      cleanedObj[cleanKey] = cleanInput(value, maxLength);
    }
    return cleanedObj as T;
  }

  return input;
}

/**
 * Shorthand alias for cleanInput.
 */
export const clean = cleanInput;

/**
 * Validates and normalizes an RSSConfig object before any fetch/scrape operations.
 */
export function validateAndCleanConfig(raw: any): RSSConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Geçersiz yapılandırma verisi: Bir nesne bekleniyor.');
  }

  const cleaned = cleanInput(raw);

  const url = cleanString(cleaned.url, 2000);
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

  const itemSelector = cleanString(cleaned.itemSelector, 1000);
  if (!itemSelector) {
    throw new Error('Liste öğesi seçicisi (itemSelector) zorunludur.');
  }

  const titleSelector = cleanString(cleaned.titleSelector, 1000);
  const linkSelector = cleanString(cleaned.linkSelector, 1000);

  // Support both descSelector and descriptionSelector
  const descSelector = cleanString(
    cleaned.descSelector || cleaned.descriptionSelector,
    1000
  ) || undefined;

  // Support both imageSelector and imgSelector
  const imageSelector = cleanString(
    cleaned.imageSelector || cleaned.imgSelector,
    1000
  ) || undefined;

  const dateSelector = cleanString(cleaned.dateSelector, 1000) || undefined;
  const waitSelector = cleanString(cleaned.waitSelector, 1000) || undefined;
  const baseUrl = cleanString(cleaned.baseUrl, 2000) || undefined;

  const config: RSSConfig = {
    url,
    render: Boolean(cleaned.render === true || cleaned.render === '1' || cleaned.render === 'true'),
    itemSelector,
    titleSelector,
    linkSelector,
    descSelector,
    descriptionSelector: descSelector,
    imageSelector,
    dateSelector,
    waitSelector,
    baseUrl,
  };

  return config;
}
