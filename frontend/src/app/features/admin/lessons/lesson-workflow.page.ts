import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  LessonStageType,
  LessonWorkflow,
  LessonWorkflowApi,
  LessonWorkflowStage,
} from './lesson-workflow.api';

interface StageDefinition {
  type: LessonStageType;
  title: string;
  description: string;
  icon: string;
  color: string;
}

const STAGE_LIBRARY: readonly StageDefinition[] = [
  {
    type: 'shadowing',
    title: 'Shadowing',
    description: 'تدريب الاستماع والترديد على جمل الدرس.',
    icon: 'graphic_eq',
    color: 'teal',
  },
  {
    type: 'vocabulary',
    title: 'الكلمات والـ Chunks',
    description: 'الكلمات والعبارات ومعانيها وأمثلتها.',
    icon: 'translate',
    color: 'blue',
  },
  {
    type: 'listen-type',
    title: 'اسمع واكتب',
    description: 'اختيار الجمل والإجابات المقبولة والتلميحات.',
    icon: 'headphones',
    color: 'violet',
  },
  {
    type: 'grammar',
    title: 'قواعد الدرس',
    description: 'قاعدة مستهدفة وشرح وأمثلة مرتبطة بالدرس.',
    icon: 'menu_book',
    color: 'amber',
  },
  {
    type: 'vocabulary-quiz',
    title: 'اختبار الكلمات',
    description: 'أسئلة مخصصة للكلمات والعبارات المختارة.',
    icon: 'quiz',
    color: 'rose',
  },
  {
    type: 'grammar-quiz',
    title: 'اختبار القواعد',
    description: 'تطبيقات وأسئلة على قاعدة الدرس.',
    icon: 'fact_check',
    color: 'orange',
  },
  {
    type: 'word-order',
    title: 'ترتيب الجمل',
    description: 'إعادة ترتيب كلمات جمل مختارة من الدرس.',
    icon: 'reorder',
    color: 'cyan',
  },
  {
    type: 'conversation',
    title: 'محادثة الدرس',
    description: 'سيناريو وأدوار وأهداف للمحادثة التفاعلية.',
    icon: 'forum',
    color: 'indigo',
  },
];

@Component({
  selector: 'app-admin-lesson-workflow',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './lesson-workflow.page.html',
  styleUrl: './lesson-workflow.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonWorkflowPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(LessonWorkflowApi);
  private readonly auth = inject(AuthService);
  @Input() embeddedVersionId: string | null = null;
  @Input() embedded = false;
  private readonly routeVersionId = this.route.snapshot.paramMap.get('versionId') ?? '';
  readonly workflow = signal<LessonWorkflow | null>(null);
  readonly stages = signal<LessonWorkflowStage[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly libraryOpen = signal(false);
  readonly library = STAGE_LIBRARY;
  readonly enabledCount = computed(() => this.stages().filter((stage) => stage.enabled).length);

  get versionId(): string {
    return this.embeddedVersionId || this.routeVersionId;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.versionId) return;
    const started = performance.now();
    console.info('[Admin.LessonWorkflow.Load.Start]', { versionId: this.versionId });
    this.loading.set(true);
    this.error.set('');
    try {
      const workflow = await firstValueFrom(this.api.get(this.versionId));
      this.workflow.set(workflow);
      this.stages.set([...workflow.stages].sort((a, b) => a.position - b.position));
      this.dirty.set(false);
      console.info('[Admin.LessonWorkflow.Load.Success]', {
        versionId: this.versionId,
        stageCount: workflow.stages.length,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      this.error.set('تعذر تحميل رحلة الدرس. تأكد من تشغيل الـAPI ثم حاول مرة أخرى.');
      console.warn('[Admin.LessonWorkflow.Load.Failed]', {
        versionId: this.versionId,
        status: (error as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.loading.set(false);
    }
  }

  definition(type: LessonStageType): StageDefinition {
    return STAGE_LIBRARY.find((item) => item.type === type) ?? STAGE_LIBRARY[0];
  }

  isCore(stage: LessonWorkflowStage): boolean {
    return this.stages()[0]?.id === stage.id && stage.type === 'shadowing';
  }

  status(stage: LessonWorkflowStage): { label: string; tone: string; icon: string } {
    if (!stage.enabled) return { label: 'غير مفعّلة', tone: 'off', icon: 'toggle_off' };
    if (stage.type === 'shadowing')
      return { label: 'النص والصوت', tone: 'done', icon: 'graphic_eq' };
    const workflow = this.workflow();
    if (!workflow?.aiStatus) return { label: 'جاهزة للبدء', tone: 'ready', icon: 'play_circle' };
    if (workflow.aiStatus === 'Pending' || workflow.aiStatus === 'Generating')
      return { label: 'قيد المعالجة', tone: 'working', icon: 'hourglass_top' };
    if (workflow.aiStatus === 'Failed')
      return { label: 'تحتاج إعادة محاولة', tone: 'error', icon: 'error' };
    if (workflow.aiStatus === 'Approved')
      return { label: 'معتمدة', tone: 'done', icon: 'verified' };
    const reviewKey = this.reviewKey(stage.type);
    return reviewKey && workflow.reviewedStages.includes(reviewKey)
      ? { label: 'تمت مراجعتها', tone: 'done', icon: 'check_circle' }
      : { label: 'تحتاج مراجعة', tone: 'review', icon: 'rate_review' };
  }

  toggle(stage: LessonWorkflowStage, enabled: boolean): void {
    if (this.isCore(stage)) return;
    this.update(stage.id, { enabled });
  }

  toggleRequired(stage: LessonWorkflowStage, required: boolean): void {
    if (this.isCore(stage)) return;
    this.update(stage.id, { required });
  }

  rename(stage: LessonWorkflowStage, title: string): void {
    const value = title.trim();
    if (!value || value === stage.title) return;
    this.update(stage.id, { title: value.slice(0, 80) });
  }

  move(stage: LessonWorkflowStage, direction: -1 | 1): void {
    const items = [...this.stages()];
    const index = items.findIndex((item) => item.id === stage.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length || this.isCore(stage) || target === 0)
      return;
    [items[index], items[target]] = [items[target], items[index]];
    this.setStages(items);
  }

  duplicate(stage: LessonWorkflowStage): void {
    if (this.stages().length >= 24) return;
    const items = [...this.stages()];
    const index = items.findIndex((item) => item.id === stage.id);
    items.splice(index + 1, 0, {
      ...stage,
      id: crypto.randomUUID(),
      title: `${stage.title} إضافي`,
      required: false,
    });
    this.setStages(items);
  }

  remove(stage: LessonWorkflowStage): void {
    if (this.isCore(stage)) return;
    this.setStages(this.stages().filter((item) => item.id !== stage.id));
  }

  add(definition: StageDefinition): void {
    if (this.stages().length >= 24) return;
    this.setStages([
      ...this.stages(),
      {
        id: crypto.randomUUID(),
        type: definition.type,
        title: definition.title,
        position: this.stages().length + 1,
        enabled: true,
        required: false,
      },
    ]);
    this.libraryOpen.set(false);
  }

  async open(stage: LessonWorkflowStage): Promise<void> {
    if (!stage.enabled) return;
    if (this.dirty() && !(await this.save())) return;
    if (stage.type === 'shadowing') {
      await this.router.navigate([
        '/admin/lessons',
        this.versionId,
        'workflow',
        stage.id,
        'content',
      ]);
      return;
    }
    await this.router.navigate(['/admin/lessons', this.versionId, 'workflow', stage.id]);
  }

  async save(): Promise<boolean> {
    const workflow = this.workflow();
    if (!workflow || this.saving() || !this.dirty()) return !!workflow;
    const started = performance.now();
    console.info('[Admin.LessonWorkflow.Save.Start]', {
      versionId: this.versionId,
      stageCount: this.stages().length,
    });
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(
        this.api.save(this.versionId, workflow.revision, this.stages()),
      );
      this.workflow.set({ ...workflow, revision: result.revision, stages: result.stages });
      this.stages.set(result.stages);
      this.dirty.set(false);
      this.notice.set('تم حفظ ترتيب ومراحل رحلة الدرس.');
      console.info('[Admin.LessonWorkflow.Save.Success]', {
        versionId: this.versionId,
        stageCount: result.stages.length,
        durationMs: Math.round(performance.now() - started),
      });
      return true;
    } catch (error) {
      this.error.set(
        (error as { status?: number }).status === 409
          ? 'تغيرت الرحلة من نافذة أخرى. أعد تحميل الصفحة قبل الحفظ.'
          : 'تعذر حفظ رحلة الدرس. لم نفقد التعديلات الموجودة أمامك.',
      );
      console.warn('[Admin.LessonWorkflow.Save.Failed]', {
        versionId: this.versionId,
        status: (error as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private update(id: string, patch: Partial<LessonWorkflowStage>): void {
    this.setStages(
      this.stages().map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)),
    );
  }

  private setStages(stages: LessonWorkflowStage[]): void {
    this.stages.set(stages.map((stage, index) => ({ ...stage, position: index + 1 })));
    this.dirty.set(true);
    this.notice.set('');
  }

  private reviewKey(type: LessonStageType): string | null {
    if (type === 'vocabulary') return 'vocabulary';
    if (type === 'listen-type') return 'listen-type';
    if (type === 'grammar' || type.endsWith('quiz') || type === 'word-order') return type;
    if (type === 'conversation') return 'conversation';
    return null;
  }
}
