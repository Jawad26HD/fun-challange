import { Platform } from 'react-native';
import type { PlannerData } from '../types';
import type { NextUpProps } from '../widgets/types';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { formatDate, formatTime, getNextLecture, getTodayLectures, upcomingEvents } from './planner';
import { translate } from './i18n';

export async function publishWidgets(data: PlannerData, active: boolean, dark: boolean) {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
  const NextUp = (await import('../widgets/NextUp')).default;
  const { language, timezone } = data.settings;
  const snapshot = (date: Date): NextUpProps => {
    const lecture = active ? getNextLecture(data.courses, date, timezone) : null;
    const exam = active ? upcomingEvents(data.events, date).find(event => event.kind === 'exam') : null;
    const when = (iso: string) => `${formatDate(iso, language, timezone)} / ${formatTime(iso, language, timezone)}`;
    return { lectureLabel: translate(language, 'nextLecture'), lectureTitle: lecture?.course.code || translate(language, 'noneScheduled'), lectureWhen: lecture ? `${when(lecture.starts_at)} / ${lecture.course.room}` : '', examLabel: translate(language, 'nextExam'), examTitle: exam ? language === 'ar' && exam.title_ar ? exam.title_ar : exam.title : translate(language, 'noExams'), examWhen: exam ? when(exam.starts_at) : '', background: dark ? '#1B2720' : '#EDF2EC', foreground: dark ? '#EBF1E9' : '#202F29', muted: dark ? '#ADBDAF' : '#5E6E63', accent: dark ? '#91CFAB' : '#176B52', rtl: language === 'ar' };
  };
  const now = new Date();
  if (Platform.OS === 'ios' && active) {
    const transitions = new Set<number>([now.getTime()]);
    for (const event of upcomingEvents(data.events, now)) if (event.kind === 'exam') transitions.add(Date.parse(event.starts_at) + 1000);
    for (let day = 0; day < 7; day++) for (const lecture of getTodayLectures(data.courses, new Date(now.getTime() + day * 86400000), timezone)) if (Date.parse(lecture.starts_at) >= now.getTime()) transitions.add(Date.parse(lecture.starts_at) + 1000);
    NextUp.updateTimeline([...transitions].sort((a, b) => a - b).slice(0, 50).map(time => ({ date: new Date(time), props: snapshot(new Date(time)) })));
  } else NextUp.updateSnapshot(snapshot(now));
}
