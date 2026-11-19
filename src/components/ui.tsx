import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle, type TextInputProps } from 'react-native';
import type { Language, ThemePreference } from '../types';
import { translate, type TranslationKey } from '../lib/i18n';

const light = { bg: '#F5F7F5', surface: '#FDFEFC', subtle: '#EDF2EC', line: '#DFE6DE', text: '#202F29', muted: '#5E6E63', faint: '#778079', accent: '#176B52', onAccent: '#FBFDFB', tint: '#E4F0E7', softAccent: '#BFD7B6', warning: '#8A531D', warningBg: '#FAEFDE', danger: '#AF3943', dangerBg: '#F9E9E9', nav: '#FDFEFC' };
const dark: typeof light = { bg: '#131B17', surface: '#1B2720', subtle: '#23332A', line: '#34463A', text: '#EBF1E9', muted: '#ADBDAF', faint: '#92A697', accent: '#91CFAB', onAccent: '#143D2A', tint: '#254833', softAccent: '#436C4B', warning: '#EDC48A', warningBg: '#493822', danger: '#F1A6AA', dangerBg: '#492C30', nav: '#18231D' };
interface Design { c: typeof light; rtl: boolean; lang: Language; dark: boolean; t: (key: TranslationKey) => string }
const DesignContext = createContext<Design>({ c: light, rtl: false, lang: 'en', dark: false, t: key => translate('en', key) });
export function DesignProvider({ language, theme, children }: { language: Language; theme: ThemePreference; children: React.ReactNode }) {
  const system = useColorScheme();
  const isDark = theme === 'dark' || (theme === 'system' && system === 'dark');
  return <DesignContext.Provider value={{ c: isDark ? dark : light, rtl: language === 'ar', lang: language, dark: isDark, t: key => translate(language, key) }}>{children}</DesignContext.Provider>;
}
export const useDesign = () => useContext(DesignContext);

export function Txt({ children, size = 14, weight = 'regular', color, style, numberOfLines, ...rest }: { children?: React.ReactNode; size?: number; weight?: 'regular' | 'medium' | 'bold'; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; accessibilityRole?: 'header'; selectable?: boolean }) {
  const { c, rtl } = useDesign();
  const font = rtl ? (weight === 'regular' ? 'NotoSansArabic_400Regular' : 'NotoSansArabic_600SemiBold') : (weight === 'bold' ? 'Outfit_600SemiBold' : weight === 'medium' ? 'Outfit_500Medium' : 'Outfit_400Regular');
  return <Text {...rest} numberOfLines={numberOfLines} style={[{ fontFamily: font, fontSize: size, lineHeight: size * (rtl ? 1.7 : 1.45), color: color || c.text, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style]}>{children}</Text>;
}
export function Row({ children, style, gap = 10 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  const { rtl } = useDesign();
  return <View style={[{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useDesign();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 20, padding: 22 }, style]}>{children}</View>;
}
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'warning' | 'danger' }) {
  const { c } = useDesign();
  const colors = { neutral: [c.subtle, c.muted], accent: [c.tint, c.accent], warning: [c.warningBg, c.warning], danger: [c.dangerBg, c.danger] }[tone];
  return <View style={{ backgroundColor: colors[0], paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' }}><Txt size={11} weight="medium" color={colors[1]}>{label}</Txt></View>;
}
export function Action({ label, onPress, variant = 'primary', icon, disabled = false, busy = false, style, compact = false }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: React.ReactNode; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const { c } = useDesign();
  const backgroundColor = variant === 'primary' ? c.accent : variant === 'secondary' ? c.surface : variant === 'danger' ? c.dangerBg : 'transparent';
  const color = variant === 'primary' ? c.onAccent : variant === 'danger' ? c.danger : c.accent;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: compact ? 12 : 18, paddingVertical: 10, borderRadius: 12, backgroundColor, borderWidth: variant === 'secondary' ? 1 : 0, borderColor: c.line, opacity: disabled || busy ? 0.55 : pressed ? 0.78 : 1, transform: [{ scale: pressed ? 0.98 : 1 }], justifyContent: 'center', alignItems: 'center' }, style]}><Row gap={8}>{icon}<Txt size={compact ? 12 : 14} weight="medium" color={color} style={{ textAlign: 'center' }}>{label}</Txt></Row></Pressable>;
}
export function IconAction({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  const { c } = useDesign();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: pressed ? c.subtle : 'transparent' })}>{icon}</Pressable>;
}
export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string; style?: StyleProp<TextStyle> }) {
  const { c, rtl } = useDesign();
  return <View style={{ gap: 7, flexShrink: 1 }}><Txt size={12} weight="medium">{label}</Txt><TextInput accessibilityLabel={label} placeholderTextColor={c.faint} {...props} style={[{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, color: c.text, fontSize: 14, fontFamily: rtl ? 'NotoSansArabic_400Regular' : 'Outfit_400Regular', textAlign: rtl ? 'right' : 'left' }, props.multiline && { minHeight: 100, textAlignVertical: 'top' }, style]} />{hint ? <Txt size={11} color={c.muted}>{hint}</Txt> : null}</View>;
}
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const { c } = useDesign();
  return <Row gap={7} style={{ flexWrap: 'wrap' }}>{options.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: value === option.value ? c.accent : pressed ? c.subtle : c.surface, borderWidth: 1, borderColor: value === option.value ? c.accent : c.line })}><Txt size={12} weight="medium" color={value === option.value ? c.onAccent : c.muted}>{option.label}</Txt></Pressable>)}</Row>;
}
export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  const { c } = useDesign();
  return <View style={{ alignItems: 'center', gap: 12, paddingVertical: 36, paddingHorizontal: 20 }}>{icon ? <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}>{icon}</View> : null}<Txt size={19} weight="medium" style={{ textAlign: 'center' }}>{title}</Txt><Txt color={c.muted} style={{ textAlign: 'center', maxWidth: 360 }}>{body}</Txt>{action}</View>;
}
export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  const { c } = useDesign();
  return <Row style={{ justifyContent: 'space-between', marginBottom: 16 }}><View style={{ flex: 1 }}><Txt size={20} weight="bold" accessibilityRole="header">{title}</Txt>{subtitle ? <Txt size={12} color={c.muted} style={{ marginTop: 3 }}>{subtitle}</Txt> : null}</View>{action}</Row>;
}
export function Sheet({ title, visible, onClose, children, wide = false }: { title: string; visible: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const { c, t } = useDesign();
  const { width, height } = useWindowDimensions();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: 'rgba(9,20,14,0.5)', justifyContent: width < 600 ? 'flex-end' : 'center', alignItems: 'center', padding: width < 600 ? 0 : 24 }}><View accessibilityViewIsModal style={{ width: '100%', maxWidth: wide ? 760 : 540, maxHeight: height * 0.92, backgroundColor: c.surface, borderRadius: 24, borderBottomLeftRadius: width < 600 ? 0 : 24, borderBottomRightRadius: width < 600 ? 0 : 24, padding: 24 }}><Row style={{ justifyContent: 'space-between', paddingBottom: 18 }}><Txt size={23} weight="bold" style={{ flex: 1 }} accessibilityRole="header">{title}</Txt><Action label={t('close')} variant="ghost" compact onPress={onClose} /></Row><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>{children}</ScrollView></View></View></Modal>;
}
export function Skeleton() {
  const { c } = useDesign();
  return <View accessibilityLabel="Loading planner" style={{ padding: 28, gap: 22, flex: 1, backgroundColor: c.bg }}><View style={{ width: 180, height: 26, borderRadius: 8, backgroundColor: c.line }} />{[0, 1, 2, 3].map(n => <View key={n} style={{ height: n ? 86 : 150, borderRadius: 20, backgroundColor: c.subtle }} />)}</View>;
}
export function Notice({ text, danger = false, onClose }: { text: string; danger?: boolean; onClose?: () => void }) {
  const { c, t } = useDesign();
  return <View accessibilityRole="alert" style={{ backgroundColor: danger ? c.dangerBg : c.tint, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}><Row><Txt size={13} color={danger ? c.danger : c.accent} style={{ flex: 1 }}>{text}</Txt>{onClose ? <Action label={t('close')} variant="ghost" compact onPress={onClose} /> : null}</Row></View>;
}
