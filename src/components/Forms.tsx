import React, { useState } from 'react';
import { View } from 'react-native';
import type { AcademicEvent, Course, EventKind, StudyCourse } from '../types';
import { useApp, newId } from '../state/AppProvider';
import { localDateInput, localTimeInput, toEventISO, validateEvent } from '../lib/planner';
import { weekdays } from '../lib/i18n';
import { Action, Chips, Field, Notice, Row, Sheet, Txt, useDesign } from './ui';

export function EventForm({ event, courseId, onClose }: { event?: AcademicEvent; courseId?: string; onClose: () => void }) {
  const { data, saveEvent } = useApp();
  const { c, lang, t } = useDesign();
  const [title, setTitle] = useState(event ? (lang === 'ar' && event.title_ar ? event.title_ar : event.title) : '');
  const [kind, setKind] = useState<EventKind>(event?.kind || 'assignment');
  const [course, setCourse] = useState(event?.course_id || courseId || 'none');
  const [date, setDate] = useState(localDateInput(event?.starts_at || new Date().toISOString(), data.settings.timezone));
  const [time, setTime] = useState(event ? localTimeInput(event.starts_at, data.settings.timezone) : '17:00');
  const [location, setLocation] = useState(event?.location || '');
  const [notes, setNotes] = useState(event?.notes || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    if (!title.trim()) { setError(t('required')); return; }
    let starts_at: string;
    try { starts_at = toEventISO(date.trim(), time.trim(), data.settings.timezone); } catch { setError(t('invalidDate')); return; }
    const next: AcademicEvent = { id: event?.id || newId(), title: lang === 'ar' && event ? event.title : title.trim(), title_ar: lang === 'ar' ? title.trim() : event?.title_ar || '', kind, course_id: course === 'none' ? null : course, starts_at, location: location.trim(), notes: notes.trim(), status: event?.status || 'pending', source: event?.source || 'manual', created_at: event?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    const validation = validateEvent(next, data.courses);
    if (validation) { setError(validation); return; }
    setBusy(true);
    try { await saveEvent(next); onClose(); } catch (err) { setError(err instanceof Error ? err.message : t('savingFailed')); } finally { setBusy(false); }
  };
  return <Sheet title={event ? t('edit') : t('newEvent')} visible onClose={() => { if (!busy) onClose(); }}>
    <Field label={t('title')} value={title} onChangeText={setTitle} placeholder={t('titlePlaceholder')} maxLength={160} autoFocus />
    <View style={{ gap: 8 }}><Txt size={12} weight="medium">{t('eventType')}</Txt><Chips value={kind} onChange={setKind} options={(['assignment', 'exam', 'quiz', 'personal'] as const).map(value => ({ value, label: t(value) }))} /></View>
    <View style={{ gap: 8 }}><Txt size={12} weight="medium">{t('course')}</Txt><Chips value={course} onChange={setCourse} options={[{ value: 'none', label: t('noCourse') }, ...data.courses.map(item => ({ value: item.id, label: item.code }))]} /></View>
    <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1 }}><Field label={t('date')} hint={t('dateHelp')} value={date} onChangeText={setDate} maxLength={10} autoCapitalize="none" style={{ writingDirection: 'ltr', textAlign: 'left' }} /></View><View style={{ flex: 1 }}><Field label={t('time')} hint={t('timeHelp')} value={time} onChangeText={setTime} maxLength={5} style={{ writingDirection: 'ltr', textAlign: 'left' }} /></View></Row>
    <Txt size={12} color={c.muted}>{t('timezone')}: {data.settings.timezone}</Txt>
    <Field label={`${t('location')} (${t('optional')})`} value={location} onChangeText={setLocation} placeholder={t('locationPlaceholder')} maxLength={200} />
    <Field label={`${t('notes')} (${t('optional')})`} value={notes} onChangeText={setNotes} placeholder={t('notesPlaceholder')} multiline maxLength={2000} />
    {error ? <Notice text={error} danger /> : null}
    <Action label={busy ? t('saving') : t('save')} busy={busy} onPress={() => void submit()} />
  </Sheet>;
}

export function CourseForm({ course, onClose }: { course?: Course; onClose: () => void }) {
  const { data, saveCourse } = useApp();
  const { c, lang, t } = useDesign();
  const [code, setCode] = useState(course?.code || '');
  const [name, setName] = useState(course?.title || '');
  const [arabicName, setArabicName] = useState(course?.title_ar || '');
  const [instructor, setInstructor] = useState(course?.instructor || '');
  const [email, setEmail] = useState(course?.instructor_email || '');
  const [room, setRoom] = useState(course?.room || '');
  const [credits, setCredits] = useState(String(course?.credits || 3));
  const [days, setDays] = useState(course?.meeting_days || [0, 2, 4]);
  const [start, setStart] = useState(course?.start_time || '09:00');
  const [end, setEnd] = useState(course?.end_time || '10:00');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    const timeValid = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!code.trim() || !name.trim() || !Number.isInteger(Number(credits)) || Number(credits) < 1 || Number(credits) > 12 || !timeValid(start) || !timeValid(end) || end <= start || days.length === 0 || data.courses.some(item => item.id !== course?.id && item.code.toLowerCase() === code.trim().toLowerCase())) { setError(t('courseValidation')); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('approvedSendersError')); return; }
    setBusy(true);
    try { await saveCourse({ id: course?.id || newId(), code: code.trim().toUpperCase(), title: name.trim(), title_ar: arabicName.trim(), instructor: instructor.trim(), instructor_email: email.trim().toLowerCase(), room: room.trim(), credits: Number(credits), meeting_days: [...days].sort(), start_time: start, end_time: end }); onClose(); } catch (err) { setError(err instanceof Error ? err.message : t('savingFailed')); } finally { setBusy(false); }
  };
  return <Sheet title={course ? t('edit') : t('newCourse')} visible onClose={() => { if (!busy) onClose(); }}>
    <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 2 }}><Field label={t('courseCode')} value={code} onChangeText={setCode} placeholder="CS201" maxLength={20} /></View><View style={{ flex: 1 }}><Field label={t('creditsLabel')} value={credits} onChangeText={setCredits} keyboardType="number-pad" maxLength={2} /></View></Row>
    <Field label={t('courseName')} value={name} onChangeText={setName} maxLength={120} />
    <Field label={`${t('arabicName')} (${t('optional')})`} value={arabicName} onChangeText={setArabicName} maxLength={120} />
    <Field label={t('instructor')} value={instructor} onChangeText={setInstructor} maxLength={120} />
    <Field label={`${t('instructorEmail')} (${t('optional')})`} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
    <Field label={t('room')} value={room} onChangeText={setRoom} maxLength={120} />
    <View style={{ gap: 8 }}><Txt size={12} weight="medium">{t('lectureDays')}</Txt><Row style={{ flexWrap: 'wrap' }} gap={6}>{weekdays(lang).map((label, day) => <Action key={day} compact label={label} variant={days.includes(day) ? 'primary' : 'secondary'} onPress={() => setDays(previous => previous.includes(day) ? previous.filter(value => value !== day) : [...previous, day])} />)}</Row></View>
    <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1 }}><Field label={t('startTime')} value={start} onChangeText={setStart} hint={t('timeHelp')} maxLength={5} /></View><View style={{ flex: 1 }}><Field label={t('endTime')} value={end} onChangeText={setEnd} hint={t('timeHelp')} maxLength={5} /></View></Row>
    <Txt color={c.muted} size={12}>{t('timezone')}: {data.settings.timezone}</Txt>
    {error ? <Notice text={error} danger /> : null}<Action label={busy ? t('saving') : t('save')} busy={busy} onPress={() => void submit()} />
  </Sheet>;
}

export function StudyCourseForm({ course, onClose }: { course?: StudyCourse; onClose: () => void }) {
  const { saveStudyCourse, data } = useApp();
  const { lang, t } = useDesign();
  const [code, setCode] = useState(course?.code || '');
  const [title, setTitle] = useState(course?.title || '');
  const [credits, setCredits] = useState(String(course?.credits ?? 3));
  const [status, setStatus] = useState<StudyCourse['status']>(course?.status || 'remaining');
  const [category, setCategory] = useState<StudyCourse['category']>(course?.category || 'major');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim() || !code.trim() || !/^\d{1,2}$/.test(credits) || Number(credits) > 12 || data.study_courses.some(item => item.id !== course?.id && item.code.toLowerCase() === code.trim().toLowerCase())) { setError(t('studyValidation')); return; }
    setBusy(true);
    try { await saveStudyCourse({ id: course?.id || newId(), code: code.trim().toUpperCase(), title: title.trim(), title_ar: lang === 'ar' ? title.trim() : course?.title_ar || '', credits: Number(credits), status, category }); onClose(); } catch (err) { setError(err instanceof Error ? err.message : t('savingFailed')); } finally { setBusy(false); }
  };
  return <Sheet title={course ? t('edit') : t('addStudyCourse')} visible onClose={() => { if (!busy) onClose(); }}><Field label={t('courseCode')} value={code} onChangeText={setCode} maxLength={20} /><Field label={t('courseName')} value={title} onChangeText={setTitle} maxLength={120} /><Field label={t('creditsLabel')} value={credits} onChangeText={setCredits} keyboardType="number-pad" maxLength={2} /><View style={{ gap: 8 }}><Txt size={12}>{t('status')}</Txt><Chips value={status} onChange={setStatus} options={[{ value: 'completed', label: t('completed') }, { value: 'current', label: t('inProgress') }, { value: 'remaining', label: t('remaining') }]} /></View><View style={{ gap: 8 }}><Txt size={12}>{t('category')}</Txt><Chips value={category} onChange={setCategory} options={[{ value: 'university', label: t('universityCourses') }, { value: 'faculty', label: t('facultyCourses') }, { value: 'major', label: t('majorCourses') }]} /></View>{error ? <Notice text={error} danger /> : null}<Action label={busy ? t('saving') : t('save')} busy={busy} onPress={() => void submit()} /></Sheet>;
}

export function Confirm({ title, body, label, onConfirm, onClose, danger = false }: { title: string; body: string; label: string; onConfirm: () => Promise<void>; onClose: () => void; danger?: boolean }) {
  const { c, t } = useDesign();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Sheet visible title={title} onClose={() => { if (!busy) onClose(); }}><Txt color={c.muted}>{body}</Txt>{error ? <Notice text={error} danger /> : null}<Row style={{ justifyContent: 'flex-end' }}><Action label={t('cancel')} variant="secondary" onPress={onClose} disabled={busy} /><Action label={label} busy={busy} variant={danger ? 'danger' : 'primary'} onPress={() => { setBusy(true); void onConfirm().then(onClose).catch(err => setError(err instanceof Error ? err.message : t('savingFailed'))).finally(() => setBusy(false)); }} /></Row></Sheet>;
}
