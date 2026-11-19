import type { AcademicEvent, Course, PlannerData, StudyCourse } from '../types';
import { emptyPlanner, localDateInput, toEventISO } from '../lib/planner';

// Stable, valid UUIDs keep demo selections and audit references reproducible.
function demoId(group: number, index: number): string {
  return `${group}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

export function createDemoData(now = new Date()): PlannerData {
  const data = emptyPlanner();
  const timezone = 'Asia/Amman';
  const today = localDateInput(now.toISOString(), timezone);
  const campusMidnight = new Date(`${today}T00:00:00.000Z`);
  const weekday = campusMidnight.getUTCDay();
  const onDay = (offset: number, time: string): string => {
    const calendar = new Date(campusMidnight);
    calendar.setUTCDate(calendar.getUTCDate() + offset);
    return toEventISO(calendar.toISOString().slice(0, 10), time, timezone);
  };
  const meetingDays = (days: number[], showToday = false): number[] =>
    [...new Set(showToday ? [...days, weekday] : days)].sort((a, b) => a - b);
  const courses: Course[] = [
    {
      id: demoId(1, 1),
      code: 'CS201',
      title: 'Database Systems',
      title_ar: 'أنظمة قواعد البيانات',
      instructor: 'Dr. Rana Al-Khatib · د. رنا الخطيب',
      instructor_email: 'rana.alkhatib@example.edu',
      room: 'IT Building · A-203',
      credits: 3,
      meeting_days: meetingDays([0, 2, 4], true),
      start_time: '09:00',
      end_time: '10:00',
    },
    {
      id: demoId(1, 2),
      code: 'CS211',
      title: 'Data Structures',
      title_ar: 'تراكيب البيانات',
      instructor: 'Dr. Huda Al-Zoubi · د. هدى الزعبي',
      instructor_email: 'huda.alzoubi@example.edu',
      room: 'IT Building · B-112',
      credits: 3,
      meeting_days: meetingDays([1, 3], true),
      start_time: '11:00',
      end_time: '12:30',
    },
    {
      id: demoId(1, 3),
      code: 'MATH201',
      title: 'Discrete Mathematics',
      title_ar: 'الرياضيات المتقطعة',
      instructor: 'Dr. Samer Al-Masri · د. سامر المصري',
      instructor_email: 'samer.masri@example.edu',
      room: 'Science Building · S-105',
      credits: 3,
      meeting_days: meetingDays([0, 2, 4]),
      start_time: '13:00',
      end_time: '14:00',
    },
    {
      id: demoId(1, 4),
      code: 'CS231',
      title: 'Computer Networks',
      title_ar: 'شبكات الحاسوب',
      instructor: 'Dr. Omar Al-Nasr · د. عمر النصر',
      instructor_email: 'omar.nasr@example.edu',
      room: 'Engineering Building · Network Lab 2',
      credits: 3,
      meeting_days: meetingDays([1, 3]),
      start_time: '14:30',
      end_time: '16:00',
    },
  ];

  const createdAt = onDay(-14, '09:00');
  const appliedAt = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const pendingAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const previousExamStart = onDay(6, '09:00');
  const newExamStart = onDay(7, '10:30');
  const previousExamLocation = 'Engineering Building · Network Lab 2';
  const newExamLocation = 'IT Building · B-204';
  const event = (
    index: number,
    courseIndex: number,
    title: string,
    title_ar: string,
    kind: AcademicEvent['kind'],
    starts_at: string,
    location: string,
    notes: string,
    overrides: Partial<AcademicEvent> = {},
  ): AcademicEvent => ({
    id: demoId(2, index),
    course_id: courses[courseIndex]!.id,
    title,
    title_ar,
    kind,
    starts_at,
    location,
    notes: `DEMO / بيانات تجريبية - ${notes} This is an illustrative task, not a live university deadline.`,
    status: 'pending',
    source: 'lms',
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  });

  // Intentionally not chronological: every consuming view must use the domain sorter.
  const events: AcademicEvent[] = [
    event(1, 0, 'Database Systems - SQL joins assignment', 'أنظمة قواعد البيانات - واجب ربط الجداول',
      'assignment', onDay(2, '23:59'), 'Demo LMS · CS201',
      'Write inner and left joins for the library schema; submit one SQL file. اكتب استعلامات الربط لمخطط المكتبة.'),
    event(2, 3, 'Computer Networks - midterm exam', 'شبكات الحاسوب - الامتحان النصفي',
      'exam', newExamStart, newExamLocation,
      'Chapters 1-4: TCP/IP, subnetting and routing. The confirmed demo email moved both time and room.',
      { source: 'outlook', updated_at: appliedAt }),
    event(3, 2, 'Discrete Mathematics - relations quiz', 'الرياضيات المتقطعة - اختبار العلاقات',
      'quiz', onDay(3, '11:00'), 'Science Building · S-105',
      'Review equivalence relations and partial orders. No change is confirmed by the pending demo email.'),
    event(4, 1, 'Data Structures - linked lists assignment', 'تراكيب البيانات - واجب القوائم المترابطة',
      'assignment', onDay(-1, '23:59'), 'Demo LMS · CS211',
      'Implement insert, delete and reverse, with tests. This intentionally overdue sample remains pending.'),
    event(5, 1, 'Data Structures - practical exam', 'تراكيب البيانات - الامتحان العملي',
      'exam', onDay(10, '11:00'), 'IT Building · Programming Lab 1',
      'Practice stacks, queues and binary search trees. مدة الامتحان التجريبي ٩٠ دقيقة.'),
    event(6, 3, 'Computer Networks - packet analysis report', 'شبكات الحاسوب - تقرير تحليل الحزم',
      'assignment', onDay(4, '23:59'), 'Demo LMS · CS231',
      'Annotate the provided packet capture and explain the TCP handshake. Do not capture personal traffic.'),
    event(7, 0, 'Database Systems - ER diagram assignment', 'أنظمة قواعد البيانات - واجب مخطط الكيانات',
      'assignment', onDay(-3, '23:59'), 'Demo LMS · CS201',
      'Library entities, keys and cardinalities. Marked completed to demonstrate task history.',
      { status: 'completed', updated_at: onDay(-2, '10:00') }),
  ];

  // An illustrative 132-credit plan, NOT any institution's official curriculum.
  // University 24 + faculty 21 + major 87; completed 48 + current 12 + remaining 72.
  type PlanRow = [string, string, string, StudyCourse['status'], StudyCourse['category']];
  const plan: PlanRow[] = [
    ['AR101', 'Arabic Communication', 'مهارات التواصل باللغة العربية', 'completed', 'university'],
    ['ENG101', 'English Language I', 'اللغة الإنجليزية ١', 'completed', 'university'],
    ['ENG102', 'Academic English', 'اللغة الإنجليزية الأكاديمية', 'completed', 'university'],
    ['UNI101', 'National Education', 'التربية الوطنية', 'completed', 'university'],
    ['UNI102', 'Life Skills', 'المهارات الحياتية', 'completed', 'university'],
    ['UNI103', 'Innovation and Entrepreneurship', 'الابتكار وريادة الأعمال', 'completed', 'university'],
    ['MATH101', 'Calculus I', 'التفاضل والتكامل ١', 'completed', 'faculty'],
    ['MATH102', 'Calculus II', 'التفاضل والتكامل ٢', 'completed', 'faculty'],
    ['PHYS101', 'General Physics', 'الفيزياء العامة', 'completed', 'faculty'],
    ['STAT201', 'Probability and Statistics', 'الاحتمالات والإحصاء', 'completed', 'faculty'],
    ['CS101', 'Programming I', 'البرمجة ١', 'completed', 'major'],
    ['CS102', 'Programming II', 'البرمجة ٢', 'completed', 'major'],
    ['CS103', 'Introduction to Computer Science', 'مقدمة في علم الحاسوب', 'completed', 'major'],
    ['CS111', 'Digital Logic', 'المنطق الرقمي', 'completed', 'major'],
    ['CS121', 'Object-Oriented Programming', 'البرمجة كائنية التوجه', 'completed', 'major'],
    ['CS122', 'Web Development Fundamentals', 'أساسيات تطوير الويب', 'completed', 'major'],
    ...courses.map((course): PlanRow => [
      course.code, course.title, course.title_ar, 'current', course.code.startsWith('MATH') ? 'faculty' : 'major',
    ]),
    ['UNI201', 'Professional Ethics', 'الأخلاقيات المهنية', 'remaining', 'university'],
    ['UNI202', 'Community and Volunteering', 'خدمة المجتمع والعمل التطوعي', 'remaining', 'university'],
    ['MATH202', 'Linear Algebra', 'الجبر الخطي', 'remaining', 'faculty'],
    ['MATH301', 'Numerical Methods', 'الطرق العددية', 'remaining', 'faculty'],
    ['CS202', 'Advanced Database Systems', 'أنظمة قواعد البيانات المتقدمة', 'remaining', 'major'],
    ['CS212', 'Design and Analysis of Algorithms', 'تصميم الخوارزميات وتحليلها', 'remaining', 'major'],
    ['CS221', 'Computer Architecture', 'معمارية الحاسوب', 'remaining', 'major'],
    ['CS232', 'Network Security', 'أمن الشبكات', 'remaining', 'major'],
    ['CS241', 'Operating Systems', 'أنظمة التشغيل', 'remaining', 'major'],
    ['CS251', 'Software Engineering', 'هندسة البرمجيات', 'remaining', 'major'],
    ['CS252', 'Software Requirements', 'متطلبات البرمجيات', 'remaining', 'major'],
    ['CS261', 'Artificial Intelligence', 'الذكاء الاصطناعي', 'remaining', 'major'],
    ['CS262', 'Machine Learning', 'تعلم الآلة', 'remaining', 'major'],
    ['CS271', 'Theory of Computation', 'نظرية الحوسبة', 'remaining', 'major'],
    ['CS272', 'Compiler Design', 'تصميم المترجمات', 'remaining', 'major'],
    ['CS281', 'Human-Computer Interaction', 'التفاعل بين الإنسان والحاسوب', 'remaining', 'major'],
    ['CS282', 'Mobile Application Development', 'تطوير تطبيقات الأجهزة المحمولة', 'remaining', 'major'],
    ['CS301', 'Distributed Systems', 'الأنظمة الموزعة', 'remaining', 'major'],
    ['CS302', 'Cloud Computing', 'الحوسبة السحابية', 'remaining', 'major'],
    ['CS311', 'Information Security', 'أمن المعلومات', 'remaining', 'major'],
    ['CS321', 'Web Applications', 'تطبيقات الويب', 'remaining', 'major'],
    ['CS391', 'Field Training', 'التدريب الميداني', 'remaining', 'major'],
    ['CS401', 'Graduation Project I', 'مشروع التخرج ١', 'remaining', 'major'],
    ['CS402', 'Graduation Project II', 'مشروع التخرج ٢', 'remaining', 'major'],
  ];
  const study_courses: StudyCourse[] = plan.map(([code, title, title_ar, status, category], index) => ({
    id: demoId(3, index + 1), code, title, title_ar, credits: 3, status, category,
  }));
  const year = campusMidnight.getUTCFullYear();
  const month = campusMidnight.getUTCMonth() + 1;
  const academicYear = month >= 9 ? year : year - 1;
  const semester = month >= 9 || month === 1 ? 'First semester' : month <= 6 ? 'Second semester' : 'Summer semester';

  return {
    ...data,
    courses,
    events,
    study_courses,
    settings: {
      ...data.settings,
      display_name: 'Layan Haddad · Demo / ليان حداد · تجريبي',
      program: 'Computer Science · Sample plan, not official / خطة تجريبية غير رسمية',
      required_credits: 132,
      semester: `${semester} ${academicYear}/${String(academicYear + 1).slice(-2)} · Demo`,
      timezone,
      approved_senders: courses.map((course) => course.instructor_email),
      outlook_auto_apply: false,
    },
    alerts: [
      {
        id: demoId(4, 1),
        event_id: demoId(2, 1),
        kind: 'assignment',
        title: 'Demo reminder · Database Systems / تذكير تجريبي',
        body: 'Your SQL joins assignment is due in two campus days. واجب ربط الجداول بعد يومين. Sample reminder only.',
        created_at: pendingAt,
        seen_at: null,
      },
      {
        id: demoId(4, 2),
        event_id: demoId(2, 2),
        kind: 'update',
        title: 'Demo schedule change · Computer Networks / تغيير تجريبي',
        body: 'The confirmed midterm time and room were updated in this demo. تم تعديل وقت الامتحان وقاعته في البيانات التجريبية.',
        created_at: appliedAt,
        seen_at: pendingAt,
      },
    ],
    updates: [
      {
        id: demoId(5, 1),
        event_id: demoId(2, 2),
        message_id: demoId(6, 1),
        sender: 'omar.nasr@example.edu',
        subject: '[DEMO] CS231 Computer Networks midterm - confirmed time and room',
        excerpt: `For CS231, the midterm is now on ${localDateInput(newExamStart, timezone)} at 10:30 (Asia/Amman), in ${newExamLocation}, instead of ${localDateInput(previousExamStart, timezone)} at 09:00 in ${previousExamLocation}. تأكيد تغيير موعد الامتحان وقاعته. This is a fictional Outlook message.`,
        received_at: appliedAt,
        previous_start: previousExamStart,
        new_start: newExamStart,
        previous_location: previousExamLocation,
        new_location: newExamLocation,
        status: 'applied',
        reason: 'Demo audit: an approved sample sender named CS231 and the exact exam, with an explicit replacement time and room. Applied in the sample only; no Outlook connection is active.',
        source_url: null,
      },
      {
        id: demoId(5, 2),
        event_id: null,
        message_id: demoId(6, 2),
        sender: 'samer.masri@example.edu',
        subject: '[DEMO] Discrete Mathematics quiz - possible timetable adjustment',
        excerpt: 'We may move an upcoming quiz to another session. I will confirm the date and room once a room is available. قد يتغير موعد أحد الاختبارات؛ سأؤكد الموعد والقاعة لاحقاً. This is a fictional Outlook message.',
        received_at: pendingAt,
        previous_start: null,
        new_start: null,
        previous_location: null,
        new_location: null,
        status: 'pending',
        reason: 'Needs manual review: no unique event, confirmed date, time, or room. This ambiguous sample must not be automatically applied. لم يتم تغيير أي موعد.',
        source_url: null,
      },
    ],
  };
}
