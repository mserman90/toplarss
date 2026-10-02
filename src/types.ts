export interface RSSConfig {
  url: string;
  render?: boolean;
  itemSelector: string;
  titleSelector?: string;
  linkSelector?: string;
  descSelector?: string;
  descriptionSelector?: string;
  imageSelector?: string;
  dateSelector?: string;
  baseUrl?: string;
  waitSelector?: string;
  linkAttr?: string;
  imageAttr?: string;
}

export interface RSSItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: Date;
  imageUrl?: string;
  author?: string;
  guid?: string;
}

export interface FeedRecord {
  id: string;
  name: string;
  config_json: string;
  interval_mins: number;
  cached_xml: string | null;
  last_fetched: string | null;
  last_error: string | null;
  created_at: string;
  fetch_count: number;
  // Aliases for compatibility
  config?: string;
  url?: string;
  last_scraped_at?: string | null;
  updated_at?: string;
}

export interface FeedCreateInput {
  id?: string;
  name: string;
  intervalMins?: number;
  interval_mins?: number;
  config: RSSConfig;
}

export interface FeedUpdateInput {
  name?: string;
  intervalMins?: number;
  interval_mins?: number;
  config?: RSSConfig;
}
