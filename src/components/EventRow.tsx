import React from 'react';
import { Pressable, View } from 'react-native';
import type { AcademicEvent, Course } from '../types';
import { formatDate, formatTime } from '../lib/planner';
import { useApp } from '../state/AppProvider';
import { Badge, Row, Txt, useDesign } from './ui';
import { CheckIcon, ExamIcon, FileTextIcon, CalendarBlankIcon, MapPinIcon } from './icons';

export const eventName = (event: AcademicEvent, lang: string) => lang === 'ar' && event.title_ar ? event.title_ar : event.title;
export const courseName = (course: Course, lang: string) => lang === 'ar' && course.title_ar ? course.title_ar : course.title;
export function EventRow({ event, onPress, last = false, showDate = true }: { event: AcademicEvent; onPress: () => void; last?: boolean; showDate?: boolean }) {
  const { data, toggleEvent, report } = useApp();
  const { c, lang, t } = useDesign();
  const course = data.courses.find(item => item.id === event.course_id);
  const past = event.status !== 'completed' && new Date(event.starts_at) < new Date();
  const Icon = event.kind === 'assignment' ? FileTextIcon : event.kind === 'exam' || event.kind === 'quiz' ? ExamIcon : CalendarBlankIcon;
  return <Row gap={12} style={{ paddingVertical: 17, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
    {event.kind === 'assignment' ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`${event.status === 'completed' ? t('reopen') : t('complete')}: ${eventName(event, lang)}`} accessibilityState={{ checked: event.status === 'completed' }} onPress={() => void toggleEvent(event).catch(report)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: event.status === 'completed' ? 0 : 1.5, borderColor: c.faint, backgroundColor: event.status === 'completed' ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{event.status === 'completed' ? <CheckIcon size={15} color={c.onAccent} /> : null}</View></Pressable> : <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.tint, justifyContent: 'center', alignItems: 'center' }}><Icon size={23} weight="light" color={c.accent} /></View>}
    <Pressable accessibilityRole="button" accessibilityLabel={`${eventName(event, lang)}, ${formatDate(event.starts_at, lang, data.settings.timezone)}`} onPress={onPress} style={({ pressed }) => ({ flex: 1, minHeight: 44, opacity: pressed ? 0.65 : 1 })}><Txt size={15} weight="medium" style={event.status === 'completed' ? { textDecorationLine: 'line-through', color: c.muted } : undefined}>{eventName(event, lang)}</Txt><Row style={{ flexWrap: 'wrap', marginTop: 4 }} gap={6}><Txt size={11} color={c.muted}>{course?.code || t('personal')}</Txt><Txt size={11} color={c.muted}>/</Txt><Txt size={11} color={c.muted}>{t(event.kind)}</Txt>{event.location && event.kind !== 'assignment' ? <><MapPinIcon size={12} color={c.muted} /><Txt size={11} color={c.muted}>{event.location}</Txt></> : null}</Row></Pressable>
    {showDate ? <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 115 }}><Txt size={12} weight="medium" color={past ? c.warning : c.text}>{formatDate(event.starts_at, lang, data.settings.timezone)}</Txt><Txt size={11} color={c.muted}>{formatTime(event.starts_at, lang, data.settings.timezone)}</Txt>{past ? <Badge label={t('overdue')} tone="warning" /> : null}</View> : null}
  </Row>;
}
