import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { NotoSansArabic_400Regular } from '@expo-google-fonts/noto-sans-arabic/400Regular';
import { NotoSansArabic_600SemiBold } from '@expo-google-fonts/noto-sans-arabic/600SemiBold';
import { AppProvider, useApp } from './src/state/AppProvider';
import { Action, Badge, Card, DesignProvider, IconAction, Notice, Row, Sheet, Skeleton, Txt, useDesign } from './src/components/ui';
import { ArrowClockwiseIcon, BellIcon, BookOpenIcon, CalendarBlankIcon, GearSixIcon, GraduationCapIcon, HouseSimpleIcon, ListChecksIcon, MoonIcon, SignOutIcon, SunIcon, TranslateIcon } from './src/components/icons';
import { CourseForm, Confirm, EventForm, StudyCourseForm } from './src/components/Forms';
import { courseName, eventName } from './src/components/EventRow';
import { Home } from './src/screens/Home';
import { Planner } from './src/screens/Planner';
import { CourseDetails, Courses } from './src/screens/Courses';
import { Degree } from './src/screens/Degree';
import { Updates } from './src/screens/Updates';
import { SettingsScreen } from './src/screens/Settings';
import { Welcome } from './src/screens/Welcome';
import { formatDate, formatTime } from './src/lib/planner';
import { clearDeviceReminders, scheduleReminders } from './src/lib/reminders';
import { publishWidgets } from './src/lib/widgets';
import type { AcademicEvent, Course, StudyCourse } from './src/types';
import type { TranslationKey } from './src/lib/i18n';

const nav = [
  { key: 'today', label: 'today', Icon: HouseSimpleIcon },
  { key: 'planner', label: 'planner', Icon: ListChecksIcon },
  { key: 'courses', label: 'courses', Icon: BookOpenIcon },
  { key: 'degree', label: 'degree', Icon: GraduationCapIcon },
  { key: 'updates', label: 'updates', Icon: BellIcon },
] as const;

export default function App() {
  const [loaded, fontError] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, NotoSansArabic_400Regular, NotoSansArabic_600SemiBold });
  return <SafeAreaProvider><AppProvider><ThemedRoot fontsReady={loaded || Boolean(fontError)} /></AppProvider></SafeAreaProvider>;
}
function ThemedRoot({ fontsReady }: { fontsReady: boolean }) {
  const { data } = useApp();
  return <DesignProvider language={data.settings.language} theme={data.settings.theme}>{fontsReady ? <Workspace /> : <Skeleton />}</DesignProvider>;
}
function Workspace() {
  const app = useApp();
  const { c, dark, lang, rtl, t } = useDesign();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [screen, setScreen] = useState('today');
  const [filter, setFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<AcademicEvent | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [eventForm, setEventForm] = useState<{ event?: AcademicEvent; courseId?: string } | null>(null);
  const [courseForm, setCourseForm] = useState<{ course?: Course } | null>(null);
  const [studyForm, setStudyForm] = useState<{ course?: StudyCourse } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const fade = useRef(new Animated.Value(1)).current;
  const reducedMotion = useRef(true);
  const reminderQueue = useRef(Promise.resolve());
  const unread = app.data.alerts.filter(alert => !alert.seen_at).length + app.data.updates.filter(update => update.status === 'pending').length;
  const openEvent = (event: AcademicEvent) => { setSelectedCourse(null); setSelectedEvent(event); };
  const navigate = (next: string, nextFilter = 'all') => { setScreen(next); setFilter(nextFilter); scrollRef.current?.scrollTo({ y: 0, animated: false }); };
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { reducedMotion.current = value; });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reducedMotion.current = value; });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (reducedMotion.current) return;
    fade.setValue(0.8);
    const animation = Animated.spring(fade, { toValue: 1, damping: 24, stiffness: 220, mass: 0.8, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [screen, fade]);
  useEffect(() => {
    if (Platform.OS === 'web') { document.documentElement.lang = lang; document.documentElement.dir = rtl ? 'rtl' : 'ltr'; document.title = `${t('brand')} | ${t(nav.find(item => item.key === screen)?.label || 'settings')}`; }
  }, [lang, screen, rtl]);
  useEffect(() => {
    if (app.mode !== 'loading') {
      void publishWidgets(app.data, app.mode === 'demo' || app.mode === 'live', dark).catch(app.report);
    }
  }, [app.data, app.mode, dark]);
  useEffect(() => {
    if (app.mode === 'loading') return;
    reminderQueue.current = reminderQueue.current.catch(() => undefined).then(() => app.mode === 'demo' || app.mode === 'live' ? scheduleReminders(app.data) : clearDeviceReminders()).catch(app.report);
  }, [app.data, app.mode]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;
    void import('expo-notifications').then(notifications => {
      if (cancelled) return;
      notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
      subscription = notifications.addNotificationResponseReceivedListener(response => {
        const alertId = response.notification.request.content.data?.alertId;
        if (typeof alertId === 'string') void app.markSeen(alertId).catch(app.report);
        navigate('updates');
      });
    }).catch(app.report);
    return () => { cancelled = true; subscription?.remove(); };
  }, [app.mode]);
  useEffect(() => { if (app.mode === 'signed-out') { navigate('today'); setSelectedCourse(null); setSelectedEvent(null); setEventForm(null); setCourseForm(null); setStudyForm(null); } }, [app.mode]);
  if (app.mode === 'loading') return <Skeleton />;
  const navItem = (item: typeof nav[number], small = false) => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={t(item.label)} accessibilityState={{ selected: screen === item.key }} onPress={() => navigate(item.key)} style={({ pressed }) => ({ flex: small ? 1 : undefined, minHeight: small ? 61 : 48, justifyContent: 'center', borderRadius: 12, backgroundColor: screen === item.key && !small ? c.tint : pressed ? c.subtle : 'transparent', paddingHorizontal: small ? 2 : 14, marginBottom: small ? 0 : 6 })}><View style={{ flexDirection: small ? 'column' : rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: small ? 4 : 13 }}><View><item.Icon size={small ? 23 : 21} color={screen === item.key ? c.accent : c.muted} weight={screen === item.key ? 'regular' : 'light'} />{item.key === 'updates' && unread ? <View style={{ position: 'absolute', top: -6, right: -9, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: c.accent, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Txt size={9} color={c.onAccent} weight="medium">{unread}</Txt></View> : null}</View><Txt size={small ? 10 : 14} weight={screen === item.key ? 'medium' : 'regular'} color={screen === item.key ? c.accent : c.muted}>{t(item.label)}</Txt></View></Pressable>;
  return <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: c.bg, direction: 'ltr' }}><StatusBar style={dark ? 'light' : 'dark'} />
    {app.mode === 'signed-out' ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{app.error ? <View style={{ padding: 16 }}><Notice text={app.error} danger onClose={app.clearError} /></View> : null}<Welcome /></ScrollView> : <View style={{ flex: 1, flexDirection: rtl ? 'row-reverse' : 'row' }}>
      {desktop ? <View style={{ width: 222, backgroundColor: c.nav, paddingHorizontal: 18, paddingTop: 29, paddingBottom: 22, borderRightWidth: rtl ? 0 : 1, borderLeftWidth: rtl ? 1 : 0, borderColor: c.line }}><Row gap={10} style={{ paddingHorizontal: 7, marginBottom: 40 }}><View style={{ width: 35, height: 35, backgroundColor: c.accent, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}><BookOpenIcon size={21} weight="light" color={c.onAccent} /></View><Txt size={19} weight="bold">{t('brand')}</Txt></Row><Txt size={10} color={c.muted} style={{ marginHorizontal: 14, marginBottom: 13 }}>{app.mode === 'demo' ? t('demoBadge') : t('liveBadge')}</Txt>{nav.map(item => navItem(item))}<View style={{ flex: 1 }} /><View style={{ backgroundColor: c.tint, borderRadius: 16, padding: 16, gap: 9, marginBottom: 22 }}><ShieldNote /><Txt size={11} color={c.muted}>{app.mode === 'demo' ? t('demoBanner') : t('signInNote')}</Txt></View><Pressable accessibilityRole="button" accessibilityLabel={t('settings')} onPress={() => navigate('settings')} style={{ padding: 13, backgroundColor: screen === 'settings' ? c.tint : 'transparent', borderRadius: 12 }}><Row gap={13}><GearSixIcon size={21} weight="light" color={c.muted} /><Txt color={c.muted}>{t('settings')}</Txt></Row></Pressable><View style={{ height: 1, backgroundColor: c.line, marginVertical: 17 }} /><Row gap={10} style={{ paddingHorizontal: 8 }}><View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.subtle, alignItems: 'center', justifyContent: 'center' }}><Txt weight="medium" color={c.accent}>{app.data.settings.display_name.slice(0, 1) || 'S'}</Txt></View><View style={{ flex: 1 }}><Txt size={12} weight="medium" numberOfLines={1}>{app.data.settings.display_name.split(' · ')[0] || t('brand')}</Txt><Txt size={10} color={c.muted}>{app.mode === 'demo' ? t('demoBadge') : t('university')}</Txt></View><IconAction label={t('signOut')} icon={<SignOutIcon size={18} color={c.muted} weight="light" />} onPress={() => void app.signOut().catch(app.report)} /></Row></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}><Row style={{ minHeight: desktop ? 78 : 63, paddingHorizontal: desktop ? 36 : 19, justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: c.line }}><Row gap={8}>{!desktop ? <BookOpenIcon size={23} color={c.accent} weight="light" /> : null}<Txt size={desktop ? 13 : 18} weight={desktop ? 'regular' : 'bold'} color={desktop ? c.muted : c.text}>{desktop ? formatDate(new Date().toISOString(), lang, app.data.settings.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : t('brand')}</Txt></Row><Row gap={2}><IconAction label={lang === 'en' ? 'العربية' : 'English'} icon={<TranslateIcon size={20} weight="light" color={c.muted} />} onPress={() => void app.updateSettings({ ...app.data.settings, language: lang === 'en' ? 'ar' : 'en' }).catch(app.report)} /><IconAction label={t(dark ? 'light' : 'dark')} icon={dark ? <SunIcon size={20} weight="light" color={c.muted} /> : <MoonIcon size={20} weight="light" color={c.muted} />} onPress={() => void app.updateSettings({ ...app.data.settings, theme: dark ? 'light' : 'dark' }).catch(app.report)} />{desktop ? <IconAction label={t('refresh')} icon={<ArrowClockwiseIcon size={20} weight="light" color={c.muted} />} onPress={() => void app.refresh().catch(app.report)} /> : <IconAction label={t('settings')} icon={<GearSixIcon size={21} weight="light" color={c.muted} />} onPress={() => navigate('settings')} />}</Row></Row>
      <ScrollView ref={scrollRef} refreshControl={<RefreshControl refreshing={app.busy} onRefresh={() => void app.refresh().catch(app.report)} tintColor={c.accent} />} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: desktop ? 34 : 19, paddingBottom: 35, gap: 17, maxWidth: 1280, width: '100%', alignSelf: 'center' }}>{app.mode === 'demo' ? <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 4 }}><Badge label={t('demoBadge')} /><Txt size={11} color={c.muted} style={{ flexShrink: 1 }}>{t('demoBanner')}</Txt></Row> : null}{app.error ? <Notice text={app.error} danger onClose={app.clearError} /> : null}{app.notice ? <Notice text={app.notice} onClose={app.clearNotice} /> : null}
        <Animated.View style={{ opacity: fade }}>
          {screen === 'today' ? <Home onEvent={openEvent} onCourse={setSelectedCourse} onAdd={() => setEventForm({})} navigate={navigate} /> : null}
          {screen === 'planner' ? <Planner key={filter} initialFilter={filter} onEvent={openEvent} onAdd={() => setEventForm({})} /> : null}
          {screen === 'courses' ? <Courses onCourse={setSelectedCourse} onAdd={() => setCourseForm({})} /> : null}
          {screen === 'degree' ? <Degree onAdd={() => setStudyForm({})} onEdit={course => setStudyForm({ course })} onSettings={() => navigate('settings')} /> : null}
          {screen === 'updates' ? <Updates /> : null}
          {screen === 'settings' ? <SettingsScreen key={lang + String(dark)} /> : null}
        </Animated.View>
      </ScrollView>
      {!desktop ? <Row gap={0} style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 3, backgroundColor: c.nav, borderTopWidth: 1, borderTopColor: c.line }}>{nav.map(item => navItem(item, true))}</Row> : null}</View>
    </View>}
    {selectedEvent ? <EventDetail event={app.data.events.find(item => item.id === selectedEvent.id) || selectedEvent} onClose={() => setSelectedEvent(null)} onEdit={() => { setEventForm({ event: app.data.events.find(item => item.id === selectedEvent.id) || selectedEvent }); setSelectedEvent(null); }} onDelete={() => { setDeleteTarget(selectedEvent.id); setSelectedEvent(null); }} /> : null}
    {selectedCourse ? <CourseDetails course={app.data.courses.find(item => item.id === selectedCourse.id) || selectedCourse} onClose={() => setSelectedCourse(null)} onEvent={openEvent} onAddEvent={() => { setEventForm({ courseId: selectedCourse.id }); setSelectedCourse(null); }} onEdit={() => { setCourseForm({ course: selectedCourse }); setSelectedCourse(null); }} /> : null}
    {eventForm ? <EventForm {...eventForm} onClose={() => setEventForm(null)} /> : null}{courseForm ? <CourseForm {...courseForm} onClose={() => setCourseForm(null)} /> : null}{studyForm ? <StudyCourseForm {...studyForm} onClose={() => setStudyForm(null)} /> : null}
    {deleteTarget ? <Confirm title={t('deleteConfirm')} body={t('deleteBody')} label={t('delete')} danger onConfirm={() => app.deleteEvent(deleteTarget)} onClose={() => setDeleteTarget(null)} /> : null}
  </SafeAreaView>;
}
function ShieldNote() { const { c, t } = useDesign(); return <Row gap={7}><BookOpenIcon size={17} weight="light" color={c.accent} /><Txt size={12} weight="medium" color={c.accent}>{t('tagline')}</Txt></Row>; }
function EventDetail({ event, onClose, onEdit, onDelete }: { event: AcademicEvent; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const { data, toggleEvent, report } = useApp();
  const { c, lang, t } = useDesign();
  const course = data.courses.find(item => item.id === event.course_id);
  return <Sheet visible title={t('details')} onClose={onClose}><Row><Badge label={t(event.kind)} tone="accent" /><Badge label={t(event.source)} /></Row><Txt size={25} weight="bold">{eventName(event, lang)}</Txt>{course ? <Txt color={c.muted}>{course.code} / {courseName(course, lang)}</Txt> : null}<Card style={{ backgroundColor: c.tint, borderColor: c.tint }}><Txt size={19} weight="medium">{formatDate(event.starts_at, lang, data.settings.timezone, { weekday: 'long', day: 'numeric', month: 'long' })}</Txt><Txt style={{ marginTop: 7 }}>{formatTime(event.starts_at, lang, data.settings.timezone)} ({data.settings.timezone})</Txt>{event.location ? <Txt color={c.muted} style={{ marginTop: 10 }}>{event.location}</Txt> : null}</Card>{event.notes ? <View style={{ gap: 8 }}><Txt weight="medium">{t('notes')}</Txt><Txt color={c.muted} selectable>{event.notes}</Txt></View> : null}<Action label={t(event.status === 'completed' ? 'reopen' : 'complete')} onPress={() => void toggleEvent(event).then(onClose).catch(report)} /><Row style={{ justifyContent: 'space-between' }}><Action label={t('edit')} variant="secondary" onPress={onEdit} /><Action label={t('delete')} variant="danger" onPress={onDelete} /></Row></Sheet>;
}
