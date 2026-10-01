import { Routes } from '@angular/router';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'admin',
    canActivateChild: [roleGuard('Admin')],
    loadComponent: () =>
      import('./shared/layouts/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/admin/dashboard/admin-dashboard.page').then(
            (m) => m.AdminDashboardPage,
          ),
      },
      {
        path: 'accounts',
        loadComponent: () =>
          import('./features/admin/accounts/admin-accounts.page').then((m) => m.AdminAccountsPage),
      },
      {
        path: 'lessons',
        loadComponent: () =>
          import('./features/admin/lessons/lessons.page').then((m) => m.AdminLessonsPage),
      },
      {
        path: 'lesson-builder',
        loadComponent: () =>
          import('./features/admin/lesson-builder/lesson-builder.page').then(
            (m) => m.AdminLessonBuilderPage,
          ),
      },
      {
        path: 'ai-processing',
        loadComponent: () =>
          import('./features/admin/ai-processing/ai-processing.page').then(
            (m) => m.AdminAIProcessingPage,
          ),
      },
      {
        path: 'ai-tools',
        loadComponent: () =>
          import('./features/admin/ai-tools/ai-tools.page').then((m) => m.AdminAIToolsPage),
      },
      {
        path: 'curriculums',
        loadComponent: () =>
          import('./features/admin/curriculums/curriculums.page').then(
            (m) => m.AdminCurriculumsPage,
          ),
      },
      {
        path: 'groups',
        loadComponent: () =>
          import('./features/admin/groups/groups.page').then((m) => m.AdminGroupsPage),
      },
      {
        path: 'students',
        loadComponent: () =>
          import('./features/admin/students/students.page').then((m) => m.AdminStudentsPage),
      },
      {
        path: 'teachers',
        loadComponent: () =>
          import('./features/admin/teachers/teachers.page').then((m) => m.AdminTeachersPage),
      },
      {
        path: 'supervisors',
        loadComponent: () =>
          import('./features/admin/supervisors/supervisors.page').then(
            (m) => m.AdminSupervisorsPage,
          ),
      },
      {
        path: 'subscriptions',
        loadComponent: () =>
          import('./features/admin/subscriptions/subscriptions.page').then(
            (m) => m.AdminSubscriptionsPage,
          ),
      },
      {
        path: 'weekly-summaries',
        loadComponent: () =>
          import('./features/admin/weekly-summaries/weekly-summaries.page').then(
            (m) => m.AdminWeeklySummariesPage,
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/admin/reports/reports.page').then((m) => m.AdminReportsPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/admin/settings/settings.page').then((m) => m.AdminSettingsPage),
      },
    ],
  },
  {
    path: 'student',
    canActivateChild: [roleGuard('Student')],
    loadComponent: () =>
      import('./shared/layouts/student-layout/student-layout').then((m) => m.StudentLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/student/dashboard/student-dashboard.page').then(
            (m) => m.StudentDashboardPage,
          ),
      },
      {
        path: 'curriculum',
        loadComponent: () =>
          import('./features/student/curriculum/curriculum.page').then(
            (m) => m.StudentCurriculumPage,
          ),
      },
      {
        path: 'lessons/:slotId/overview',
        loadComponent: () =>
          import('./features/student/lesson/overview/overview.page').then(
            (m) => m.StudentLessonOverviewPage,
          ),
      },
      {
        path: 'lessons/:slotId/shadowing',
        loadComponent: () =>
          import('./features/student/lesson/shadowing/shadowing.page').then(
            (m) => m.StudentShadowingPage,
          ),
      },
      {
        path: 'lessons/:slotId/vocabulary',
        loadComponent: () =>
          import('./features/student/lesson/vocabulary/vocabulary.page').then(
            (m) => m.StudentVocabularyPage,
          ),
      },
      {
        path: 'lessons/:slotId/listen-type',
        loadComponent: () =>
          import('./features/student/lesson/listen-type/listen-type.page').then(
            (m) => m.StudentListenTypePage,
          ),
      },
      {
        path: 'lessons/:slotId/quiz',
        loadComponent: () =>
          import('./features/student/lesson/quiz/quiz.page').then((m) => m.StudentQuizPage),
      },
      {
        path: 'lessons/:slotId/conversation',
        loadComponent: () =>
          import('./features/student/lesson/conversation/conversation.page').then(
            (m) => m.StudentConversationPage,
          ),
      },
      {
        path: 'progress',
        loadComponent: () =>
          import('./features/student/progress/progress.page').then((m) => m.StudentProgressPage),
      },
      {
        path: 'recordings',
        loadComponent: () =>
          import('./features/student/recordings/recordings.page').then(
            (m) => m.StudentRecordingsPage,
          ),
      },
      {
        path: 'knowledge-bank',
        loadComponent: () =>
          import('./features/student/knowledge-bank/knowledge-bank.page').then(
            (m) => m.StudentKnowledgeBankPage,
          ),
      },
      {
        path: 'messages',
        loadComponent: () =>
          import('./features/student/messages/messages.page').then((m) => m.StudentMessagesPage),
      },
    ],
  },
  {
    path: 'teacher',
    canActivateChild: [roleGuard('Teacher')],
    loadComponent: () =>
      import('./shared/layouts/teacher-layout/teacher-layout').then((m) => m.TeacherLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/teacher/dashboard/dashboard.page').then((m) => m.TeacherDashboardPage),
      },
      {
        path: 'students',
        loadComponent: () =>
          import('./features/teacher/students/students.page').then((m) => m.TeacherStudentsPage),
      },
      {
        path: 'progress',
        loadComponent: () =>
          import('./features/teacher/progress/progress.page').then((m) => m.TeacherProgressPage),
      },
      {
        path: 'recordings',
        loadComponent: () =>
          import('./features/teacher/recordings/recordings.page').then(
            (m) => m.TeacherRecordingsPage,
          ),
      },
      {
        path: 'feedback',
        loadComponent: () =>
          import('./features/teacher/feedback/feedback.page').then((m) => m.TeacherFeedbackPage),
      },
      {
        path: 'messages',
        loadComponent: () =>
          import('./features/teacher/messages/messages.page').then((m) => m.TeacherMessagesPage),
      },
    ],
  },
  {
    path: 'supervisor',
    canActivateChild: [roleGuard('Supervisor')],
    loadComponent: () =>
      import('./shared/layouts/supervisor-layout/supervisor-layout').then(
        (m) => m.SupervisorLayout,
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/supervisor/dashboard/dashboard.page').then(
            (m) => m.SupervisorDashboardPage,
          ),
      },
      {
        path: 'students',
        loadComponent: () =>
          import('./features/supervisor/students/students.page').then(
            (m) => m.SupervisorStudentsPage,
          ),
      },
      {
        path: 'teachers',
        loadComponent: () =>
          import('./features/supervisor/teachers/teachers.page').then(
            (m) => m.SupervisorTeachersPage,
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/supervisor/reports/reports.page').then((m) => m.SupervisorReportsPage),
      },
      {
        path: 'weekly-summary',
        loadComponent: () =>
          import('./features/supervisor/weekly-summary/weekly-summary.page').then(
            (m) => m.SupervisorWeeklySummaryPage,
          ),
      },
      {
        path: 'messages',
        loadComponent: () =>
          import('./features/supervisor/messages/messages.page').then(
            (m) => m.SupervisorMessagesPage,
          ),
      },
    ],
  },
  {
    path: 'logout',
    loadComponent: () =>
      import('./features/auth/pages/logout/logout.page').then((m) => m.LogoutPage),
  },
  { path: '**', redirectTo: 'login' },
];
