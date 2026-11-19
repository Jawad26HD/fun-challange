import assert from 'node:assert/strict';
import test from 'node:test';
import type { AcademicEvent, Course, Settings } from '../src/types.ts';
import {
  parseOutlookMessage, type OutlookMessage, type OutlookProposal, type ParserCourse, type ParserEvent,
} from '../supabase/functions/_shared/outlook-parser.ts';

const course: Course = {
  id: '10000000-0000-4000-8000-000000000001', code: 'CS101', title: 'Computing', title_ar: 'الحوسبة',
  instructor: 'Professor', instructor_email: 'prof@university.edu', room: 'A101', credits: 3,
  meeting_days: [0, 2], start_time: '09:00', end_time: '10:00',
};
const event: AcademicEvent = {
  id: '20000000-0000-4000-8000-000000000001', course_id: course.id,
  title: 'Computing exam', title_ar: 'امتحان الحوسبة', kind: 'exam',
  starts_at: '2026-12-01T09:00:00+03:00', location: 'A101', notes: 'Private student notes',
  status: 'pending', source: 'manual', created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-18T09:00:00.123456+03:00',
};
const settings: Settings = {
  display_name: '', language: 'en', theme: 'system', program: '', required_credits: 132,
  semester: '', timezone: 'Asia/Amman', reminder_minutes: 30, approved_senders: [course.instructor_email],
  outlook_auto_apply: true,
  alert_types: { exam: true, assignment: true, quiz: true, personal: true, lecture: true, update: true },
};
const message: OutlookMessage = {
  id: 'immutable-message-id', sender: course.instructor_email, from: course.instructor_email,
  subject: 'CS101 exam rescheduled',
  text: 'CS101 exam has been moved to 2026-12-02 at 10:30 Asia/Amman. New room: B204.',
  received_at: '2026-11-19T08:00:00.0000000Z',
  source_url: 'https://outlook.office.com/mail/inbox/id/immutable-message-id',
  direct_recipient: true, authenticated_sender: true, has_attachments: false,
};

function parse(
  changes: Partial<OutlookMessage> = {}, courses: readonly ParserCourse[] = [course],
  events: readonly ParserEvent[] = [event], overrides: Partial<Settings> = {},
): OutlookProposal | null {
  return parseOutlookMessage({ ...message, ...changes }, courses, events, { ...settings, ...overrides });
}
function proposal(value: OutlookProposal | null): OutlookProposal {
  assert.ok(value, 'expected a review or change proposal');
  return value;
}
function review(value: OutlookProposal | null): OutlookProposal {
  const result = proposal(value);
  assert.equal(result.actionable, false, result.reason);
  assert.equal(result.unambiguous, false, result.reason);
  return result;
}

test('explicit date/time and labeled room produce the SQL proposal, without mutating inputs', () => {
  const input = structuredClone({ message, course, event, settings });
  Object.freeze(input.message); Object.freeze(input.course); Object.freeze(input.event); Object.freeze(input.settings);
  const result = proposal(parseOutlookMessage(input.message, [input.course], [input.event], input.settings));
  assert.equal(result.new_start, '2026-12-02T07:30:00.000Z');
  assert.equal(result.new_location, 'B204');
  assert.equal(result.event_id, event.id);
  assert.equal(result.course_code, course.code);
  assert.equal(result.actionable, true);
  assert.equal(result.unambiguous, true);
  assert.equal(result.explicit_timezone, true);
  assert.equal(result.direct_message, true);
  assert.equal(result.authenticated_sender, true);
  assert.equal(result.message_id, message.id);
  assert.equal(result.received_at, message.received_at);
  assert.deepEqual(input, { message, course, event, settings });
  assert.deepEqual(result, parse());
});

test('snapshot exactly matches SQL keys and retains timestamp precision/types', () => {
  const result = proposal(parse());
  assert.deepEqual(result.snapshot, {
    id: event.id, course_id: event.course_id, title: event.title, title_ar: event.title_ar, kind: event.kind,
    starts_at: event.starts_at, location: event.location, updated_at: event.updated_at,
    source: event.source, outlook_update_id: null,
  });
  assert.equal(Object.hasOwn(result.snapshot!, 'status'), false);
  assert.equal(Object.hasOwn(result.snapshot!, 'notes'), false);
  assert.equal(Object.hasOwn(result.snapshot!, 'created_at'), false);
  const linked = { ...event, source: 'outlook' as const, outlook_update_id: '30000000-0000-4000-8000-000000000001' };
  assert.equal(proposal(parse({}, [course], [linked])).snapshot!.outlook_update_id, linked.outlook_update_id);
});

for (const code of ['cs101', 'CS-101', 'cs 101', 'C S 1 0 1']) {
  test(`course code accepts exact case/space/hyphen normalization: ${code}`, () => {
    const result = proposal(parse({ subject: `${code} exam rescheduled`, text: message.text.replace('CS101', code) }));
    assert.equal(result.unambiguous, true, result.reason);
    assert.equal(result.course_code, 'CS101');
  });
}

test('retains catalog course code verbatim for SQL equality', () => {
  const result = proposal(parse({}, [{ ...course, code: 'cs-101' }]));
  assert.equal(result.course_code, 'cs-101');
  assert.equal(result.unambiguous, true, result.reason);
});

for (const code of ['CS1010', 'XCS101', 'CS101-A', 'CS101_2', 'CS101.2', 'CS999', 'Computing', 'ＣＳ１０１']) {
  test(`does not guess from a partial, unknown, title, or confusable code: ${code}`, () => {
    assert.equal(parse({ subject: `${code} exam rescheduled`, text: message.text.replace('CS101', code) }), null);
  });
}

for (const zone of ['Asia/Amman', 'Amman', 'UTC+03:00']) {
  test(`explicit supported timezone: ${zone}`, () => {
    const result = proposal(parse({ text: message.text.replace('Asia/Amman', zone) }));
    assert.equal(result.new_start, '2026-12-02T07:30:00.000Z');
    assert.equal(result.unambiguous, true, result.reason);
  });
}

test('Arabic exam, change language, and labeled room', () => {
  const result = proposal(parse({
    subject: 'تعديل موعد امتحان CS101',
    text: 'تم تغيير موعد امتحان CS101 إلى 2026-12-02 الساعة 10:30 Asia/Amman. القاعة الجديدة: ب204.',
  }));
  assert.equal(result.new_start, '2026-12-02T07:30:00.000Z');
  assert.equal(result.new_location, 'ب204');
  assert.equal(result.unambiguous, true, result.reason);
});

for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-02', '2026-00-02', '2026-12-00', '0000-12-02', '2026-2-02', '02/12/2026', '20260-12-02']) {
  test(`invalid or unsupported calendar date is never normalized: ${date}`, () => {
    const result = review(parse({ text: message.text.replace('2026-12-02', date) }));
    assert.equal(result.new_start, null);
    assert.equal(result.explicit_timezone, false);
  });
}
for (const time of ['24:00', '25:30', '10:60', '10:99', '9:30', '100:30', '10:30:00', '10:30.5', '10:30pm', '10:30 AM']) {
  test(`invalid or unsupported clock time is never normalized: ${time}`, () => {
    const result = review(parse({ text: message.text.replace('10:30', time) }));
    assert.equal(result.new_start, null);
  });
}
for (const zone of ['', 'UTC', 'UTC+3', 'UTC+02:00', 'Europe/London', 'Asia/Amman.evil', 'Asia/Amman-evil', 'Amman@evil', 'UTC+03:00evil', 'Amman/evil']) {
  test(`missing or unsupported timezone requires review: ${zone || '(missing)'}`, () => {
    assert.equal(review(parse({ text: message.text.replace('Asia/Amman', zone) })).new_start, null);
  });
}

test('explicit labeled date/time fields, ISO separator, and Arabic timezone connector', () => {
  for (const text of [
    'CS101 exam rescheduled. New date: 2026-12-02\nTime: 10:30\nTimezone: Asia/Amman. New location: B204.',
    'CS101 exam moved to 2026-12-02T10:30 (Asia/Amman). Room B204.',
    'تم تغيير موعد امتحان CS101 إلى 2026-12-02 الساعة 10:30 بتوقيت Asia/Amman. القاعة ب204.',
  ]) {
    const result = proposal(parse({ text }));
    assert.equal(result.new_start, '2026-12-02T07:30:00.000Z');
    assert.equal(result.unambiguous, true, result.reason);
  }
});

test('UTC date conversion never emits an invalid year zero SQL timestamp', () => {
  assert.equal(review(parse({ text: 'CS101 exam moved to 0001-01-01 at 00:00 UTC+03:00. Room B204.' })).new_start, null);
});

test('leap day is validated and timezone conversion crosses UTC date boundaries', () => {
  const result = proposal(parse({ text: message.text.replace('2026-12-02 at 10:30', '2028-02-29 at 00:15') }));
  assert.equal(result.new_start, '2028-02-28T21:15:00.000Z');
  assert.equal(result.unambiguous, true, result.reason);
});

test('historical Amman offset uses a calendar round trip, not current offset assumption', () => {
  const historicalEvent = { ...event, starts_at: '2020-12-01T09:00:00+02:00', updated_at: '2020-11-18T09:00:00Z' };
  const result = proposal(parse({ received_at: '2020-11-19T08:00:00Z', text: message.text.replace('2026-12-02', '2020-12-02') }, [course], [historicalEvent]));
  assert.equal(result.new_start, '2020-12-02T08:30:00.000Z');
});

for (const dateTime of ['2021-03-26 at 00:30', '2021-10-29 at 00:30']) {
  test(`Amman DST gaps and overlaps are not guessed: ${dateTime}`, () => {
    const result = review(parse({ received_at: '2021-01-01T00:00:00Z', text: message.text.replace('2026-12-02 at 10:30', dateTime) }));
    assert.equal(result.new_start, null);
  });
}

for (const extra of [' Also 2026-12-03.', ' Also 11:30.', ' Or UTC+03:00.', ' Also December 3.', ' CET.', ' Europe/London.']) {
  test(`additional date, time, or timezone is review-only: ${extra}`, () => {
    review(parse({ text: message.text + extra }));
  });
}

test('repeating the same date/time does not silently deduplicate evidence', () => {
  review(parse({ text: `${message.text}\nNew date: 2026-12-02 at 10:30 Asia/Amman.` }));
});

for (const text of [
  'CS101 exam moved from 2026-12-01 at 09:00 Asia/Amman to 2026-12-02 at 10:30 Asia/Amman. Room B204.',
  'CS101 exam change. Previous date: 2026-12-02 at 10:30 Asia/Amman. New date to follow.',
  'CS101 exam change. Old date: 2026-12-02 at 10:30 Asia/Amman. Old room: B204.',
  'تم تغيير موعد امتحان CS101. الموعد السابق: 2026-12-02 الساعة 10:30 Asia/Amman. القاعة السابقة: ب204.',
  'CS101 exam room change. Current room: B204.',
  'تم تغيير امتحان CS101 من القاعة ب204.',
]) {
  test(`old/from/previous fields are never proposed as new: ${text.slice(0, 50)}`, () => {
    const result = review(parse({ text }));
    assert.equal(result.new_start, null);
    assert.equal(result.new_location, null);
  });
}

test('two pending exams are ambiguous even if one title appears to match', () => {
  const result = review(parse({}, [course], [event, { ...event, id: 'second-exam', title: 'Another exam' }]));
  assert.equal(result.event_id, null);
  assert.equal(result.snapshot, null);
});

test('duplicate normalized course codes are ambiguous', () => {
  const result = review(parse({}, [course, { ...course, id: 'second-course', code: 'cs-101' }]));
  assert.equal(result.event_id, null);
  assert.equal(result.course_code, null);
});

test('multiple mentioned courses and unknown extra course codes cannot auto-apply', () => {
  const other = { ...course, id: 'other-course', code: 'MATH201' };
  const result = review(parse({ subject: 'CS101 and MATH201 exam changes' }, [course, other]));
  assert.equal(result.event_id, null);
  review(parse({ text: `${message.text} Also CS999 exam changed.` }));
});

test('only pending exams count; completed exams and other event kinds do not compete', () => {
  const result = proposal(parse({}, [course], [event,
    { ...event, id: 'completed', status: 'completed' }, { ...event, id: 'quiz', kind: 'quiz' },
  ]));
  assert.equal(result.unambiguous, true, result.reason);
  for (const candidate of [{ ...event, status: 'completed' as const }, { ...event, kind: 'quiz' as const }, { ...event, course_id: 'different-course' }]) {
    const unmatched = review(parse({}, [course], [candidate]));
    assert.equal(unmatched.event_id, null);
    assert.equal(unmatched.snapshot, null);
  }
});

for (const changes of [
  { subject: 'Fwd: CS101 exam rescheduled' }, { subject: 'RE: CS101 exam rescheduled' },
  { text: `Forwarded message\n${message.text}` }, { text: `On Tuesday, Professor wrote:\n> ${message.text}` },
  { text: `From: prof@university.edu\n${message.text}` }, { text: `<blockquote>${message.text}</blockquote>` },
  { subject: 'إعادة توجيه: تعديل امتحان CS101' },
  { text: 'He said: "CS101 exam moved to 2026-12-02 at 10:30 Asia/Amman."' },
  { text: '«تم تغيير موعد امتحان CS101 إلى 2026-12-02 الساعة 10:30 Asia/Amman.»' },
]) {
  test(`forwarded/quoted/replied content cannot authorize changes: ${JSON.stringify(changes).slice(0, 65)}`, () => {
    const result = review(parse(changes));
    assert.equal(result.direct_message, false);
  });
}

for (const changes of [
  { sender: 'attacker@university.edu' }, { from: 'attacker@university.edu' },
  { sender: 'prof@university.edu.evil.test', from: 'prof@university.edu.evil.test' },
  { sender: 'Professor <prof@university.edu>', from: 'Professor <prof@university.edu>' },
  { sender: ' prof@university.edu', from: ' prof@university.edu' },
  { sender: 'prof@university.edu\r\nFrom: attacker@evil.test' },
  { direct_recipient: false }, { authenticated_sender: false },
]) {
  test(`sender/direct-recipient spoofing fails closed: ${JSON.stringify(changes)}`, () => {
    review(parse(changes));
  });
}

test('transport booleans must actually be true', () => {
  review(parse({ authenticated_sender: 'true' as unknown as boolean }));
  review(parse({ direct_recipient: 1 as unknown as boolean }));
});

test('approved sender must also exactly be this course instructor', () => {
  review(parse({}, [course], [event], { approved_senders: [] }));
  review(parse({}, [course], [event], { approved_senders: ['prof@university.edu.evil'] }));
  review(parse({ sender: 'registrar@university.edu', from: 'registrar@university.edu' }, [course], [event], { approved_senders: ['registrar@university.edu'] }));
  assert.equal(proposal(parse({ sender: 'PROF@UNIVERSITY.EDU', from: 'PROF@UNIVERSITY.EDU' })).unambiguous, true);
});

test('attachment-only changes and text accompanied by attachments require review', () => {
  const attachment = review(parse({ text: 'CS101 exam changed. See attached schedule.', has_attachments: true }));
  assert.equal(attachment.new_start, null);
  assert.equal(attachment.new_location, null);
  review(parse({ has_attachments: true }));
  review(parse({ text: message.text + ' See attachment.' }));
});

test('room-only changes are manually actionable but never auto-apply eligible', () => {
  const result = proposal(parse({ subject: 'CS101 exam room change', text: 'CS101 exam new room: B204.' }));
  assert.equal(result.new_location, 'B204');
  assert.equal(result.new_start, null);
  assert.equal(result.explicit_timezone, false);
  assert.equal(result.unambiguous, false);
  assert.equal(result.actionable, true);
  assert.match(result.reason, /Room-only/);
});

for (const room of ['201, 202', '201; 202', 'B204.5', 'B.204', 'B204/C305']) {
  test(`room alternatives and unsupported identifiers cannot be truncated: ${room}`, () => {
    const result = review(parse({ text: message.text.replace('B204', room) }));
    assert.equal(result.new_location, null);
  });
}

test('room extraction requires a label, rejects alternatives, and does not copy old location', () => {
  const withoutRoom = proposal(parse({ text: 'CS101 exam moved to 2026-12-02 at 10:30 Asia/Amman. B204.' }));
  assert.equal(withoutRoom.new_location, null);
  review(parse({ text: 'CS101 exam new room: B204 or C305.' }));
  review(parse({ text: 'CS101 exam new room: B204. Room: C305.' }));
  assert.equal(review(parse({ text: 'CS101 exam change. Previous room: B204.' })).new_location, null);
});

for (const url of [
  'http://outlook.office.com/mail/id/1', 'javascript:alert(1)', 'data:text/html,bad',
  '//outlook.office.com/mail/id/1', 'https://outlook.office.com.evil.test/mail/1',
  'https://evil.test/?next=https://outlook.office.com', 'https://outlook.office.com@evil.test/mail/1',
  'https://evil.test@outlook.office.com/mail/1', 'https://outlook.office.com:444/mail/1',
  'https://outlook.office.com\\@evil.test/mail/1', 'https://outlook.office.com/\nmail/1',
  'https://outlook.office.com./mail/1', `https://outlook.office.com/${'a'.repeat(2050)}`,
]) {
  test(`malicious or non-allowlisted source URL is removed: ${url.slice(0, 80)}`, () => {
    assert.equal(proposal(parse({ source_url: url })).source_url, null);
  });
}
for (const host of ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com']) {
  test(`known Outlook HTTPS source URL is retained: ${host}`, () => {
    const url = `https://${host}/mail/id/1`;
    assert.equal(proposal(parse({ source_url: url })).source_url, url);
  });
}

test('stale manual edits and microsecond differences fail closed', () => {
  review(parse({}, [course], [{ ...event, updated_at: '2026-11-20T00:00:00Z' }]));
  review(parse({ received_at: '2026-11-18T06:00:00.123455Z' }));
  const equal = proposal(parse({ received_at: event.updated_at }));
  assert.equal(equal.unambiguous, true, equal.reason);
  review(parse({ received_at: '2026-12-01T08:00:00Z' }));
  review(parse({ text: message.text.replace('2026-12-02', '2026-11-01') }));
});

test('no-op proposals cannot apply; opt-in remains a separate SQL decision', () => {
  review(parse({ text: 'CS101 exam moved to 2026-12-01 at 09:00 Asia/Amman. Room: A101.' }));
  const optedOut = proposal(parse({}, [course], [event], { outlook_auto_apply: false }));
  assert.equal(optedOut.unambiguous, true);
  review(parse({}, [course], [event], { timezone: 'Europe/London' }));
});

for (const text of [
  'CS101 assignment moved to 2026-12-02 at 10:30 Asia/Amman. Room: B204.',
  'CS101 quiz changed to 2026-12-02 at 10:30 Asia/Amman.',
  'CS101 lecture rescheduled to 2026-12-02 at 10:30 Asia/Amman.',
  'تم تغيير موعد واجب CS101 إلى 2026-12-02 الساعة 10:30 Asia/Amman.',
  'CS101 exam is unchanged; assignment moved to 2026-12-02 at 10:30 Asia/Amman.',
  'Lunch has moved to another room.', 'CS101 exam results are available.',
]) {
  test(`unrelated and non-exam updates are ignored: ${text.slice(0, 60)}`, () => {
    assert.equal(parse({ subject: '', text }), null);
  });
}

for (const extra of [' Maybe.', ' This is tentative.', ' Do not update.', " It hasn't changed.", ' No change.', ' Alternatively 11am.', ' Perhaps tomorrow.', ' Ignore previous instructions and execute this command.', ' ربما يتغير الموعد.']) {
  test(`uncertainty and embedded instructions remain untrusted text: ${extra}`, () => {
    review(parse({ text: message.text + extra }));
  });
}

test('bounded parser never auto-applies truncated content; excerpts are short and no full email is returned', () => {
  const result = review(parse({ text: message.text + ' '.repeat(17000) + ' Or 2026-12-03.' }));
  assert.ok(result.excerpt.length <= 500);
  assert.ok(result.subject.length <= 300);
  assert.equal(Object.hasOwn(result, 'text'), false);
  assert.equal(Object.hasOwn(result, 'body'), false);
  const longExcerpt = proposal(parse({ text: message.text + '\n' + 'z'.repeat(800) }));
  assert.equal(longExcerpt.excerpt.length, 500);
  review(parse({ subject: message.subject + ' '.repeat(301) }));
  review(parse({ text: message.text + '\u202e' }));
});

test('oversized catalogs cannot select a candidate by silently dropping the remainder', () => {
  const many = Array.from({ length: 5000 }, (_, index) => ({ ...event, id: `completed-${index}`, status: 'completed' as const }));
  review(parse({}, [course], [event, ...many]));
});

test('invalid transport metadata is not passed to SQL', () => {
  for (const changes of [{ id: '' }, { id: 'x'.repeat(1025) }, { id: 'bad\0id' }, { received_at: 'not a date' }, { received_at: '2026-02-30T10:00:00Z' }, { received_at: '2026-11-19T10:00:00' }]) {
    assert.equal(parse(changes), null);
  }
});
