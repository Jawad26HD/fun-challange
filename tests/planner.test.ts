import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoData } from '../src/data/demo';
import { applyDemoUpdate, creditSummary, emptyPlanner, getNextLecture, getTodayLectures, localDateInput, localTimeInput, overdueEvents, sortEvents, toEventISO, upcomingEvents, validateEvent } from '../src/lib/planner';

const now = new Date('2026-11-19T09:00:00Z');

test('pending deadlines sort earliest first without mutating source data', () => {
  const data = createDemoData(now);
  const original = data.events.map(event => event.id);
  const sorted = sortEvents(data.events);
  for (let i = 1; i < sorted.length; i++) assert.ok(Date.parse(sorted[i - 1]!.starts_at) <= Date.parse(sorted[i]!.starts_at));
  assert.deepEqual(data.events.map(event => event.id), original);
  assert.ok(overdueEvents(data.events, now).every(event => event.status === 'pending' && Date.parse(event.starts_at) < now.getTime()));
  assert.ok(upcomingEvents(data.events, now).every(event => event.status === 'pending' && Date.parse(event.starts_at) >= now.getTime()));
  assert.equal(upcomingEvents(data.events, now, 1).length, 1);
  assert.deepEqual(upcomingEvents(data.events, now, 0), []);
});

test('deadline at the current instant remains upcoming until it passes', () => {
  const event = { ...createDemoData(now).events[0]!, starts_at: now.toISOString(), status: 'pending' as const };
  assert.equal(upcomingEvents([event], now).length, 1);
  assert.equal(overdueEvents([event], now).length, 0);
  assert.equal(overdueEvents([event], new Date(now.getTime() + 1)).length, 1);
});

test('Amman wall-clock inputs round-trip and reject invalid dates', () => {
  assert.equal(toEventISO('2026-11-19', '12:30'), '2026-11-19T09:30:00.000Z');
  assert.equal(localDateInput('2026-11-19T23:00:00Z'), '2026-11-20');
  assert.equal(localTimeInput('2026-11-19T23:00:00Z'), '02:00');
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01']) assert.throws(() => toEventISO(date, '12:00'));
  for (const time of ['24:00', '12:60', '9:00']) assert.throws(() => toEventISO('2026-11-19', time));
  assert.equal(toEventISO('2028-02-29', '10:00'), '2028-02-29T07:00:00.000Z');
  assert.throws(() => toEventISO('2026-03-08', '02:30', 'America/New_York'));
});

test('timetable uses campus weekdays and finds next week after the last lecture', () => {
  const course = { ...createDemoData(now).courses[0]!, meeting_days: [4], start_time: '09:00', end_time: '10:00' };
  const today = getTodayLectures([course], now);
  assert.equal(today[0]?.starts_at, '2026-11-19T06:00:00.000Z');
  assert.equal(getNextLecture([course], now)?.starts_at, '2026-11-26T06:00:00.000Z');
  assert.equal(getNextLecture([], now), null);
});

test('study credits and fresh settings do not share mutable arrays', () => {
  const a = emptyPlanner();
  const b = emptyPlanner();
  a.settings.approved_senders.push('teacher@university.edu');
  a.settings.alert_types.exam = false;
  assert.equal(b.settings.approved_senders.length, 0);
  assert.equal(b.settings.alert_types.exam, true);
  const data = createDemoData(now);
  assert.equal(creditSummary(data.study_courses, 132).completed, 48);
  assert.equal(creditSummary([], 0).percent, 0);
});

test('demo proposals retain audit and ambiguous proposals cannot be applied', () => {
  const data = createDemoData(now);
  const applied = data.updates.find(update => update.status === 'applied')!;
  const pending = data.updates.find(update => update.status === 'pending')!;
  assert.throws(() => applyDemoUpdate(data, pending.id, 'apply'), /matching|ambiguous|incomplete/u);
  const reverted = applyDemoUpdate(data, applied.id, 'revert');
  assert.equal(reverted.updates.find(update => update.id === applied.id)?.status, 'reverted');
  assert.equal(reverted.events.find(event => event.id === applied.event_id)?.starts_at, applied.previous_start);
  assert.equal(applyDemoUpdate(reverted, applied.id, 'revert'), reverted);
  const stale = { ...data, events: data.events.map(event => event.id === applied.event_id ? { ...event, location: 'Manual edit' } : event) };
  assert.throws(() => applyDemoUpdate(stale, applied.id, 'revert'), /changed/u);
  assert.equal(applyDemoUpdate(data, pending.id, 'dismiss').updates.find(update => update.id === pending.id)?.status, 'dismissed');
});

test('event validation rejects missing titles, invalid instants, and unknown courses', () => {
  const data = createDemoData(now);
  const event = data.events[0]!;
  assert.equal(validateEvent(event, data.courses), null);
  assert.match(validateEvent({ ...event, title: ' ' }, data.courses)!, /title/u);
  assert.match(validateEvent({ ...event, starts_at: '2026-11-19T09:00:00' }, data.courses)!, /timezone/u);
  assert.match(validateEvent({ ...event, course_id: 'missing' }, data.courses)!, /course/u);
});
