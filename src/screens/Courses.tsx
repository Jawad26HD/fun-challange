import React, { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import type { AcademicEvent, Course } from '../types';
import { useApp } from '../state/AppProvider';
import { sortEvents } from '../lib/planner';
import { weekdays } from '../lib/i18n';
import { Action, Badge, Card, Chips, Empty, Field, Row, SectionTitle, Sheet, Txt, useDesign } from '../components/ui';
import { BookOpenIcon, FileTextIcon, MapPinIcon, PlusIcon } from '../components/icons';
import { courseName, EventRow } from '../components/EventRow';

export function Courses({ onCourse, onAdd }: { onCourse: (course: Course) => void; onAdd: () => void }) {
  const { data } = useApp();
  const { c, lang, t } = useDesign();
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState('');
  const courses = data.courses.filter(course => `${course.title} ${course.title_ar} ${course.code}`.toLowerCase().includes(search.toLowerCase()));
  const columns = width >= 1100 ? 2 : 1;
  return <View style={{ gap: 24 }}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><View style={{ flex: 1, minWidth: 190 }}><Txt size={32} weight="bold" accessibilityRole="header">{t('courses')}</Txt><Txt color={c.muted} style={{ marginTop: 6 }}>{data.settings.semester}</Txt></View><Action label={t('newCourse')} icon={<PlusIcon size={17} color={c.onAccent} />} onPress={onAdd} /></Row><Field label={t('searchCourses')} value={search} onChangeText={setSearch} />
    {!courses.length ? <Card><Empty icon={<BookOpenIcon size={30} weight="light" color={c.accent} />} title={search ? t('noResults') : t('noCourses')} body={search ? t('clearSearch') : t('noCoursesBody')} action={<Action label={t('newCourse')} onPress={onAdd} />} /></Card> : <View style={{ gap: 16 }}>{Array.from({ length: Math.ceil(courses.length / columns) }, (_, index) => <Row key={index} style={{ alignItems: 'stretch' }} gap={16}>{courses.slice(index * columns, index * columns + columns).map(course => { const work = data.events.filter(event => event.course_id === course.id && event.status === 'pending'); return <Pressable key={course.id} accessibilityRole="button" accessibilityLabel={courseName(course, lang)} onPress={() => onCourse(course)} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1 })}><Card style={{ flex: 1, padding: 24 }}><Row style={{ justifyContent: 'space-between', marginBottom: 24 }}><Badge label={course.code} tone="accent" /><Txt size={12} color={c.muted}>{course.credits} {t('credits')}</Txt></Row><Txt size={24} weight="bold">{courseName(course, lang)}</Txt><Txt size={13} color={c.muted} style={{ marginTop: 7, marginBottom: 24 }}>{course.instructor}</Txt><Row gap={7}><MapPinIcon size={16} weight="light" color={c.muted} /><Txt size={12} color={c.muted}>{course.room}</Txt></Row><View style={{ marginTop: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.line }}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt size={12} color={c.muted}>{course.meeting_days.map(day => weekdays(lang)[day]).join(' / ')}</Txt><Txt size={12} weight="medium" color={c.accent}>{work.length} {t('pending').toLowerCase()}</Txt></Row></View></Card></Pressable>; })}{courses.slice(index * columns, index * columns + columns).length === 1 && columns === 2 ? <View style={{ flex: 1 }} /> : null}</Row>)}</View>}
  </View>;
}

export function CourseDetails({ course, onClose, onEvent, onAddEvent, onEdit }: { course: Course; onClose: () => void; onEvent: (event: AcademicEvent) => void; onAddEvent: () => void; onEdit: () => void }) {
  const { data, mode } = useApp();
  const { c, lang, t } = useDesign();
  const [tab, setTab] = useState('overview');
  const [preview, setPreview] = useState<string | null>(null);
  const events = sortEvents(data.events.filter(event => event.course_id === course.id));
  return <><Sheet visible wide title={courseName(course, lang)} onClose={onClose}><Row style={{ justifyContent: 'space-between' }}><Badge label={course.code} tone="accent" /><Action label={t('edit')} variant="ghost" compact onPress={onEdit} /></Row><Chips value={tab} onChange={setTab} options={[{ value: 'overview', label: t('overview') }, { value: 'work', label: t('courseWork') }, { value: 'materials', label: t('materials') }]} />
    {tab === 'overview' ? <><Card style={{ backgroundColor: c.tint, borderColor: c.tint }}><Txt size={12} color={c.muted}>{t('instructor')}</Txt><Txt size={18} weight="medium" style={{ marginTop: 4 }}>{course.instructor}</Txt>{course.instructor_email ? <Txt size={12} color={c.muted} style={{ marginTop: 5 }}>{course.instructor_email}</Txt> : null}<Row style={{ marginTop: 20, justifyContent: 'space-between' }}><View><Txt size={11} color={c.muted}>{t('room')}</Txt><Txt weight="medium">{course.room}</Txt></View><View><Txt size={11} color={c.muted}>{t('creditsLabel')}</Txt><Txt weight="medium">{course.credits}</Txt></View></Row></Card><SectionTitle title={t('schedule')} /><Txt>{course.meeting_days.map(day => weekdays(lang)[day]).join(' / ')}</Txt><Txt color={c.muted}>{course.start_time} - {course.end_time} ({data.settings.timezone})</Txt><SectionTitle title={t('dueNext')} /><View>{events.filter(event => event.status === 'pending').slice(0, 3).map((event, i, array) => <EventRow key={event.id} event={event} onPress={() => onEvent(event)} last={i === array.length - 1} />)}</View></> : null}
    {tab === 'work' ? <><Action label={t('newEvent')} onPress={onAddEvent} /><Txt size={12} color={c.muted}>{t('submissionsBody')}</Txt>{events.length ? events.map((event, i) => <EventRow key={event.id} event={event} onPress={() => onEvent(event)} last={i === events.length - 1} />) : <Empty title={t('noEvents')} body={t('noEventsBody')} />}</> : null}
    {tab === 'materials' ? mode === 'demo' ? <><Badge label={t('sampleMaterial')} tone="warning" /><Txt size={12} color={c.muted}>{t('sampleMaterialBody')}</Txt>{[t('material1'), t('material2')].map(title => <Card key={title}><Row><FileTextIcon size={26} weight="light" color={c.accent} /><View style={{ flex: 1 }}><Txt weight="medium">{title}</Txt><Txt size={11} color={c.muted}>{course.code} / {t('sampleConnection')}</Txt></View><Action label={t('preview')} variant="ghost" compact onPress={() => setPreview(title)} /></Row></Card>)}</> : <Empty title={t('noMaterials')} body={t('materialsBody')} /> : null}
    </Sheet>{preview ? <Sheet visible title={preview} onClose={() => setPreview(null)}><Badge label={t('sampleMaterial')} tone="warning" /><Txt size={20} weight="medium">{courseName(course, lang)}</Txt><Txt color={c.muted}>{t('materialContent')}</Txt><Txt size={12} color={c.muted}>{t('sampleMaterialBody')}</Txt></Sheet> : null}</>;
}
