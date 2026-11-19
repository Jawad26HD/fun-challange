import React, { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { AcademicEvent } from '../types';
import { useApp } from '../state/AppProvider';
import { sortEvents } from '../lib/planner';
import { Action, Badge, Card, Chips, Empty, Field, Row, Txt, useDesign } from '../components/ui';
import { EventRow } from '../components/EventRow';
import { ListChecksIcon, PlusIcon } from '../components/icons';

export function Planner({ initialFilter = 'all', onEvent, onAdd }: { initialFilter?: string; onEvent: (event: AcademicEvent) => void; onAdd: () => void }) {
  const { data } = useApp();
  const { c, t } = useDesign();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState(initialFilter);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => sortEvents(data.events.filter(event => (filter === 'all' || event.kind === filter) && (status === 'all' || event.status === status) && `${event.title} ${event.title_ar} ${data.courses.find(course => course.id === event.course_id)?.code || ''}`.toLowerCase().includes(search.toLowerCase()))), [data.events, data.courses, filter, status, search]);
  const overdue = filtered.filter(event => event.status === 'pending' && new Date(event.starts_at) < new Date());
  const rest = filtered.filter(event => !overdue.includes(event));
  return <View style={{ gap: 24 }}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><View style={{ flex: 1, minWidth: 190 }}><Txt size={32} weight="bold" accessibilityRole="header">{t('planner')}</Txt><Txt color={c.muted} style={{ marginTop: 6 }}>{t('earliestFirst')}</Txt></View><Action label={t('newEvent')} icon={<PlusIcon size={17} color={c.onAccent} />} onPress={onAdd} /></Row>
    <Field label={t('search')} value={search} onChangeText={setSearch} placeholder={t('titlePlaceholder')} />
    <Chips value={filter} onChange={setFilter} options={[{ value: 'all', label: t('all') }, { value: 'assignment', label: t('assignments') }, { value: 'exam', label: t('exams') }, { value: 'quiz', label: t('quizzes') }, { value: 'personal', label: t('personal') }]} />
    <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Chips value={status} onChange={setStatus} options={[{ value: 'pending', label: t('pending') }, { value: 'completed', label: t('completed') }, { value: 'all', label: t('all') }]} /><Badge label={`${filtered.length} ${t('details').toLowerCase()}`} /></Row>
    {!filtered.length ? <Card><Empty icon={<ListChecksIcon size={30} weight="light" color={c.accent} />} title={search ? t('noResults') : t('noEvents')} body={search ? t('clearSearch') : t('noEventsBody')} action={<Action label={t('newEvent')} onPress={onAdd} />} /></Card> : <>
      {overdue.length ? <View style={{ gap: 12 }}><Row><Txt size={16} weight="medium" color={c.warning}>{t('overdue')}</Txt><Badge label={String(overdue.length)} tone="warning" /></Row><Card style={{ paddingVertical: 1, paddingHorizontal: width < 600 ? 12 : 22 }}>{overdue.map((event, index) => <EventRow key={event.id} event={event} onPress={() => onEvent(event)} last={index === overdue.length - 1} />)}</Card></View> : null}
      {rest.length ? <View style={{ gap: 12 }}><Txt size={16} weight="medium">{status === 'completed' ? t('completed') : t('upcoming')}</Txt><Card style={{ paddingVertical: 1, paddingHorizontal: width < 600 ? 12 : 22 }}>{rest.map((event, index) => <EventRow key={event.id} event={event} onPress={() => onEvent(event)} last={index === rest.length - 1} />)}</Card></View> : null}
    </>}
  </View>;
}
