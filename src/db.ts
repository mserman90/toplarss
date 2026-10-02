import Database from 'better-sqlite3';
import path from 'path';
import { FeedRecord } from './types';

const DB_PATH = process.env.DB_PATH || 'feeds.db';
const resolvedDbPath = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH);

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(resolvedDbPath);
    db.pragma('journal_mode = WAL');
    initTables(db);
  }
  return db;
}

function initTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      interval_mins INTEGER NOT NULL DEFAULT 60,
      cached_xml TEXT,
      last_fetched TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      fetch_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migrate columns if table existed from an older version
  const tableInfo = database.prepare("PRAGMA table_info('feeds')").all() as Array<{ name: string }>;
  const columnNames = new Set(tableInfo.map((col) => col.name));

  if (!columnNames.has('config_json') && columnNames.has('config')) {
    database.exec("ALTER TABLE feeds ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'");
    database.exec("UPDATE feeds SET config_json = config WHERE config_json = '{}' AND config IS NOT NULL");
  }

  if (!columnNames.has('last_fetched') && columnNames.has('last_scraped_at')) {
    database.exec('ALTER TABLE feeds ADD COLUMN last_fetched TEXT');
    database.exec('UPDATE feeds SET last_fetched = last_scraped_at WHERE last_fetched IS NULL');
  }

  if (!columnNames.has('fetch_count')) {
    database.exec('ALTER TABLE feeds ADD COLUMN fetch_count INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * Normalizes a database row to standard FeedRecord with backward-compatible aliases.
 */
function normalizeRecord(row: any): FeedRecord {
  const configJson = row.config_json || row.config || '{}';
  let targetUrl = row.url || '';
  if (!targetUrl) {
    try {
      const parsed = JSON.parse(configJson);
      targetUrl = parsed.url || '';
    } catch {
      targetUrl = '';
    }
  }

  return {
    id: row.id,
    name: row.name,
    config_json: configJson,
    interval_mins: row.interval_mins || 60,
    cached_xml: row.cached_xml || null,
    last_fetched: row.last_fetched || row.last_scraped_at || null,
    last_error: row.last_error || null,
    created_at: row.created_at,
    fetch_count: row.fetch_count || 0,
    // Aliases
    config: configJson,
    url: targetUrl,
    last_scraped_at: row.last_fetched || row.last_scraped_at || null,
    updated_at: row.created_at,
  };
}

/**
 * Returns all saved feeds sorted by creation date descending.
 */
export function listFeeds(): FeedRecord[] {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM feeds ORDER BY created_at DESC');
  const rows = stmt.all();
  return rows.map(normalizeRecord);
}

export const getAllFeeds = listFeeds;

/**
 * Returns a single feed by ID.
 */
export function getFeed(id: string): FeedRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM feeds WHERE id = ?');
  const row = stmt.get(id);
  return row ? normalizeRecord(row) : undefined;
}

export const getFeedById = getFeed;

/**
 * Returns feeds that are due for scraping based on interval_mins.
 */
export function getDueFeeds(): FeedRecord[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM feeds
    WHERE last_fetched IS NULL
       OR datetime(last_fetched, '+' || interval_mins || ' minutes') <= datetime('now')
  `);
  const rows = stmt.all();
  return rows.map(normalizeRecord);
}

export const getFeedsDueForScrape = getDueFeeds;

/**
 * Creates a new feed in the database.
 */
export function createFeed(input: {
  id: string;
  name: string;
  config_json?: string;
  config?: string;
  url?: string;
  interval_mins?: number;
  cached_xml?: string | null;
  last_fetched?: string | null;
  last_error?: string | null;
  fetch_count?: number;
}): FeedRecord {
  const database = getDb();
  const now = new Date().toISOString();
  const configJson = input.config_json || input.config || '{}';
  const intervalMins = input.interval_mins || 60;

  const tableInfo = database.prepare("PRAGMA table_info('feeds')").all() as Array<{ name: string }>;
  const columnNames = new Set(tableInfo.map((col) => col.name));

  let targetUrl = input.url || '';
  if (!targetUrl && configJson) {
    try {
      const parsed = JSON.parse(configJson);
      targetUrl = parsed.url || '';
    } catch {}
  }

  const cols: string[] = ['id', 'name', 'interval_mins', 'created_at'];
  const placeholders: string[] = ['?', '?', '?', '?'];
  const values: any[] = [input.id, input.name, intervalMins, now];

  if (columnNames.has('config_json')) {
    cols.push('config_json');
    placeholders.push('?');
    values.push(configJson);
  }
  if (columnNames.has('config')) {
    cols.push('config');
    placeholders.push('?');
    values.push(configJson);
  }
  if (columnNames.has('url')) {
    cols.push('url');
    placeholders.push('?');
    values.push(targetUrl);
  }
  if (columnNames.has('cached_xml')) {
    cols.push('cached_xml');
    placeholders.push('?');
    values.push(input.cached_xml || null);
  }
  if (columnNames.has('last_fetched')) {
    cols.push('last_fetched');
    placeholders.push('?');
    values.push(input.last_fetched || null);
  }
  if (columnNames.has('last_scraped_at')) {
    cols.push('last_scraped_at');
    placeholders.push('?');
    values.push(input.last_fetched || null);
  }
  if (columnNames.has('last_error')) {
    cols.push('last_error');
    placeholders.push('?');
    values.push(input.last_error || null);
  }
  if (columnNames.has('fetch_count')) {
    cols.push('fetch_count');
    placeholders.push('?');
    values.push(input.fetch_count || 0);
  }
  if (columnNames.has('updated_at')) {
    cols.push('updated_at');
    placeholders.push('?');
    values.push(now);
  }

  const stmt = database.prepare(`
    INSERT INTO feeds (${cols.join(', ')})
    VALUES (${placeholders.join(', ')})
  `);

  stmt.run(...values);

  return getFeed(input.id)!;
}

/**
 * Updates the cached RSS XML and fetch timestamp for a feed, incrementing fetch_count.
 */
export function updateFeedCache(
  id: string,
  cached_xml: string,
  error?: string | null
): void {
  const database = getDb();
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    UPDATE feeds
    SET cached_xml = ?,
        last_fetched = ?,
        last_error = ?,
        fetch_count = fetch_count + 1
    WHERE id = ?
  `);
  stmt.run(cached_xml, now, error || null, id);
}

export function updateFeedXml(id: string, cached_xml: string, last_scraped_at: string): void {
  updateFeedCache(id, cached_xml, null);
}

export function updateFeedError(id: string, last_error: string, last_scraped_at: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    UPDATE feeds
    SET last_error = ?,
        last_fetched = ?
    WHERE id = ?
  `);
  stmt.run(last_error, now, id);
}

/**
 * Updates feed configuration (name and interval are optional).
 */
export function updateFeedConfig(
  id: string,
  data: {
    name?: string;
    interval_mins?: number;
    intervalMins?: number;
    config_json?: string;
    config?: any;
    url?: string;
  }
): FeedRecord | undefined {
  const database = getDb();
  const existing = getFeed(id);
  if (!existing) {
    return undefined;
  }

  const name = data.name !== undefined ? data.name : existing.name;
  const intervalMins =
    data.interval_mins !== undefined
      ? data.interval_mins
      : data.intervalMins !== undefined
      ? data.intervalMins
      : existing.interval_mins;

  let configJson = existing.config_json;
  if (data.config_json !== undefined) {
    configJson = data.config_json;
  } else if (data.config !== undefined) {
    configJson = typeof data.config === 'string' ? data.config : JSON.stringify(data.config);
  }

  const stmt = database.prepare(`
    UPDATE feeds
    SET name = ?,
        interval_mins = ?,
        config_json = ?
    WHERE id = ?
  `);
  stmt.run(name, intervalMins, configJson, id);

  return getFeed(id);
}

export const updateFeed = updateFeedConfig;

/**
 * Deletes a feed by ID.
 */
export function deleteFeed(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare('DELETE FROM feeds WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore
    }
    db = null;
  }
}
