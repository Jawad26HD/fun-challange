import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useApp } from '../state/AppProvider';
import { configured } from '../lib/supabase';
import { Action, Card, Notice, Row, Sheet, Txt, useDesign } from '../components/ui';
import { BellIcon, BookOpenIcon, CalendarCheckIcon, GraduationCapIcon, ShieldCheckIcon, TranslateIcon, WindowsLogoIcon } from '../components/icons';

export function Welcome() {
  const { data, enterDemo, signIn, updateSettings, report } = useApp();
  const { c, lang, rtl, t } = useDesign();
  const { width } = useWindowDimensions();
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const desktop = width >= 900;
  const start = async (demo = false) => { setBusy(true); try { if (demo) await enterDemo(); else if (!configured) setSetup(true); else await signIn(); } catch (err) { report(err); } finally { setBusy(false); } };
  return <View style={{ width: '100%', maxWidth: 1240, alignSelf: 'center', padding: width < 600 ? 23 : 44, flex: 1 }}><Row style={{ justifyContent: 'space-between', marginBottom: desktop ? 60 : 32 }}><Row gap={10}><View style={{ backgroundColor: c.accent, width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }}><BookOpenIcon size={23} weight="light" color={c.onAccent} /></View><Txt size={21} weight="bold">{t('brand')}</Txt></Row><Action label={lang === 'en' ? 'العربية' : 'English'} variant="ghost" compact icon={<TranslateIcon size={18} weight="light" color={c.accent} />} onPress={() => void updateSettings({ ...data.settings, language: lang === 'en' ? 'ar' : 'en' }).catch(report)} /></Row>
    <View style={{ flexDirection: desktop ? (rtl ? 'row-reverse' : 'row') : 'column', gap: desktop ? 80 : 28, flex: 1, justifyContent: 'center', alignItems: desktop ? 'center' : 'stretch' }}>
      <View style={{ flex: desktop ? 1 : undefined }}><Txt size={12} weight="medium" color={c.accent} style={{ marginBottom: 17 }}>{t('university')}</Txt><Txt size={desktop ? 53 : 37} weight="bold" accessibilityRole="header" style={{ letterSpacing: rtl ? 0 : -1.8, lineHeight: desktop ? (rtl ? 78 : 64) : (rtl ? 60 : 47) }}>{t('welcome')}</Txt><Txt size={16} color={c.muted} style={{ maxWidth: 410, marginTop: 20 }}>{t('welcomeBody')}</Txt><View style={{ gap: 16, marginTop: 31 }}>{[{ Icon: CalendarCheckIcon, text: t('earliestFirst') }, { Icon: BellIcon, text: t('reminders') }, { Icon: GraduationCapIcon, text: t('degree') }].map(({ Icon, text }) => <Row key={text} gap={12}><View style={{ width: 35, height: 35, backgroundColor: c.tint, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}><Icon size={20} weight="light" color={c.accent} /></View><Txt size={14}>{text}</Txt></Row>)}</View></View>
      <View style={{ flex: desktop ? 0.9 : undefined, maxWidth: desktop ? 440 : undefined, backgroundColor: c.subtle, padding: 7, borderRadius: 29 }}><Card style={{ padding: width < 600 ? 24 : 32, borderRadius: 23, borderColor: c.surface }}><View style={{ width: 48, height: 48, backgroundColor: c.tint, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}><ShieldCheckIcon size={29} weight="light" color={c.accent} /></View><Txt size={24} weight="bold">{t('privacy')}</Txt><Txt size={14} color={c.muted} style={{ marginTop: 12, marginBottom: 27 }}>{t('privacyBody')}</Txt><Action label={t('signIn')} busy={busy} icon={<WindowsLogoIcon size={19} weight="light" color={c.onAccent} />} onPress={() => void start()} /><Txt size={11} color={c.muted} style={{ marginTop: 11, marginBottom: 23 }}>{t('signInNote')}</Txt><View style={{ height: 1, backgroundColor: c.line, marginBottom: 23 }} /><Action label={t('demo')} variant="secondary" busy={busy} onPress={() => void start(true)} /><Txt size={11} color={c.muted} style={{ marginTop: 11 }}>{t('demoNote')}</Txt></Card></View>
    </View><Txt size={11} color={c.muted} style={{ marginTop: 42 }}>{t('about')}</Txt>
    {setup ? <Sheet visible title={t('setupNeeded')} onClose={() => setSetup(false)}><Txt color={c.muted}>{t('setupBody')}</Txt><Action label={t('demo')} onPress={() => { setSetup(false); void start(true); }} /></Sheet> : null}
  </View>;
}
