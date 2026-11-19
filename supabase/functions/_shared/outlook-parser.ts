import type { AcademicEvent, Course, Settings } from '../../../src/types.ts';

export type ParserCourse = Course;
export type ParserEvent = AcademicEvent & { outlook_update_id?: string | null };

export interface OutlookMessage {
  id: string;
  sender: string;
  from: string;
  subject: string;
  text: string;
  received_at: string;
  source_url?: string;
  direct_recipient: boolean;
  authenticated_sender: boolean;
  has_attachments?: boolean;
}

// EXACT keys of private.event_snapshot, not a serialization of the entire event.
// In particular SQL includes id/title_ar, but does not include status or notes.
export type EventSnapshot = Pick<AcademicEvent,
  'id' | 'course_id' | 'title' | 'title_ar' | 'kind' | 'starts_at' | 'location' | 'updated_at' | 'source'
> & { outlook_update_id: string | null };

export interface OutlookProposal {
  message_id: string;
  sender: string;
  subject: string;
  excerpt: string;
  received_at: string;
  source_url: string | null;
  event_id: string | null;
  course_code: string | null;
  snapshot: EventSnapshot | null;
  new_start: string | null;
  new_location: string | null;
  reason: string;
  actionable: boolean;
  unambiguous: boolean;
  direct_message: boolean;
  explicit_timezone: boolean;
  authenticated_sender: boolean;
}

const MAX_TEXT = 16000;
const MAX_CATALOG = 5000;
const OUTLOOK_HOSTS = new Set(['outlook.office.com', 'outlook.office365.com', 'outlook.live.com']);
const EXAM = /\b(?:exams?|examinations?|midterms?)\b|(?<!\p{L})(?:ال)?(?:امتحان|امتحانات|اختبار|اختبارات)(?!\p{L})/iu;
const CHANGE = /\b(?:rescheduled?|moved?|changed?|postponed?|updated?|new\s+(?:date|time|room|location))\b|(?:تغيير|تغير|تعديل|تأجيل|تاجيل|نقل|الجديد|الجديدة)/iu;
const NON_EXAM = /\b(?:assignments?|homework|quizzes?|quiz|lectures?|tutorials?)\b|(?<!\p{L})(?:ال)?(?:واجب|واجبات|محاضرة|محاضرات|كويز)(?!\p{L})/iu;
const FORWARDED = /^(?:\s*(?:re|fw|fwd)\s*:)|(?:forwarded message|original message|begin forwarded|on [^\n]{1,160} wrote:)|^\s*(?:>|from:|sent:|to:|subject:|من:|أرسل:)|<\/?(?:blockquote|html)\b|(?:إعادة توجيه|اعادة توجيه|رسالة محولة|رسالة معاد|اقتباس|إقتباس)/imu;
const HISTORICAL = /\b(?:old|from|previous|previously|original|formerly|was|current|currently|existing|unchanged|remains?|instead\s+of)\b|(?:السابق|القديم|السابقة|القديمة|الحالي|الحالية|بدلا من|بدلاً من|كان الموعد)|(?<!\p{L})من(?!\p{L})/iu;
const UNCERTAIN = /\b(?:maybe|perhaps|probably|tentative|proposed|might|could|if|whether|or|not|no|never|cancelled|canceled|cancel|tomorrow|today|yesterday|next|am|pm|alternatively|either|between|until|unless|approximately|awaiting)\b|\b(?:isn|wasn|hasn|haven|don|doesn|didn|won|wouldn|shouldn|can|couldn)['’]t\b|\d\s*[ap]\.?m\b|\?|(?:ربما|قد يتم|محتمل|مقترح|لاحقا|لاحقاً|غدا|غداً|غدًا|اليوم|أمس|القادم|يلغى|إلغاء|الغاء|لم يتم|لن يتم|لا تغيير|أو|او|؟)/iu;
const ATTACHMENT = /\b(?:attachments?|attached)\b|(?:المرفق|مرفقات|مرفقة)/iu;
const INSTRUCTIONS = /ignore[^\n]{0,80}instructions|system\s+prompt|(?:execute|run)\s+(?:this\s+)?(?:command|code|script)|(?:api|secret)\s+key|تجاهل التعليمات/iu;
const CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\p{Cf}]/u;
const ZONE = /(?<![\p{L}\p{N}_/])(?:Asia\/Amman|Amman|UTC\+03:00)(?=$|[\s,;.)\]،؛])(?!\.[\p{L}\p{N}])/giu;
const OTHER_ZONE = /\b(?:UTC|GMT|[ECMP][DS]T|CET|CEST|EET|EEST|BST)\b|(?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+/iu;
const DATE_LIKE = /(?<![\p{L}\p{N}_])\d{1,6}[-/]\d{1,2}[-/]\d{1,6}(?!\d)/gu;
const TIME_LIKE = /(?<!\d)\d{1,3}:\d{1,3}(?::\d{1,3})?(?:\.\d+)?(?!\d)/gu;
const NAMED_DATE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d|\d\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/iu;

function safeSource(value?: string): string | null {
  if (!value || value.length > 2048 || /[\s\\\p{Cc}\p{Cf}]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !OUTLOOK_HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

function normalizeCode(value: string): string {
  return value.replace(/[\s-]/gu, '').toUpperCase();
}

function codePattern(code: string): RegExp | null {
  const normalized = normalizeCode(code);
  if (!normalized || code.length > 40) return null;
  const escaped = [...normalized].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*');
  // Do not match CS101 inside XCS101, CS1010, CS101-A, or a URL identifier.
  return new RegExp(`(?<![\\p{L}\\p{N}_/.-])${escaped}(?![\\p{L}\\p{N}_/-]|\\.[\\p{L}\\p{N}])`, 'iu');
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date.startsWith('0000')) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// Preserve sub-millisecond precision when comparing Graph and PostgreSQL timestamps.
function instant(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
  if (!match || !validDate(match[1]!)) return null;
  const milliseconds = Date.parse(`${match[1]}T${match[2]}${match[4]}`);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1000000n + BigInt((match[3] ?? '').padEnd(9, '0')) : null;
}

const ammanFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Amman', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function ammanWallTime(value: Date): string {
  const parts = ammanFormat.formatToParts(value);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === name)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function startInstant(date: string, time: string, zone: string): string | null {
  if (!validDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) return null;
  const wall = `${date}T${time}`;
  const milliseconds = Date.parse(`${wall}:00.000Z`);
  if (zone.toUpperCase() === 'UTC+03:00') {
    const result = new Date(milliseconds - 180 * 60000).toISOString();
    return instant(result) !== null ? result : null;
  }
  // Amman has historical DST. Never silently normalize a gap or choose an overlap.
  const candidates = [120, 180].map(offset => new Date(milliseconds - offset * 60000))
    .filter(candidate => ammanWallTime(candidate) === wall);
  return candidates.length === 1 ? candidates[0]!.toISOString() : null;
}

function snapshot(event: ParserEvent): EventSnapshot {
  return {
    id: event.id, course_id: event.course_id, title: event.title, title_ar: event.title_ar,
    kind: event.kind, starts_at: event.starts_at, location: event.location,
    updated_at: event.updated_at, source: event.source, outlook_update_id: event.outlook_update_id ?? null,
  };
}

function rooms(text: string): { values: string[]; masked: string; invalid: boolean } {
  const values: string[] = [];
  let invalid = false;
  // Intentionally bounded room grammar: a label and up to four name/code tokens.
  const label = /(?<![\p{L}\p{N}_])(?:(?:new|updated)\s+)?(?:room|hall|location|(?:ال)?قاعة|(?:ال)?غرفة)(?![\p{L}\p{N}_])(?:[ \t]+الجديدة)?[ \t]*(?:(?:has been )?(?:changed|moved) to\s+|(?:is|to|هي|إلى|الى)\s+|[:=][ \t]*)?([^\n\r.,;،؛!?؟]{0,200})/giu;
  const masked = text.replace(label, (whole: string, raw: string, offset: number) => {
    const value = raw.trim();
    // A comma-separated list or an internal dot is not a single room identifier.
    const following = text.slice(offset + whole.length);
    if (/^(?:\.[\p{L}\p{N}]|[,;،؛][ \t]*\S)/u.test(following)) invalid = true;
    // A subject such as "exam room change" is a heading, not a room value.
    if (/^(?:change[ds]?|update[ds]?|تغيير|تعديل)?$/iu.test(value)) return whole;
    if (/^[\p{L}\p{N}][\p{L}\p{N} -]{0,79}$/u.test(value) && value.split(/\s+/u).length <= 4 &&
      !/\b(?:and|or|at|on|from|to|old|new|is|will|not|changed|moved|see|the)\b|(?:أو|الى|إلى|السابقة|القديمة)/iu.test(value) &&
      !/\d{4}-\d{2}-\d{2}/u.test(value)) values.push(value);
    else invalid = true;
    return ' '.repeat(whole.length);
  });
  return { values, masked, invalid };
}

// Unsupported wording stays review-only; SQL independently verifies consent and snapshot freshness.
export function parseOutlookMessage(
  message: OutlookMessage,
  courses: readonly ParserCourse[],
  events: readonly ParserEvent[],
  settings: Settings,
): OutlookProposal | null {
  const received = instant(message.received_at);
  // Invalid transport metadata cannot be persisted safely in the audit table.
  if (!message.id || message.id.length > 1024 || CONTROLS.test(message.id) || received === null) return null;
  const text = `${message.subject.slice(0, 300)}\n${message.text.slice(0, MAX_TEXT)}`;
  if (!EXAM.test(text) || !CHANGE.test(text) || NON_EXAM.test(text)) return null;

  const matched = courses.slice(0, MAX_CATALOG).filter(course => codePattern(course.code)?.test(text));
  if (!matched.length) return null; // No course-name, sender-only, or substring guesses.
  const course = matched.length === 1 ? matched[0]! : null;
  const candidates = course ? events.slice(0, MAX_CATALOG).filter(event =>
    event.course_id === course.id && event.kind === 'exam' && event.status === 'pending') : [];
  const event = candidates.length === 1 ? candidates[0]! : null;
  const problems: string[] = [];
  if (message.text.length > MAX_TEXT || message.subject.length > 300 || courses.length > MAX_CATALOG || events.length > MAX_CATALOG) problems.push('input_limit_exceeded');
  if (matched.length !== 1) problems.push('multiple_courses');
  if (!event) problems.push(candidates.length > 1 ? 'multiple_pending_exams' : 'no_unique_pending_exam');
  if (CONTROLS.test(text)) problems.push('control_characters');

  const forwarded = FORWARDED.test(text) || /["“”«»]|(?:^|\s)'[^\n]+/u.test(text);
  const historical = HISTORICAL.test(text);
  if (forwarded) problems.push('forwarded_or_quoted');
  if (historical) problems.push('old_or_previous_values');
  if (UNCERTAIN.test(text) || NAMED_DATE.test(text)) problems.push('uncertain_or_unsupported_language');
  if (message.has_attachments || ATTACHMENT.test(text)) problems.push('attachments_require_review');
  if (INSTRUCTIONS.test(text)) problems.push('instruction_like_content');

  const sender = message.sender.toLowerCase();
  const from = message.from.toLowerCase();
  const validSender = sender.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(sender);
  const trusted = validSender && sender === from && course?.instructor_email.toLowerCase() === sender && settings.approved_senders.includes(sender);
  const direct = message.direct_recipient === true && sender === from && !forwarded;
  const authenticated = message.authenticated_sender === true && validSender && sender === from;
  if (!trusted) problems.push('sender_not_approved_instructor');
  if (!direct) problems.push('not_a_direct_message');
  if (!authenticated) problems.push('sender_not_authenticated');
  if (settings.timezone !== 'Asia/Amman') problems.push('unsupported_settings_timezone');

  const room = rooms(text);
  // Detect additional course-like codes even when they are absent from the catalog.
  const otherCodes = [...room.masked.matchAll(/(?<![\p{L}\p{N}_-])[A-Za-z]{1,12}[ \t-]*\d{2,8}[A-Za-z]?(?![\p{L}\p{N}_:-])/gu)];
  if (course && otherCodes.some(match => normalizeCode(match[0]) !== normalizeCode(course.code))) problems.push('other_course_candidates');
  if (room.invalid || room.values.length > 1) problems.push('ambiguous_room');

  const zones = [...text.matchAll(ZONE)];
  const withoutZones = text.replace(ZONE, match => ' '.repeat(match.length));
  if (OTHER_ZONE.test(withoutZones)) problems.push('unsupported_or_conflicting_timezone');
  const dates = [...text.matchAll(DATE_LIKE)];
  const times = [...withoutZones.matchAll(TIME_LIKE)];
  const hasSchedule = dates.length > 0 || times.length > 0;
  let newStart: string | null = null;
  if (dates.length === 1 && times.length === 1 && zones.length === 1 && !historical) {
    const date = dates[0]!;
    const time = times[0]!;
    const zone = zones[0]!;
    const before = text.slice(Math.max(0, date.index - 160), date.index);
    const dateToTime = text.slice(date.index + date[0].length, time.index);
    const timeToZone = text.slice(time.index + time[0].length, zone.index);
    const proposed = /(?:\b(?:to|on|for)|\b(?:new\s+)?(?:date|start|time)\s*:|إلى|الى|ليصبح|بتاريخ|يوم|الموعد الجديد\s*:)\s*$/iu.test(before);
    const joined = /^(?:T|\s+(?:(?:at|time\s*:|(?:في )?الساعة)\s*)?)$/iu.test(dateToTime) && /^\s+(?:\(?|(?:(?:timezone\s*:)|بتوقيت)\s*)$/iu.test(timeToZone);
    if (proposed && joined && date.index < time.index && time.index < zone.index) newStart = startInstant(date[0], time[0], zone[0]);
  }
  if (dates.length > 1 || times.length > 1 || zones.length > 1) problems.push('multiple_dates_times_or_timezones');
  if (hasSchedule && !newStart) problems.push('explicit_new_date_time_timezone_required');
  if (zones.length && !hasSchedule) problems.push('timezone_without_date_time');
  const newLocation = !historical && !room.invalid && room.values.length === 1 ? room.values[0]! : null;
  if (!newStart && !newLocation) problems.push('no_explicit_new_values');

  if (event) {
    const updated = instant(event.updated_at);
    const starts = instant(event.starts_at);
    if (updated === null || starts === null || received < updated || received > starts) problems.push('stale_event_or_message');
    if (newStart && instant(newStart)! <= received) problems.push('new_date_not_after_message');
    const sameStart = !newStart || instant(newStart) === starts;
    if (sameStart && (!newLocation || newLocation === event.location)) problems.push('no_change');
  }

  // Room-only changes can be explicitly reviewed, but never claim automatic eligibility.
  const actionable = problems.length === 0;
  const unambiguous = actionable && newStart !== null && direct && authenticated && trusted;
  const reason = problems.length ? `Needs manual review: ${problems.join(', ')}.` : newStart ?
    'Explicit exam change for one course and pending exam; SQL must verify consent and the snapshot.' :
    'Room-only change: review required; no explicit new date/time/timezone.';
  return {
    message_id: message.id, sender: validSender ? sender : '',
    subject: message.subject.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 300),
    excerpt: message.text.slice(0, MAX_TEXT).replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 500),
    received_at: message.received_at, source_url: safeSource(message.source_url),
    event_id: event?.id ?? null, course_code: course?.code ?? null,
    snapshot: event ? snapshot(event) : null, new_start: newStart, new_location: newLocation,
    reason, actionable, unambiguous, direct_message: direct,
    explicit_timezone: newStart !== null, authenticated_sender: authenticated,
  };
}
