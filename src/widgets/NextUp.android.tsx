import { Column, Text } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';
import type { NextUpProps } from './types';

function Layout(props: NextUpProps) {
  'widget';
  return <Column modifiers={[fillMaxSize(), background(props.background), paddingAll(16)]}>
    <Text color={props.accent} style={{ fontSize: 10 }} maxLines={1}>{props.lectureLabel}</Text>
    <Text color={props.foreground} style={{ fontSize: 15, fontWeight: '600' }} maxLines={1}>{props.lectureTitle}</Text>
    <Text color={props.muted} style={{ fontSize: 11 }} maxLines={1}>{props.lectureWhen}</Text>
    <Text color={props.accent} style={{ fontSize: 10 }} maxLines={1}>{props.examLabel}</Text>
    <Text color={props.foreground} style={{ fontSize: 15, fontWeight: '600' }} maxLines={2}>{props.examTitle}</Text>
    <Text color={props.muted} style={{ fontSize: 11 }} maxLines={1}>{props.examWhen}</Text>
  </Column>;
}
export default createWidget('NextUp', Layout, { lectureLabel: 'Next lecture', lectureTitle: 'Open Student Hub', lectureWhen: '', examLabel: 'Next exam', examTitle: 'Open Student Hub', examWhen: '', background: '#EDF2EC', foreground: '#202F29', muted: '#5E6E63', accent: '#176B52', rtl: false });
