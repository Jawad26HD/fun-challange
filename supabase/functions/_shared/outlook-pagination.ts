import { OutlookError, requireGraphUrl } from './outlook-security.ts';

export interface MailPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export interface MailboxPageOptions<T> {
  cursor: string | null;
  initialUrl: string;
  maxPages: number;
  shouldYield: () => boolean;
  getPage: (url: string) => Promise<MailPage<T>>;
  process: (message: T) => boolean | Promise<boolean>;
  checkpoint: (cursor: string | null, finished: boolean) => void | Promise<void>;
}

export interface MailboxPageResult {
  processed: number;
  pages: number;
  has_more: boolean;
}

function cursorKey(url: string): string {
  const canonical = new URL(url);
  canonical.searchParams.sort();
  return canonical.href;
}

// Partial pages replay after interruption; process must deduplicate committed messages in storage.
export async function processMailboxPages<T>(options: MailboxPageOptions<T>): Promise<MailboxPageResult> {
  if (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 10 ||
    (options.cursor !== null && (typeof options.cursor !== 'string' || !options.cursor))) {
    throw new OutlookError('invalid_pagination_options', 500);
  }
  const initial = requireGraphUrl(options.initialUrl, 'page');
  let cursor = options.cursor === null ? initial : requireGraphUrl(options.cursor, 'page');
  const seen = new Set<string>();
  // A resumed sequence must not lead back to the start of the entire scan either.
  if (cursorKey(cursor) !== cursorKey(initial)) seen.add(cursorKey(initial));
  let processed = 0;
  let pages = 0;
  while (pages < options.maxPages) {
    if (options.shouldYield()) return { processed, pages, has_more: true };
    const currentKey = cursorKey(cursor);
    if (seen.has(currentKey)) throw new OutlookError('graph_pagination_cycle', 502);
    seen.add(currentKey);
    const page = await options.getPage(cursor);
    if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page.value) || page.value.length > 100 ||
      // Each Graph entity is an object; field-level validation remains the processor's job.
      Array.from(page.value).some(message => !message || typeof message !== 'object' || Array.isArray(message))) {
      throw new OutlookError('invalid_graph_page', 502);
    }
    let next: string | null = null;
    if (Object.prototype.hasOwnProperty.call(page, '@odata.nextLink')) {
      if (typeof page['@odata.nextLink'] !== 'string' || !page['@odata.nextLink']) throw new OutlookError('invalid_graph_page', 502);
      next = requireGraphUrl(page['@odata.nextLink'], 'page');
      if (seen.has(cursorKey(next))) throw new OutlookError('graph_pagination_cycle', 502);
    }
    // Validate the whole envelope and nextLink before processing any side effects.
    for (const message of page.value) {
      if (options.shouldYield()) return { processed, pages, has_more: true };
      const applied = await options.process(message);
      if (typeof applied !== 'boolean') throw new OutlookError('invalid_process_result', 500);
      if (applied) processed++;
    }
    // No check/yield between completing this page and durably acknowledging it.
    await options.checkpoint(next, next === null);
    pages++;
    if (next === null) return { processed, pages, has_more: false };
    cursor = next;
  }
  return { processed, pages, has_more: true };
}
