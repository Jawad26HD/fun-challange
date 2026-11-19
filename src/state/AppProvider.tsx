import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import type { AcademicEvent, Alert, Course, OutlookConnection, PlannerData, Settings, StudyCourse } from '../types';
import { applyDemoUpdate, defaultSettings, emptyPlanner } from '../lib/planner';
import { createDemoData } from '../data/demo';
import { configured, supabase, universityDomain } from '../lib/supabase';
import { translate } from '../lib/i18n';
import { createAuthCallbackHandler } from '../lib/auth-callback';

const authRedirectUrl = () => process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL || (Platform.OS === 'web' ? globalThis.location.origin : AuthSession.makeRedirectUri({ scheme: 'studenthub', path: 'auth/callback' }));
const finishNativeAuth = createAuthCallbackHandler(async code => {
  if (!supabase) throw new Error('University sign-in is not configured.');
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
});
WebBrowser.maybeCompleteAuthSession();
const DEMO_KEY = 'studenthub-demo-v1';
const MODE_KEY = 'studenthub-mode';
const CONNECT_KEY = 'studenthub-mail-consent';
type Mode = 'loading' | 'signed-out' | 'demo' | 'live';
interface AppContextValue {
  data: PlannerData; mode: Mode; busy: boolean; error: string | null; notice: string | null; connection: OutlookConnection; lastSync: string | null;
  clearError: () => void; notify: (message: string) => void; clearNotice: () => void; report: (error: unknown) => void;
  enterDemo: () => Promise<void>; resetDemo: () => Promise<void>; signIn: (mailbox?: boolean) => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void>;
  saveEvent: (event: AcademicEvent) => Promise<void>; deleteEvent: (id: string) => Promise<void>; toggleEvent: (event: AcademicEvent) => Promise<void>;
  saveCourse: (course: Course) => Promise<void>; saveStudyCourse: (course: StudyCourse) => Promise<void>; updateSettings: (settings: Settings) => Promise<void>;
  markSeen: (id?: string) => Promise<void>; demoAlert: () => Promise<void>; resolveUpdate: (id: string, action: 'apply' | 'dismiss' | 'revert') => Promise<void>;
  syncMailbox: () => Promise<void>; disconnectMailbox: () => Promise<void>;
}
const AppContext = createContext<AppContextValue | null>(null);
export const newId = () => Crypto.randomUUID();
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppProvider is required');
  return value;
}
function restoreData(raw: string): PlannerData {
  const value = JSON.parse(raw) as PlannerData;
  if (!value || !Array.isArray(value.courses) || !Array.isArray(value.events) || !Array.isArray(value.study_courses) || !Array.isArray(value.alerts) || !Array.isArray(value.updates)) throw new Error('The saved planner could not be read.');
  return { ...value, settings: { ...defaultSettings, ...value.settings, alert_types: { ...defaultSettings.alert_types, ...value.settings?.alert_types } } };
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'The request could not be completed.';
}
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<PlannerData>(emptyPlanner);
  const [mode, setMode] = useState<Mode>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<OutlookConnection>({ connected: false });
  const [lastSync, setLastSync] = useState<string | null>(null);
  const dataRef = useRef(data);
  const modeRef = useRef(mode);
  const sessionRef = useRef<Session | null>(null);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const authInProgress = useRef(false);
  const report = useCallback((err: unknown) => setError(messageOf(err)), []);
  const changeMode = (next: Mode) => { modeRef.current = next; setMode(next); };
  const replaceData = (next: PlannerData) => { dataRef.current = next; setData(next); };
  const cacheKey = () => modeRef.current === 'demo' ? DEMO_KEY : modeRef.current === 'live' ? `studenthub-cache-v1-${sessionRef.current!.user.id}` : 'studenthub-preferences';
  const commit = async (updater: (current: PlannerData) => PlannerData) => {
    const next = updater(dataRef.current);
    replaceData(next);
    try { await AsyncStorage.setItem(cacheKey(), JSON.stringify(next)); } catch { setError('This device could not save an offline copy.'); }
  };
  const callFunction = async <T,>(name: string, body?: Record<string, unknown>): Promise<T> => {
    if (!supabase || !sessionRef.current) throw new Error('Sign in to your university account first.');
    const result = await supabase.functions.invoke(name, { body: body || {} });
    if (result.error) {
      let details = result.error.message;
      try { const payload = await result.error.context?.json(); if (payload?.error) details = payload.error; } catch {}
      throw new Error(details);
    }
    if (result.data?.error) throw new Error(result.data.error);
    return result.data as T;
  };
  const loadCloud = async (session: Session) => {
    if (!supabase) return;
    const currentGeneration = generation.current;
    const sequence = ++refreshSequence.current;
    const owner = session.user.id;
    const results = await Promise.all([
      supabase.from('courses').select('*').eq('user_id', owner),
      supabase.from('events').select('*').eq('user_id', owner),
      supabase.from('study_courses').select('*').eq('user_id', owner),
      supabase.from('alerts').select('*').eq('user_id', owner).order('created_at', { ascending: false }).limit(100),
      supabase.from('outlook_updates').select('*').eq('user_id', owner).order('received_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('settings').eq('user_id', owner).maybeSingle(),
    ]);
    if (currentGeneration !== generation.current || sequence !== refreshSequence.current || modeRef.current !== 'live' || sessionRef.current?.user.id !== owner) return;
    const failure = results.find(result => result.error);
    if (failure?.error) throw failure.error;
    const profile = results[5]?.data as { settings?: Partial<Settings> } | null;
    const next: PlannerData = { courses: (results[0]?.data || []) as Course[], events: (results[1]?.data || []) as AcademicEvent[], study_courses: (results[2]?.data || []) as StudyCourse[], alerts: (results[3]?.data || []) as Alert[], updates: (results[4]?.data || []) as PlannerData['updates'], settings: { ...defaultSettings, ...profile?.settings, alert_types: { ...defaultSettings.alert_types, ...profile?.settings?.alert_types } } };
    replaceData(next);
    setLastSync(new Date().toISOString());
    await AsyncStorage.setItem(`studenthub-cache-v1-${owner}`, JSON.stringify(next));
    try { const status = await callFunction<OutlookConnection>('outlook-status'); if (currentGeneration === generation.current && sessionRef.current?.user.id === owner && modeRef.current === 'live') setConnection(status); } catch { if (currentGeneration === generation.current) setConnection({ connected: false, error: 'Outlook connection status is unavailable.' }); }
  };
  const startSession = async (session: Session) => {
    if (sessionRef.current?.access_token === session.access_token && modeRef.current === 'live') return;
    if (!configured || session.user.email?.split('@')[1]?.toLowerCase() !== universityDomain || !session.user.identities?.some(identity => identity.provider === 'azure')) {
      await supabase?.auth.signOut();
      throw new Error('Please use an approved university Microsoft account.');
    }
    const changedUser = sessionRef.current?.user.id !== session.user.id;
    if (changedUser) { generation.current++; replaceData(emptyPlanner()); }
    sessionRef.current = session;
    changeMode('live');
    await AsyncStorage.setItem(MODE_KEY, 'live');
    if (changedUser) {
      const cached = await AsyncStorage.getItem(`studenthub-cache-v1-${session.user.id}`);
      if (cached && sessionRef.current?.user.id === session.user.id && modeRef.current === 'live') { try { replaceData(restoreData(cached)); } catch {} }
    }
    const consentTime = Number(await AsyncStorage.getItem(CONNECT_KEY));
    if (consentTime && Date.now() - consentTime < 15 * 60 * 1000 && session.provider_token) {
      await AsyncStorage.removeItem(CONNECT_KEY);
      if (!session.provider_refresh_token) setError('Microsoft did not grant background mailbox access. Reconnect Outlook and approve offline access.');
      else {
        try { await callFunction('outlook-connect', { access_token: session.provider_token, refresh_token: session.provider_refresh_token }); }
        catch (err) { report(err); }
      }
    }
    await loadCloud(session);
  };
  useEffect(() => {
    let disposed = false;
    const initialize = async () => {
      try {
        const savedMode = await AsyncStorage.getItem(MODE_KEY);
        if (disposed) return;
        if (supabase) {
          let resumedAuth = false;
          if (Platform.OS !== 'web') {
            const initialUrl = await Linking.getInitialURL();
            if (disposed) return;
            if (initialUrl) resumedAuth = await finishNativeAuth(initialUrl, authRedirectUrl());
          }
          const { data: result, error: sessionError } = await supabase.auth.getSession();
          if (disposed) return;
          if (sessionError) throw sessionError;
          if (result.session && (savedMode !== 'demo' || resumedAuth)) { await startSession(result.session); return; }
        }
        if (modeRef.current === 'live') return;
        if (savedMode === 'demo') {
          const saved = await AsyncStorage.getItem(DEMO_KEY);
          if (disposed) return;
          replaceData(saved ? restoreData(saved) : createDemoData());
          changeMode('demo');
        } else changeMode('signed-out');
      } catch (err) { if (!disposed) { report(err); if (modeRef.current === 'loading') changeMode('signed-out'); } }
    };
    void initialize();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) setTimeout(() => { if (!disposed) void startSession(session).catch(report); }, 0);
      if (event === 'TOKEN_REFRESHED' && session) sessionRef.current = session;
      if (event === 'SIGNED_OUT' && modeRef.current === 'live') {
        generation.current++;
        sessionRef.current = null;
        replaceData(emptyPlanner());
        changeMode('signed-out');
        setConnection({ connected: false });
      }
    });
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      if (Platform.OS === 'web' || !supabase) return;
      void finishNativeAuth(url, authRedirectUrl()).catch(report);
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') { supabase?.auth.startAutoRefresh(); if (sessionRef.current && modeRef.current === 'live') void loadCloud(sessionRef.current).catch(report); }
      else supabase?.auth.stopAutoRefresh();
    });
    return () => { disposed = true; subscription?.data.subscription.unsubscribe(); linkSubscription.remove(); appState.remove(); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const enterDemo = async () => {
    generation.current++;
    const raw = await AsyncStorage.getItem(DEMO_KEY);
    const next = raw ? restoreData(raw) : createDemoData();
    replaceData(next);
    changeMode('demo');
    setError(null);
    setConnection({ connected: false });
    setLastSync(null);
    await AsyncStorage.multiSet([[MODE_KEY, 'demo'], [DEMO_KEY, JSON.stringify(next)]]);
  };
  const resetDemo = async () => { if (modeRef.current !== 'demo') return; await commit(() => createDemoData()); };
  const signIn = async (mailbox = false) => {
    if (!configured || !supabase) throw new Error(translate(dataRef.current.settings.language, 'setupBody'));
    if (authInProgress.current) return;
    authInProgress.current = true;
    try {
      if (mailbox) await AsyncStorage.setItem(CONNECT_KEY, String(Date.now()));
      else await AsyncStorage.removeItem(CONNECT_KEY);
      const redirectTo = authRedirectUrl();
      const { data: auth, error: authError } = await supabase.auth.signInWithOAuth({ provider: 'azure', options: { redirectTo, scopes: mailbox ? 'email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read offline_access' : 'email', skipBrowserRedirect: Platform.OS !== 'web', queryParams: { prompt: mailbox ? 'consent' : 'select_account', domain_hint: universityDomain } } });
      if (authError) throw authError;
      if (Platform.OS !== 'web') {
        if (!auth.url) throw new Error('Microsoft sign-in could not be started.');
        const result = await WebBrowser.openAuthSessionAsync(auth.url, redirectTo);
        if (result.type === 'success') {
          if (!await finishNativeAuth(result.url, redirectTo)) throw new Error('The sign-in callback was not valid. Please try again.');
        } else await AsyncStorage.removeItem(CONNECT_KEY);
      }
    } catch (error) {
      await AsyncStorage.removeItem(CONNECT_KEY);
      throw error;
    } finally { authInProgress.current = false; }
  };
  const signOut = async () => {
    const previousUser = sessionRef.current?.user.id;
    if (modeRef.current === 'live') { const result = await supabase?.auth.signOut(); if (result?.error) throw result.error; }
    generation.current++;
    sessionRef.current = null;
    changeMode('signed-out');
    replaceData(emptyPlanner());
    setConnection({ connected: false });
    setLastSync(null);
    setError(null);
    await AsyncStorage.removeItem(MODE_KEY);
    await AsyncStorage.removeItem(CONNECT_KEY);
    if (previousUser) await AsyncStorage.removeItem(`studenthub-cache-v1-${previousUser}`);
  };
  const refresh = async () => {
    if (modeRef.current !== 'live' || !sessionRef.current) return;
    setBusy(true); setError(null);
    try { await loadCloud(sessionRef.current); } finally { setBusy(false); }
  };
  const saveRow = async (table: string, row: AcademicEvent | Course | StudyCourse, exists: boolean) => {
    if (modeRef.current === 'demo') return row;
    if (!supabase || !sessionRef.current) throw new Error('Sign in before saving.');
    const owner = sessionRef.current.user.id;
    const expectedGeneration = generation.current;
    const payload: Record<string, unknown> = { ...row, user_id: owner };
    const result = exists ? await supabase.from(table).update(payload).eq('id', row.id).eq('user_id', owner).select().single() : await supabase.from(table).insert(payload).select().single();
    if (result.error) throw result.error;
    if (generation.current !== expectedGeneration || modeRef.current !== 'live' || sessionRef.current?.user.id !== owner) throw new Error('The signed-in account changed. Please try again.');
    return result.data;
  };
  const saveEvent = async (event: AcademicEvent) => {
    const row = { ...event, updated_at: new Date().toISOString() };
    const saved = await saveRow('events', row, dataRef.current.events.some(item => item.id === row.id)) as AcademicEvent;
    await commit(current => ({ ...current, events: current.events.some(item => item.id === saved.id) ? current.events.map(item => item.id === saved.id ? saved : item) : [...current.events, saved] }));
  };
  const deleteEvent = async (id: string) => {
    const expectedGeneration = generation.current;
    if (modeRef.current === 'live' && supabase && sessionRef.current) { const { error: deleteError } = await supabase.from('events').delete().eq('id', id).eq('user_id', sessionRef.current.user.id); if (deleteError) throw deleteError; }
    if (expectedGeneration !== generation.current) return;
    await commit(current => ({ ...current, events: current.events.filter(item => item.id !== id), alerts: current.alerts.filter(item => item.event_id !== id), updates: current.updates.map(item => item.event_id === id ? { ...item, event_id: null } : item) }));
  };
  const toggleEvent = async (event: AcademicEvent) => saveEvent({ ...event, status: event.status === 'completed' ? 'pending' : 'completed' });
  const saveCourse = async (course: Course) => { const saved = await saveRow('courses', course, dataRef.current.courses.some(item => item.id === course.id)) as Course; await commit(current => ({ ...current, courses: current.courses.some(item => item.id === saved.id) ? current.courses.map(item => item.id === saved.id ? saved : item) : [...current.courses, saved] })); };
  const saveStudyCourse = async (course: StudyCourse) => { const saved = await saveRow('study_courses', course, dataRef.current.study_courses.some(item => item.id === course.id)) as StudyCourse; await commit(current => ({ ...current, study_courses: current.study_courses.some(item => item.id === saved.id) ? current.study_courses.map(item => item.id === saved.id ? saved : item) : [...current.study_courses, saved] })); };
  const updateSettings = async (settings: Settings) => {
    const expectedGeneration = generation.current;
    if (modeRef.current === 'live' && supabase && sessionRef.current) { const { error: saveError } = await supabase.from('profiles').update({ settings }).eq('user_id', sessionRef.current.user.id).select('user_id').single(); if (saveError) throw saveError; }
    if (expectedGeneration !== generation.current) return;
    await commit(current => ({ ...current, settings }));
  };
  const markSeen = async (id?: string) => {
    const seen_at = new Date().toISOString();
    if (modeRef.current === 'live' && supabase && sessionRef.current) {
      let request = supabase.from('alerts').update({ seen_at }).eq('user_id', sessionRef.current.user.id);
      if (id) request = request.eq('id', id); else request = request.is('seen_at', null);
      const result = await request; if (result.error) throw result.error;
    }
    await commit(current => ({ ...current, alerts: current.alerts.map(alert => (!id || alert.id === id) && !alert.seen_at ? { ...alert, seen_at } : alert) }));
  };
  const demoAlert = async () => {
    if (modeRef.current !== 'demo') return;
    const language = dataRef.current.settings.language;
    const event = dataRef.current.events.filter(item => item.kind === 'exam' && item.status === 'pending' && new Date(item.starts_at) > new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    const alert: Alert = { id: newId(), event_id: event?.id || null, kind: 'exam', title: translate(language, 'nextExam'), body: event ? (language === 'ar' && event.title_ar ? event.title_ar : event.title) : translate(language, 'demoAlertBody'), created_at: new Date().toISOString(), seen_at: null };
    await commit(current => ({ ...current, alerts: [alert, ...current.alerts] }));
    setNotice(translate(language, 'demoAlertBody'));
    if (Platform.OS !== 'web') {
      const notifications = await import('expo-notifications');
      if ((await notifications.getPermissionsAsync()).granted) await notifications.scheduleNotificationAsync({ content: { title: alert.title, body: alert.body, data: { alertId: alert.id, eventId: alert.event_id } }, trigger: null });
    }
  };
  const resolveUpdate = async (id: string, action: 'apply' | 'dismiss' | 'revert') => {
    if (modeRef.current === 'demo') await commit(current => applyDemoUpdate(current, id, action));
    else {
      if (!supabase || !sessionRef.current) throw new Error('Sign in before reviewing a change.');
      const { error: resolveError } = await supabase.rpc('resolve_outlook_update', { p_update_id: id, p_action: action });
      if (resolveError) throw resolveError;
      await loadCloud(sessionRef.current);
    }
  };
  const syncMailbox = async () => {
    if (modeRef.current !== 'live') return;
    setBusy(true); setError(null);
    try { await callFunction('outlook-sync'); if (sessionRef.current) await loadCloud(sessionRef.current); setNotice(translate(dataRef.current.settings.language, 'syncComplete')); } finally { setBusy(false); }
  };
  const disconnectMailbox = async () => { await callFunction('outlook-disconnect'); setConnection({ connected: false }); };
  return <AppContext.Provider value={{ data, mode, busy, error, notice, connection, lastSync, clearError: () => setError(null), clearNotice: () => setNotice(null), notify: setNotice, report, enterDemo, resetDemo, signIn, signOut, refresh, saveEvent, deleteEvent, toggleEvent, saveCourse, saveStudyCourse, updateSettings, markSeen, demoAlert, resolveUpdate, syncMailbox, disconnectMailbox }}>{children}</AppContext.Provider>;
}
