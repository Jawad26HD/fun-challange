import type {} from 'react-native-svg';

// SVG forwards className on web, but its shared props omit that field.
declare module 'react-native-svg' {
  interface SvgProps {
    className?: string;
  }
}

export { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
export { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
export { ArrowUpRightIcon } from 'phosphor-react-native/src/icons/ArrowUpRight';
export { ArrowClockwiseIcon } from 'phosphor-react-native/src/icons/ArrowClockwise';
export { BellIcon } from 'phosphor-react-native/src/icons/Bell';
export { BookOpenIcon } from 'phosphor-react-native/src/icons/BookOpen';
export { BooksIcon } from 'phosphor-react-native/src/icons/Books';
export { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
export { CalendarCheckIcon } from 'phosphor-react-native/src/icons/CalendarCheck';
export { CheckIcon } from 'phosphor-react-native/src/icons/Check';
export { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
export { CircleIcon } from 'phosphor-react-native/src/icons/Circle';
export { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
export { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
export { ExamIcon } from 'phosphor-react-native/src/icons/Exam';
export { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';
export { GearSixIcon } from 'phosphor-react-native/src/icons/GearSix';
export { GraduationCapIcon } from 'phosphor-react-native/src/icons/GraduationCap';
export { HouseSimpleIcon } from 'phosphor-react-native/src/icons/HouseSimple';
export { LinkSimpleIcon } from 'phosphor-react-native/src/icons/LinkSimple';
export { ListChecksIcon } from 'phosphor-react-native/src/icons/ListChecks';
export { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
export { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
export { MoonIcon } from 'phosphor-react-native/src/icons/Moon';
export { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
export { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';
export { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
export { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';
export { SunIcon } from 'phosphor-react-native/src/icons/Sun';
export { TranslateIcon } from 'phosphor-react-native/src/icons/Translate';
export { WindowsLogoIcon } from 'phosphor-react-native/src/icons/WindowsLogo';
