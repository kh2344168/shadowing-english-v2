import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AdminStudentDetailsPage } from './student-details.page';

const studentId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const slotId = '44444444-4444-4444-8444-444444444444';

function detail(overrides: Record<string, unknown> = {}) {
  return {
    student: { id: studentId, email: 'student@example.test' },
    activeGroup: {
      membershipId: '55555555-5555-4555-8555-555555555555',
      groupId,
      groupName: 'مجموعة أ',
      startedAtUtc: '2026-10-01T10:00:00Z',
    },
    assignedCurriculum: {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'منهج أ',
      draftRevision: '77777777-7777-4777-8777-777777777777',
    },
    publication: {
      versionId,
      curriculumTemplateId: '66666666-6666-4666-8666-666666666666',
      title: 'منهج أ',
      versionNumber: 2,
      publishedAtUtc: '2026-10-02T10:00:00Z',
      availableAtUtc: '2026-10-02T10:00:00Z',
      sourceDraftRevision: '77777777-7777-4777-8777-777777777777',
      isAvailableNow: true,
    },
    progress: {
      visibleLessons: 1,
      startedLessons: 1,
      completedLessons: 0,
      totalSegments: 4,
      completedSegments: 2,
    },
    lessons: [
      {
        slotId,
        title: 'At the airport',
        weekNumber: 1,
        dayNumber: 2,
        sortOrder: 1,
        totalSegments: 4,
        completedSegments: 2,
        isComplete: false,
        updatedAtUtc: '2026-10-02T12:00:00Z',
      },
    ],
    hasMoreLessons: false,
    ...overrides,
  };
}

describe('AdminStudentDetailsPage', () => {
  let fixture: ComponentFixture<AdminStudentDetailsPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminStudentDetailsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: (key: string) => (key === 'studentId' ? studentId : null) } } },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminStudentDetailsPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function respond(value = detail()): Promise<void> {
    http
      .expectOne((request) =>
        request.url === `/api/admin/groups/students/${studentId}` &&
        request.params.get('lessonPage') === '1' &&
        request.params.get('pageSize') === '20',
      )
      .flush(value);
    http
      .expectOne((request) =>
        request.url === `/api/admin/groups/students/${studentId}/history` &&
        request.params.get('page') === '1',
      )
      .flush({ items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads only read contracts on startup and shows published progress', async () => {
    await respond();
    expect(fixture.nativeElement.textContent).toContain('student@example.test');
    expect(fixture.nativeElement.textContent).toContain('At the airport');
    expect(fixture.nativeElement.textContent).toContain('50%');
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('shows no-group state without implying curriculum access', async () => {
    await respond(
      detail({
        activeGroup: null,
        assignedCurriculum: null,
        publication: null,
        progress: { visibleLessons: 0, startedLessons: 0, completedLessons: 0, totalSegments: 0, completedSegments: 0 },
        lessons: [],
      }),
    );
    expect(fixture.nativeElement.textContent).toContain('الطالب غير مسند إلى مجموعة');
    expect(fixture.nativeElement.textContent).not.toContain('منهج منشور ومتاح');
  });

  it('treats assigned draft without publication as hidden from the student', async () => {
    await respond(detail({ publication: null, progress: { visibleLessons: 0, startedLessons: 0, completedLessons: 0, totalSegments: 0, completedSegments: 0 }, lessons: [] }));
    expect(fixture.nativeElement.textContent).toContain('غير منشور للطالب');
    expect(fixture.nativeElement.textContent).toContain('المسودة أو الإسناد وحدهما لا يظهِران الدروس');
  });

  it('does not show lesson cards when a published version is not available yet', async () => {
    const value = detail();
    await respond({
      ...value,
      publication: { ...value.publication, isAvailableNow: false, availableAtUtc: '2099-01-01T00:00:00Z' },
      progress: { visibleLessons: 0, startedLessons: 0, completedLessons: 0, totalSegments: 0, completedSegments: 0 },
      lessons: [],
    });
    expect(fixture.nativeElement.textContent).toContain('النسخة المنشورة غير متاحة بعد');
    expect(fixture.nativeElement.textContent).not.toContain('At the airport');
  });

  it('marks a newer assigned draft as unpublished change instead of current student content', async () => {
    const value = detail();
    await respond({
      ...value,
      assignedCurriculum: { ...value.assignedCurriculum, draftRevision: '88888888-8888-4888-8888-888888888888' },
    });
    expect(fixture.nativeElement.textContent).toContain('مسودة أو مراجعة أحدث من النسخة المنشورة');
  });

  it('paginates lessons without duplicating existing slots', async () => {
    const first = detail({ hasMoreLessons: true });
    await respond(first);
    const loading = fixture.componentInstance.loadMoreLessons();
    http
      .expectOne((request) =>
        request.url === `/api/admin/groups/students/${studentId}` && request.params.get('lessonPage') === '2',
      )
      .flush({
        ...first,
        lessons: [
          first.lessons[0],
          { ...first.lessons[0], slotId: '99999999-9999-4999-8999-999999999999', title: 'Hotel check-in' },
        ],
        hasMoreLessons: false,
      });
    await loading;
    expect(fixture.componentInstance.detail()?.lessons.map((item) => item.title)).toEqual([
      'At the airport',
      'Hotel check-in',
    ]);
  });
});
