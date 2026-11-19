export type Language = 'en' | 'ar';
export type EventKind = 'assignment' | 'exam' | 'quiz' | 'personal';
export type AlertKind = EventKind | 'lecture' | 'update';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Course {
  id: string;
  code: string;
  title: string;
  title_ar: string;
  instructor: string;
  instructor_email: string;
  room: string;
  credits: number;
  meeting_days: number[];
  start_time: string;
  end_time: string;
}

export interface AcademicEvent {
  id: string;
  course_id: string | null;
  title: string;
  title_ar: string;
  kind: EventKind;
  starts_at: string;
  location: string;
  notes: string;
  status: 'pending' | 'completed';
  source: 'manual' | 'outlook' | 'lms';
  created_at: string;
  updated_at: string;
}

export interface StudyCourse {
  id: string;
  code: string;
  title: string;
  title_ar: string;
  credits: number;
  status: 'completed' | 'current' | 'remaining';
  category: 'university' | 'faculty' | 'major';
}

export interface Alert {
  id: string;
  event_id: string | null;
  kind: AlertKind;
  title: string;
  body: string;
  created_at: string;
  seen_at: string | null;
}

export interface ScheduleUpdate {
  id: string;
  event_id: string | null;
  message_id: string;
  sender: string;
  subject: string;
  excerpt: string;
  received_at: string;
  previous_start: string | null;
  new_start: string | null;
  previous_location: string | null;
  new_location: string | null;
  status: 'applied' | 'pending' | 'dismissed' | 'reverted';
  reason: string;
  source_url: string | null;
  actionable?: boolean;
}

export interface Settings {
  display_name: string;
  language: Language;
  theme: ThemePreference;
  program: string;
  required_credits: number;
  semester: string;
  timezone: string;
  alert_types: Record<AlertKind, boolean>;
  reminder_minutes: number;
  approved_senders: string[];
  outlook_auto_apply: boolean;
}

export interface PlannerData {
  courses: Course[];
  events: AcademicEvent[];
  study_courses: StudyCourse[];
  alerts: Alert[];
  updates: ScheduleUpdate[];
  settings: Settings;
}

export interface OutlookConnection {
  connected: boolean;
  email?: string;
  last_synced_at?: string | null;
  error?: string | null;
}
