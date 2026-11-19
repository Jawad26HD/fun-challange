import { Platform } from 'react-native';
import type { PlannerData } from '../types';
import { getNextLecture, upcomingEvents } from './planner';
import { translate } from './i18n';

export async function enableDeviceReminders() {
  if (Platform.OS === 'web') return false;
  const notifications = await import('expo-notifications');
  if (Platform.OS === 'android') await notifications.setNotificationChannelAsync('academic-reminders', { name: 'Academic reminders', importance: notifications.AndroidImportance.HIGH });
  const result = await notifications.requestPermissionsAsync();
  return result.granted;
}
export async function scheduleReminders(data: PlannerData) {
  if (Platform.OS === 'web') return;
  const notifications = await import('expo-notifications');
  if (!(await notifications.getPermissionsAsync()).granted) return;
  const existing = await notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existing.filter(item => item.identifier.startsWith('studenthub-')).map(item => notifications.cancelScheduledNotificationAsync(item.identifier)));
  const language = data.settings.language;
  const offset = data.settings.reminder_minutes * 60000;
  const now = new Date();
  const items = upcomingEvents(data.events, now).filter(event => data.settings.alert_types[event.kind]).map(event => ({ id: event.id, title: translate(language, event.kind), body: language === 'ar' && event.title_ar ? event.title_ar : event.title, at: new Date(new Date(event.starts_at).getTime() - offset), eventId: event.id }));
  if (data.settings.alert_types.lecture) {
    for (const course of data.courses) {
      const lecture = getNextLecture([course], now, data.settings.timezone);
      if (lecture) items.push({ id: `lecture-${course.id}`, title: translate(language, 'nextLecture'), body: `${language === 'ar' && course.title_ar ? course.title_ar : course.title} / ${course.room}`, at: new Date(new Date(lecture.starts_at).getTime() - offset), eventId: '' });
    }
  }
  const upcoming = items.filter(item => item.at > now).sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 50);
  await Promise.all(upcoming.map(item => notifications.scheduleNotificationAsync({ identifier: `studenthub-${item.id}`, content: { title: item.title, body: item.body, data: { eventId: item.eventId }, sound: true }, trigger: { type: notifications.SchedulableTriggerInputTypes.DATE, date: item.at, channelId: 'academic-reminders' } })));
}
export async function clearDeviceReminders() {
  if (Platform.OS === 'web') return;
  const notifications = await import('expo-notifications');
  const existing = await notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existing.filter(item => item.identifier.startsWith('studenthub-')).map(item => notifications.cancelScheduledNotificationAsync(item.identifier)));
}
