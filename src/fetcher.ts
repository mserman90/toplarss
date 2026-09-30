import { safeGet } from './security';
import { renderPage } from './browser';

/**
 * Fetches page content based on the render flag.
 * - When render is true: executes JavaScript using Playwright Chromium.
 * - When render is false: fetches static HTML using safeGet (axios) with redirect validation.
 */
export async function fetchPage(url: string, render?: boolean, waitSelector?: string): Promise<string> {
  if (render) {
    return await renderPage(url, waitSelector);
  } else {
    const res = await safeGet(url);
    return res.data;
  }
}
