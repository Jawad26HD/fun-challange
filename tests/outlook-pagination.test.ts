import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processMailboxPages, type MailboxPageOptions, type MailPage } from '../supabase/functions/_shared/outlook-pagination.ts';
import { OutlookError } from '../supabase/functions/_shared/outlook-security.ts';

type Message = { id: string };
const initial = 'https://graph.microsoft.com/v1.0/me/messages?$top=25';
const next = initial + '&$skip=25';
const third = initial + '&$skip=50';
type Checkpoint = [string | null, boolean];
function fixture(overrides: Partial<MailboxPageOptions<Message>> = {}) {
  const fetched: string[] = [];
  const processed: string[] = [];
  const checkpoints: Checkpoint[] = [];
  const options: MailboxPageOptions<Message> = {
    initialUrl: initial, cursor: null, maxPages: 3, shouldYield: () => false,
    getPage: async url => { fetched.push(url); return { value: [{ id: 'one' }] }; },
    process: message => { processed.push(message.id); return true; },
    checkpoint: (cursor, finished) => { checkpoints.push([cursor, finished]); }, ...overrides,
  };
  return { options, fetched, processed, checkpoints };
}
const graphFailure = (error: unknown): boolean => error instanceof OutlookError && error.status === 502;

test('completed pages checkpoint in order; only applied messages count as processed', async () => {
  const trace: string[] = [];
  const { options, checkpoints } = fixture({
    getPage: async url => url === initial ? { value: [{ id: 'one' }, { id: 'seen' }], '@odata.nextLink': next } : { value: [{ id: 'two' }] },
    process: message => { trace.push(message.id); return message.id !== 'seen'; },
  });
  assert.deepEqual(await processMailboxPages(options), { processed: 2, pages: 2, has_more: false });
  assert.deepEqual(trace, ['one', 'seen', 'two']);
  assert.deepEqual(checkpoints, [[next, false], [null, true]]);
});

test('page budget leaves a durable next cursor and resumes from it', async () => {
  const first = fixture({ maxPages: 1, getPage: async () => ({ value: [{ id: 'one' }], '@odata.nextLink': next }) });
  assert.deepEqual(await processMailboxPages(first.options), { processed: 1, pages: 1, has_more: true });
  assert.deepEqual(first.checkpoints, [[next, false]]);
  const resumed = fixture({ cursor: first.checkpoints[0][0] });
  assert.deepEqual(await processMailboxPages(resumed.options), { processed: 1, pages: 1, has_more: false });
  assert.deepEqual(resumed.fetched, [next]);
});

test('yield before fetching never checkpoints or changes the cursor', async () => {
  const run = fixture({ cursor: next, shouldYield: () => true });
  assert.deepEqual(await processMailboxPages(run.options), { processed: 0, pages: 0, has_more: true });
  assert.deepEqual(run.fetched, []);
  assert.deepEqual(run.checkpoints, []);
});

test('partial-page yield replays safely with storage dedup, without advancing checkpoint', async () => {
  const stored = new Set<string>();
  let checks = 0;
  const run = fixture({
    shouldYield: () => ++checks > 2,
    getPage: async () => ({ value: [{ id: 'one' }, { id: 'two' }], '@odata.nextLink': next }),
    process: message => { if (stored.has(message.id)) return false; stored.add(message.id); return true; },
  });
  assert.deepEqual(await processMailboxPages(run.options), { processed: 1, pages: 0, has_more: true });
  assert.deepEqual(run.checkpoints, []);
  run.options.shouldYield = () => false;
  run.options.maxPages = 1;
  assert.deepEqual(await processMailboxPages(run.options), { processed: 1, pages: 1, has_more: true });
  assert.deepEqual([...stored], ['one', 'two']);
  assert.deepEqual(run.checkpoints, [[next, false]]);
});

test('processing failure never acknowledges a partial page, preserving prior checkpoint', async () => {
  const failure = new Error('simulated process failure');
  const run = fixture({
    getPage: async url => url === initial ? { value: [{ id: 'one' }], '@odata.nextLink': next } :
      { value: [{ id: 'two' }, { id: 'fail' }], '@odata.nextLink': third },
    process: message => { if (message.id === 'fail') throw failure; return true; },
  });
  await assert.rejects(processMailboxPages(run.options), error => error === failure);
  assert.deepEqual(run.checkpoints, [[next, false]]);
});

test('fetch or checkpoint failures stop immediately without fetching another page', async () => {
  const failure = new Error('simulated storage/network failure');
  const fetchRun = fixture({ getPage: async () => { throw failure; } });
  await assert.rejects(processMailboxPages(fetchRun.options), error => error === failure);
  assert.deepEqual(fetchRun.checkpoints, []);
  let calls = 0;
  const checkpointRun = fixture({
    getPage: async () => { calls++; return { value: [{ id: 'one' }], '@odata.nextLink': next }; },
    checkpoint: async () => { throw failure; },
  });
  await assert.rejects(processMailboxPages(checkpointRun.options), error => error === failure);
  assert.equal(calls, 1);
});

test('empty pages are valid and final pages finish even if their last message exhausts the deadline', async () => {
  const empty = fixture({ getPage: async () => ({ value: [] }) });
  assert.deepEqual(await processMailboxPages(empty.options), { processed: 0, pages: 1, has_more: false });
  assert.deepEqual(empty.checkpoints, [[null, true]]);
  let done = false;
  const final = fixture({ shouldYield: () => done, process: () => { done = true; return true; } });
  assert.deepEqual(await processMailboxPages(final.options), { processed: 1, pages: 1, has_more: false });
  assert.deepEqual(final.checkpoints, [[null, true]]);
});

test('malformed/oversized Graph envelopes and nextlinks fail before side effects', async () => {
  for (const page of [null, [], {}, { value: null }, { value: {} }, { value: [null] }, { value: [1] }, { value: [[]] },
    { value: Array.from({ length: 101 }, () => ({ id: 'too-many' })) },
    { value: [{ id: 'one' }], '@odata.nextLink': null }, { value: [], '@odata.nextLink': '' },
    { value: [], '@odata.nextLink': 25 },
    { value: [{ id: 'one' }], '@odata.nextLink': 'https://evil.com/steal' },
    { value: [{ id: 'one' }], '@odata.nextLink': initial + '&$expand=attachments' },
  ]) {
    const run = fixture({ getPage: async () => page as unknown as MailPage<Message> });
    await assert.rejects(processMailboxPages(run.options), graphFailure);
    assert.deepEqual(run.processed, []);
    assert.deepEqual(run.checkpoints, []);
  }
});

test('self, multi-page, encoded/reordered and resumed-to-initial cycles fail closed', async () => {
  const self = fixture({ getPage: async () => ({ value: [{ id: 'one' }], '@odata.nextLink': initial }) });
  await assert.rejects(processMailboxPages(self.options), graphFailure);
  assert.deepEqual(self.checkpoints, []);
  assert.deepEqual(self.processed, []);
  const cycle = fixture({ getPage: async url => ({ value: [{ id: url }], '@odata.nextLink': url === initial ? next : initial }) });
  await assert.rejects(processMailboxPages(cycle.options), graphFailure);
  assert.deepEqual(cycle.checkpoints, [[next, false]]);
  const reordered = fixture({ cursor: next, getPage: async () => ({ value: [],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?%24skip=25&%24top=25' }) });
  await assert.rejects(processMailboxPages(reordered.options), graphFailure);
  const resumed = fixture({ cursor: third, getPage: async () => ({ value: [], '@odata.nextLink': initial }) });
  await assert.rejects(processMailboxPages(resumed.options), graphFailure);
  assert.deepEqual(resumed.checkpoints, []);
});

test('hard page limits and invalid initial/resume cursors are enforced before fetching', async () => {
  for (const maxPages of [0, -1, 1.5, 11, Infinity, NaN]) {
    const run = fixture({ maxPages });
    await assert.rejects(processMailboxPages(run.options), OutlookError);
    assert.deepEqual(run.fetched, []);
  }
  for (const overrides of [{ cursor: '' }, { cursor: 'https://evil.com/' }, { initialUrl: 'https://evil.com/' }]) {
    const run = fixture(overrides);
    await assert.rejects(processMailboxPages(run.options), OutlookError);
    assert.deepEqual(run.fetched, []);
  }
  const run = fixture({ maxPages: 10, getPage: async url => {
    const skip = Number(new URL(url).searchParams.get('$skip') ?? 0);
    return { value: Array.from({ length: 100 }, (_, i) => ({ id: `${skip + i}` })), '@odata.nextLink': `${initial}&$skip=${skip + 100}` };
  } });
  assert.deepEqual(await processMailboxPages(run.options), { processed: 1000, pages: 10, has_more: true });
  assert.equal(run.checkpoints.length, 10);
});
