import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

interface NavItem { label: string; icon: string; path: string; exact?: boolean; }
interface NavSection { label: string; items: readonly NavItem[]; }

// Visual structure and labels based on V1 AdminLayout. Routes point to V2 page shells.
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLayout {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  mobileNavOpen = false;
  currentSection = 'لوحة الإدارة';
  readonly navSections: readonly NavSection[] = [
    { label: 'الرئيسية', items: [{ label: 'لوحة التحكم', icon: 'dashboard', path: '/admin/dashboard', exact: true }] },
    { label: 'المحتوى', items: [
      { label: 'الدروس', icon: 'play_lesson', path: '/admin/lessons' },
      { label: 'منشئ الدرس', icon: 'edit_note', path: '/admin/lesson-builder' },
      { label: 'معالجة المحتوى', icon: 'auto_awesome', path: '/admin/ai-processing' },
      { label: 'المناهج', icon: 'auto_stories', path: '/admin/curriculums' },
    ] },
    { label: 'الإدارة', items: [
      { label: 'المجموعات', icon: 'group_work', path: '/admin/groups' },
      { label: 'الطلاب', icon: 'school', path: '/admin/students' },
      { label: 'المدرسون', icon: 'person', path: '/admin/teachers' },
      { label: 'المشرفون', icon: 'supervisor_account', path: '/admin/supervisors' },
      { label: 'الأدمنز', icon: 'admin_panel_settings', path: '/admin/accounts' },
      { label: 'الاشتراكات', icon: 'credit_card', path: '/admin/subscriptions' },
    ] },
    { label: 'المتابعة', items: [
      { label: 'الملخصات الأسبوعية', icon: 'date_range', path: '/admin/weekly-summaries' },
      { label: 'التقارير', icon: 'analytics', path: '/admin/reports' },
    ] },
    { label: 'النظام', items: [{ label: 'الإعدادات', icon: 'settings', path: '/admin/settings' }] },
  ];

  constructor() {
    this.syncSectionTitle(this.router.url);
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(event => {
      this.mobileNavOpen = false;
      this.syncSectionTitle(event.urlAfterRedirects);
      this.cdr.markForCheck();
    });
  }
  toggleMobileNav(): void { this.mobileNavOpen = !this.mobileNavOpen; }
  private syncSectionTitle(url: string): void {
    for (const section of this.navSections) {
      const hit = section.items.find(item => url === item.path || url.startsWith(item.path + '/'));
      if (hit) { this.currentSection = hit.label; return; }
    }
    this.currentSection = 'لوحة الإدارة';
  }
}
