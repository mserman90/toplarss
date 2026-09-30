export interface RSSConfig {
  url: string;
  render?: boolean;
  itemSelector: string;
  titleSelector: string;
  linkSelector: string;
  linkAttr?: string;
  descriptionSelector?: string;
  dateSelector?: string;
  imageSelector?: string;
  imageAttr?: string;
  waitSelector?: string;
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
  url: string;
  interval_mins: number;
  config: string;
  cached_xml: string | null;
  last_scraped_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedCreateInput {
  name: string;
  intervalMins?: number;
  config: RSSConfig;
}

export interface FeedUpdateInput {
  name?: string;
  intervalMins?: number;
  config?: RSSConfig;
}
