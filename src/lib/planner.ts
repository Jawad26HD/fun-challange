import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type {
  AcademicEvent,
  Course,
  Language,
  PlannerData,
  Settings,
  StudyCourse,
} from '../types';

const CAMPUS_TIMEZONE = 'Asia/Amman';
const EVENT_KINDS = ['assignment', 'exam', 'quiz', 'personal'] as const;

export const defaultSettings: Settings = {
  display_name: '',
  language: 'en',
  theme: 'system',
  program: '',
  required_credits: 132,
  semester: '',
  timezone: CAMPUS_TIMEZONE,
  alert_types: {
    assignment: true,
    exam: true,
    quiz: true,
    personal: true,
    lecture: true,
    update: true,
  },
  reminder_minutes: 60,
  approved_senders: [],
  outlook_auto_apply: false,
};

export function emptyPlanner(): PlannerData {
  return {
    courses: [],
    events: [],
    study_courses: [],
    alerts: [],
    updates: [],
    settings: {
      ...defaultSettings,
      alert_types: { ...defaultSettings.alert_types },
      approved_senders: [...defaultSettings.approved_senders],
    },
  };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function isInstant(value: string): boolean {
  // Require an explicit offset: a device-local ISO string is not a stored instant.
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return Boolean(match && isCalendarDate(match[1]!) && Number.isFinite(Date.parse(value)));
}

function instant(value: string): Date {
  if (!isInstant(value)) throw new RangeError('Enter a valid date and time with a timezone.');
  return new Date(value);
}

function currentTime(now: Date): number {
  const value = now.getTime();
  if (!Number.isFinite(value)) throw new RangeError('Invalid current date.');
  return value;
}

export function sortEvents(events: readonly AcademicEvent[]): AcademicEvent[] {
  return [...events].sort(
    (a, b) => instant(a.starts_at).getTime() - instant(b.starts_at).getTime()
      || a.title.localeCompare(b.title, 'en'),
  );
}

export function upcomingEvents(
  events: readonly AcademicEvent[],
  now = new Date(),
  limit?: number,
): AcademicEvent[] {
  const timestamp = currentTime(now);
  // A deadline at this exact instant has not become overdue yet.
  const upcoming = sortEvents(events.filter(
    (event) => event.status === 'pending' && instant(event.starts_at).getTime() >= timestamp,
  ));
  if (limit === undefined || limit === Infinity) return upcoming;
  return upcoming.slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0);
}

export function overdueEvents(
  events: readonly AcademicEvent[],
  now = new Date(),
): AcademicEvent[] {
  const timestamp = currentTime(now);
  return sortEvents(events.filter(
    (event) => event.status === 'pending' && instant(event.starts_at).getTime() < timestamp,
  ));
}

export function formatDate(
  iso: string,
  language: Language,
  timezone = CAMPUS_TIMEZONE,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-JO' : 'en-GB', {
    ...(options ?? { day: 'numeric', month: 'short' }),
    timeZone: timezone,
  }).format(instant(iso));
}

export function formatTime(
  iso: string,
  language: Language,
  timezone = CAMPUS_TIMEZONE,
): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-JO' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(instant(iso));
}

function localWallTime(value: Date, timezone: string): string {
  const formatted = formatInTimeZone(value, timezone, "yyyy-MM-dd'T'HH:mm");
  // date-fns-tz internally builds a host-local Date. If the target wall time falls
  // inside the DEVICE's DST gap, that Date can normalize even when the campus
  // time is valid. Verify against Intl parts of the original instant, not that Date.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)!.value;
  const verified = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  return formatted === verified ? formatted : verified;
}

export function localDateInput(iso: string, timezone = CAMPUS_TIMEZONE): string {
  return localWallTime(instant(iso), timezone).slice(0, 10);
}

export function localTimeInput(iso: string, timezone = CAMPUS_TIMEZONE): string {
  return localWallTime(instant(iso), timezone).slice(11);
}

export function toEventISO(date: string, time: string, timezone = CAMPUS_TIMEZONE): string {
  if (!isCalendarDate(date)) throw new RangeError('Enter a valid calendar date (YYYY-MM-DD).');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError('Enter a valid time (HH:mm).');
  }
  const wallTime = `${date}T${time}`;
  const result = fromZonedTime(`${wallTime}:00`, timezone);
  if (!Number.isFinite(result.getTime())) throw new RangeError('Invalid date, time, or timezone.');
  // fromZonedTime can normalize spring-forward gaps; a round trip must retain the input.
  if (localWallTime(result, timezone) !== wallTime) {
    throw new RangeError('This local time does not exist in the selected timezone.');
  }
  return result.toISOString();
}

type Lecture = { course: Course; starts_at: string; ends_at: string };

function shiftCalendarDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function lecturesOnDate(courses: readonly Course[], date: string, timezone: string): Lecture[] {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return courses.filter((course) => course.meeting_days.includes(weekday)).map((course) => {
    const starts_at = toEventISO(date, course.start_time, timezone);
    // A timetable may contain an evening session that ends after midnight.
    const endDate = course.end_time < course.start_time ? shiftCalendarDate(date, 1) : date;
    const ends_at = toEventISO(endDate, course.end_time, timezone);
    if (Date.parse(ends_at) <= Date.parse(starts_at)) {
      throw new RangeError(`The lecture end time must follow its start time: ${course.code}.`);
    }
    return { course, starts_at, ends_at };
  }).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)
    || a.course.title.localeCompare(b.course.title, 'en'));
}

export function getTodayLectures(
  courses: readonly Course[],
  now = new Date(),
  timezone = CAMPUS_TIMEZONE,
): Lecture[] {
  currentTime(now);
  return lecturesOnDate(courses, localDateInput(now.toISOString(), timezone), timezone);
}

export function getNextLecture(
  courses: readonly Course[],
  now = new Date(),
  timezone = CAMPUS_TIMEZONE,
): Lecture | null {
  const timestamp = currentTime(now);
  const today = localDateInput(now.toISOString(), timezone);
  // Include next week's same weekday when all of today's lectures have passed.
  for (let offset = 0; offset <= 7; offset += 1) {
    const next = lecturesOnDate(courses, shiftCalendarDate(today, offset), timezone)
      .find((lecture) => Date.parse(lecture.starts_at) >= timestamp);
    if (next) return next;
  }
  return null;
}

export function creditSummary(studyCourses: readonly StudyCourse[], requiredCredits: number): {
  completed: number;
  current: number;
  remaining: number;
  percent: number;
} {
  const completed = studyCourses.reduce(
    (total, course) => total + (course.status === 'completed' ? course.credits : 0), 0,
  );
  const current = studyCourses.reduce(
    (total, course) => total + (course.status === 'current' ? course.credits : 0), 0,
  );
  return {
    completed,
    current,
    remaining: Math.max(0, requiredCredits - completed - current),
    percent: requiredCredits > 0 ? Math.min(100, Math.max(0, Math.round(completed / requiredCredits * 100))) : 0,
  };
}

export function applyDemoUpdate(
  data: PlannerData,
  updateId: string,
  action: 'apply' | 'dismiss' | 'revert',
): PlannerData {
  const update = data.updates.find((item) => item.id === updateId);
  if (!update) throw new Error('Schedule update not found.');
  if (action !== 'apply' && action !== 'dismiss' && action !== 'revert') {
    throw new Error('Unknown schedule update action.');
  }
  // Match the audit API's retry behavior without replaying an already resolved edit.
  if ((action === 'apply' && update.status === 'applied')
    || (action === 'dismiss' && update.status === 'dismissed')
    || (action === 'revert' && update.status === 'reverted')) return data;
  if (action === 'dismiss') {
    if (update.status !== 'pending') throw new Error('Only pending updates can be dismissed.');
    return {
      ...data,
      updates: data.updates.map((item) => item.id === updateId ? { ...item, status: 'dismissed' } : item),
    };
  }
  const reverting = action === 'revert';
  if (update.status !== (reverting ? 'applied' : 'pending')) {
    throw new Error(reverting ? 'Only applied updates can be reverted.' : 'Only pending updates can be applied.');
  }
  const event = data.events.find((item) => item.id === update.event_id);
  if (!event) throw new Error('This proposal has no matching event. Review it manually.');
  if (update.previous_start === null || update.previous_location === null
    || (update.new_start === null && update.new_location === null)
    || !isInstant(update.previous_start)
    || (update.new_start !== null && !isInstant(update.new_start))) {
    throw new Error('This proposal is incomplete or ambiguous. Review it manually.');
  }
  // A null proposed field means unchanged; the previous snapshot is still required
  // so an intervening manual edit to either field is never silently overwritten.
  const nextStart = update.new_start ?? update.previous_start;
  const nextLocation = update.new_location ?? update.previous_location;
  const expectedStart = reverting ? nextStart : update.previous_start;
  const expectedLocation = reverting ? nextLocation : update.previous_location;
  if (!isInstant(event.starts_at) || Date.parse(event.starts_at) !== Date.parse(expectedStart)
    || event.location !== expectedLocation) {
    throw new Error('The event has changed since this proposal. Refresh and review it before continuing.');
  }
  const starts_at = reverting ? update.previous_start : nextStart;
  const location = reverting ? update.previous_location : nextLocation;
  if (Date.parse(starts_at) === Date.parse(expectedStart) && location === expectedLocation) {
    throw new Error('This proposal contains no schedule change.');
  }
  // Demo transitions are deterministic; do not pretend to record a live server action time.
  const updated_at = new Date(Math.max(
    instant(event.updated_at).getTime(), instant(update.received_at).getTime(),
  )).toISOString();
  return {
    ...data,
    events: data.events.map((item) => item.id === event.id ? { ...item, starts_at, location, updated_at } : item),
    updates: data.updates.map((item) => item.id === updateId
      ? { ...item, status: reverting ? 'reverted' : 'applied' } : item),
  };
}

export function validateEvent(
  input: {
    title: string;
    kind: string;
    starts_at: string;
    course_id: string | null;
    location: string;
    notes: string;
  },
  courses: readonly Course[],
): string | null {
  if (typeof input.title !== 'string' || !input.title.trim()) return 'Enter an event title.';
  if (!EVENT_KINDS.some((kind) => kind === input.kind)) return 'Choose a valid event type.';
  if (!isInstant(input.starts_at)) return 'Enter a valid date and time with a timezone.';
  if (input.course_id !== null && !courses.some((course) => course.id === input.course_id)) {
    return 'Choose a course from your current courses, or leave it unassigned.';
  }
  if (typeof input.location !== 'string' || typeof input.notes !== 'string') {
    return 'Location and notes must be text.';
  }
  return null;
}
