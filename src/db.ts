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
      url TEXT NOT NULL,
      interval_mins INTEGER NOT NULL DEFAULT 60,
      config TEXT NOT NULL,
      cached_xml TEXT,
      last_scraped_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function getAllFeeds(): FeedRecord[] {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM feeds ORDER BY created_at DESC');
  return stmt.all() as FeedRecord[];
}

export function getFeedById(id: string): FeedRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM feeds WHERE id = ?');
  return stmt.get(id) as FeedRecord | undefined;
}

export function getFeedsDueForScrape(): FeedRecord[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM feeds
    WHERE last_scraped_at IS NULL
       OR datetime(last_scraped_at, '+' || interval_mins || ' minutes') <= datetime('now')
  `);
  return stmt.all() as FeedRecord[];
}

export function createFeed(input: {
  id: string;
  name: string;
  url: string;
  interval_mins: number;
  config: string;
  cached_xml?: string | null;
  last_scraped_at?: string | null;
  last_error?: string | null;
}): FeedRecord {
  const database = getDb();
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    INSERT INTO feeds (
      id, name, url, interval_mins, config, cached_xml, last_scraped_at, last_error, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    input.id,
    input.name,
    input.url,
    input.interval_mins,
    input.config,
    input.cached_xml || null,
    input.last_scraped_at || null,
    input.last_error || null,
    now,
    now
  );

  return getFeedById(input.id)!;
}

export function updateFeedXml(id: string, cached_xml: string, last_scraped_at: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    UPDATE feeds
    SET cached_xml = ?,
        last_scraped_at = ?,
        last_error = NULL,
        updated_at = ?
    WHERE id = ?
  `);
  stmt.run(cached_xml, last_scraped_at, now, id);
}

export function updateFeedError(id: string, last_error: string, last_scraped_at: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  // Preserve cached_xml if present!
  const stmt = database.prepare(`
    UPDATE feeds
    SET last_error = ?,
        last_scraped_at = ?,
        updated_at = ?
    WHERE id = ?
  `);
  stmt.run(last_error, last_scraped_at, now, id);
}

export function updateFeed(
  id: string,
  data: {
    name?: string;
    url?: string;
    interval_mins?: number;
    config?: string;
  }
): FeedRecord | undefined {
  const database = getDb();
  const existing = getFeedById(id);
  if (!existing) {
    return undefined;
  }

  const name = data.name !== undefined ? data.name : existing.name;
  const url = data.url !== undefined ? data.url : existing.url;
  const interval_mins = data.interval_mins !== undefined ? data.interval_mins : existing.interval_mins;
  const config = data.config !== undefined ? data.config : existing.config;
  const now = new Date().toISOString();

  const stmt = database.prepare(`
    UPDATE feeds
    SET name = ?,
        url = ?,
        interval_mins = ?,
        config = ?,
        updated_at = ?
    WHERE id = ?
  `);
  stmt.run(name, url, interval_mins, config, now, id);

  return getFeedById(id);
}

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
