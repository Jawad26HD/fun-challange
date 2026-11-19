import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useApp } from '../state/AppProvider';
import { creditSummary, formatDate, formatTime, getTodayLectures, overdueEvents, upcomingEvents } from '../lib/planner';
import type { AcademicEvent, Course } from '../types';
import { Action, Badge, Card, Empty, Row, SectionTitle, Txt, useDesign } from '../components/ui';
import { ArrowRightIcon, BellIcon, BookOpenIcon, CalendarBlankIcon, ClockIcon, ExamIcon, GraduationCapIcon, MapPinIcon, PlusIcon } from '../components/icons';
import { courseName, EventRow, eventName } from '../components/EventRow';

export function Home({ onEvent, onCourse, onAdd, navigate }: { onEvent: (event: AcademicEvent) => void; onCourse: (course: Course) => void; onAdd: () => void; navigate: (screen: string, filter?: string) => void }) {
  const { data, mode } = useApp();
  const { c, lang, rtl, t } = useDesign();
  const { width } = useWindowDimensions();
  const wide = width >= 1180;
  const now = new Date();
  const timezone = data.settings.timezone;
  const lectures = getTodayLectures(data.courses, now, timezone);
  const upcoming = upcomingEvents(data.events, now);
  const pastDue = overdueEvents(data.events, now);
  const exam = upcoming.find(event => event.kind === 'exam');
  const due = [...pastDue, ...upcoming.filter(event => event.kind === 'assignment' || event.kind === 'quiz')].slice(0, 5);
  const credits = creditSummary(data.study_courses, data.settings.required_credits);
  const unread = data.alerts.filter(alert => !alert.seen_at).length + data.updates.filter(update => update.status === 'pending').length;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const greeting = t(hour < 12 ? 'goodMorning' : hour < 18 ? 'goodAfternoon' : 'goodEvening');
  return <View style={{ gap: 28 }}>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 210 }}><Txt size={13} color={c.muted} style={{ marginBottom: 6 }}>{greeting}{data.settings.display_name ? `, ${data.settings.display_name.split(' ')[0]}` : ''}</Txt><Txt size={width < 600 ? 29 : 36} weight="bold" accessibilityRole="header" style={{ letterSpacing: rtl ? 0 : -0.8 }}>{t('todayHeading')}</Txt><Txt size={14} color={c.muted} style={{ marginTop: 7 }}>{t('todayBody')}</Txt></View>
      <Action label={t('newEvent')} onPress={onAdd} icon={<PlusIcon size={17} color={c.onAccent} />} />
    </Row>
    <View style={{ backgroundColor: c.tint, borderRadius: 22, padding: width < 600 ? 20 : 25 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} gap={18}>
        <Row gap={16}><View style={{ width: 53, height: 60, borderRadius: 13, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Txt size={10} color={c.accent} weight="medium">{formatDate(now.toISOString(), lang, timezone, { month: 'short' })}</Txt><Txt size={25} weight="bold" color={c.accent}>{formatDate(now.toISOString(), lang, timezone, { day: 'numeric' })}</Txt></View><View><Txt size={17} weight="medium">{formatDate(now.toISOString(), lang, timezone, { weekday: 'long' })}</Txt><Txt size={12} color={c.muted}>{data.settings.semester}</Txt></View></Row>
        <Row gap={width < 600 ? 22 : 35} style={{ flexWrap: 'wrap' }}>{[{ n: lectures.length, label: t('todayClasses') }, { n: upcoming.filter(item => item.kind === 'assignment').length, label: t('assignments') }, { n: upcoming.filter(item => item.kind === 'exam').length, label: t('exams') }].map(item => <View key={item.label}><Txt size={25} weight="bold" color={c.accent}>{String(item.n).padStart(2, '0')}</Txt><Txt size={11} color={c.muted}>{item.label}</Txt></View>)}</Row>
      </Row>
    </View>
    <View style={{ flexDirection: wide ? (rtl ? 'row-reverse' : 'row') : 'column', gap: 24, alignItems: 'flex-start' }}>
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', minWidth: 0, gap: 26 }}>
        <View><SectionTitle title={t('todayClasses')} action={<Action label={t('courses')} variant="ghost" compact onPress={() => navigate('courses')} />} />
          {lectures.length ? <View style={{ gap: 10 }}>{lectures.map((lecture, index) => <Pressable key={lecture.course.id} accessibilityRole="button" accessibilityLabel={courseName(lecture.course, lang)} onPress={() => onCourse(lecture.course)} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}><Card style={{ padding: 17, backgroundColor: index === 0 ? c.surface : 'transparent' }}><Row gap={17}><View style={{ width: 59 }}><Txt size={14} weight="medium">{formatTime(lecture.starts_at, lang, timezone)}</Txt><Txt size={10} color={c.muted}>{formatTime(lecture.ends_at, lang, timezone)}</Txt></View><View style={{ width: 3, height: 44, backgroundColor: index === 0 ? c.accent : c.softAccent, borderRadius: 3 }} /><View style={{ flex: 1 }}><Txt size={15} weight="medium">{courseName(lecture.course, lang)}</Txt><Row style={{ marginTop: 6, flexWrap: 'wrap' }} gap={6}><Txt size={11} color={c.muted}>{lecture.course.code}</Txt><MapPinIcon size={12} color={c.muted} /><Txt size={11} color={c.muted}>{lecture.course.room}</Txt></Row></View></Row></Card></Pressable>)}</View> : <Card><Empty icon={<CalendarBlankIcon size={28} weight="light" color={c.accent} />} title={t('noClasses')} body={t('noClassesBody')} /></Card>}
        </View>
        <View><SectionTitle title={t('dueNext')} subtitle={t('earliestFirst')} action={<Action label={t('seeAll')} variant="ghost" compact onPress={() => navigate('planner')} />} /><Card style={{ paddingVertical: 2, paddingHorizontal: width < 600 ? 12 : 20 }}>{due.length ? due.map((event, index) => <EventRow key={event.id} event={event} onPress={() => onEvent(event)} last={index === due.length - 1} />) : <Empty icon={<BookOpenIcon size={28} weight="light" color={c.accent} />} title={t('noEvents')} body={t('noEventsBody')} action={<Action label={t('newEvent')} onPress={onAdd} />} />}</Card></View>
      </View>
      <View style={{ width: wide ? 285 : '100%', gap: 20 }}>
        <Card style={{ backgroundColor: c.tint, borderColor: c.tint, padding: 24 }}><Row style={{ justifyContent: 'space-between', marginBottom: 22 }}><Txt size={12} weight="medium" color={c.accent}>{t('nextExam')}</Txt><ExamIcon size={23} color={c.accent} weight="light" /></Row>{exam ? <><Badge label={data.courses.find(course => course.id === exam.course_id)?.code || t('exam')} tone="accent" /><Txt size={23} weight="bold" style={{ marginTop: 12, marginBottom: 16 }}>{eventName(exam, lang)}</Txt><Row gap={8}><CalendarBlankIcon size={17} weight="light" color={c.accent} /><Txt size={13}>{formatDate(exam.starts_at, lang, timezone, { weekday: 'short', day: 'numeric', month: 'short' })}</Txt></Row><Row gap={8} style={{ marginTop: 8 }}><ClockIcon size={17} weight="light" color={c.accent} /><Txt size={13}>{formatTime(exam.starts_at, lang, timezone)}</Txt></Row><Row gap={8} style={{ marginTop: 8, marginBottom: 20 }}><MapPinIcon size={17} weight="light" color={c.accent} /><Txt size={13} style={{ flex: 1 }}>{exam.location || t('noneScheduled')}</Txt></Row><Action label={t('details')} variant="secondary" onPress={() => onEvent(exam)} /></> : <Txt color={c.muted}>{t('noExams')}</Txt>}</Card>
        <Card><Row style={{ justifyContent: 'space-between', marginBottom: 20 }}><Txt size={15} weight="medium">{t('degree')}</Txt><GraduationCapIcon size={24} color={c.accent} weight="light" /></Row><Row style={{ alignItems: 'baseline' }} gap={5}><Txt size={36} weight="bold">{credits.completed}</Txt><Txt size={13} color={c.muted}>/ {data.settings.required_credits} {t('credits')}</Txt></Row><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: data.settings.required_credits, now: credits.completed }} style={{ height: 7, backgroundColor: c.subtle, borderRadius: 5, marginVertical: 16, overflow: 'hidden' }}><View style={{ height: 7, width: `${credits.percent}%`, backgroundColor: c.accent, borderRadius: 5 }} /></View><Txt size={12} color={c.muted}>{credits.current} {t('credits')} {t('inProgress').toLowerCase()}</Txt><Action label={t('degree')} variant="ghost" compact onPress={() => navigate('degree')} style={{ alignSelf: rtl ? 'flex-end' : 'flex-start', marginTop: 12 }} /></Card>
        <Pressable accessibilityRole="button" accessibilityLabel={t('updates')} onPress={() => navigate('updates')}><Row style={{ paddingHorizontal: 7 }} gap={12}><BellIcon size={22} color={c.muted} weight="light" /><View style={{ flex: 1 }}><Txt size={13} weight="medium">{unread ? `${unread} ${t('unseen').toLowerCase()}` : t('noAlerts')}</Txt><Txt size={11} color={c.muted}>{t('updatesBody')}</Txt></View></Row></Pressable>
      </View>
    </View>
  </View>;
}
