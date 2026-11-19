import { Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';
import type { NextUpProps } from './types';

function Layout(props: NextUpProps) {
  'widget';
  return <VStack alignment={props.rtl ? 'trailing' : 'leading'} spacing={6} modifiers={[containerBackground(props.background, 'widget'), widgetURL('studenthub://today')]}>
    <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(props.accent)]}>{props.lectureLabel}</Text>
    <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(props.foreground), lineLimit(1)]}>{props.lectureTitle}</Text>
    <Text modifiers={[font({ size: 10 }), foregroundStyle(props.muted), lineLimit(1)]}>{props.lectureWhen}</Text>
    <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(props.accent)]}>{props.examLabel}</Text>
    <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(props.foreground), lineLimit(2)]}>{props.examTitle}</Text>
    <Text modifiers={[font({ size: 10 }), foregroundStyle(props.muted), lineLimit(1)]}>{props.examWhen}</Text>
  </VStack>;
}
export default createWidget('NextUp', Layout, { lectureLabel: 'Next lecture', lectureTitle: 'Open Student Hub', lectureWhen: '', examLabel: 'Next exam', examTitle: 'Open Student Hub', examWhen: '', background: '#EDF2EC', foreground: '#202F29', muted: '#5E6E63', accent: '#176B52', rtl: false });
