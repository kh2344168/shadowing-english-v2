import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminStudentsPage } from './students.page';

describe('AdminStudentsPage', () => {
  let fixture: ComponentFixture<AdminStudentsPage>;
  let http: HttpTestingController;
  const group = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'مجموعة أ',
    currentVersionId: '44444444-4444-4444-8444-444444444444',
  };
  const studentId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminStudentsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminStudentsPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function initial(activeGroup: object | null = null): Promise<void> {
    http
      .expectOne((request) => request.url === '/api/admin/groups' && request.method === 'GET')
      .flush({ items: [group], hasMore: false });
    http
      .expectOne(
        (request) => request.url === '/api/admin/groups/students' && request.method === 'GET',
      )
      .flush({
        items: [{ id: studentId, email: 'student@example.test', activeGroup }],
        hasMore: false,
      });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads real students and groups without a write on startup', async () => {
    await initial();
    expect(fixture.nativeElement.textContent).toContain('student@example.test');
    expect(fixture.nativeElement.textContent).toContain('بدون مجموعة');
    expect(fixture.nativeElement.querySelector('.details-link')?.getAttribute('href')).toBe(
      `/admin/students/${studentId}`,
    );
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('loads only the first group page on startup and fetches more on demand', async () => {
    http
      .expectOne((request) => request.url === '/api/admin/groups' && request.method === 'GET')
      .flush({ items: [group], hasMore: true });
    http
      .expectOne((request) => request.url === '/api/admin/groups/students' && request.method === 'GET')
      .flush({ items: [{ id: studentId, email: 'student@example.test', activeGroup: null }], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.moreGroups()).toBe(true);
    expect(http.match((request) => request.url === '/api/admin/groups')).toHaveLength(0);

    (fixture.nativeElement.querySelector('.groups-pager button') as HTMLButtonElement).click();
    const next = http.expectOne(
      (request) => request.url === '/api/admin/groups' && request.params.get('page') === '2',
    );
    expect(next.request.params.get('pageSize')).toBe('50');
    next.flush({ items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.groupsPage()).toBe(2);
    expect(fixture.componentInstance.moreGroups()).toBe(false);
  });

  it('does not claim draft assignment is published content', async () => {
    const assignedOnly = { ...group, currentVersionId: null, assignedCurriculumTemplateId: 'draft-id' };
    http
      .expectOne((request) => request.url === '/api/admin/groups' && request.method === 'GET')
      .flush({ items: [assignedOnly], hasMore: false });
    http
      .expectOne((request) => request.url === '/api/admin/groups/students')
      .flush({
        items: [
          {
            id: studentId,
            email: 'student@example.test',
            activeGroup: {
              membershipId: '33333333-3333-4333-8333-333333333333',
              groupId: group.id,
              groupName: group.name,
              startedAtUtc: '2026-10-01T10:00:00Z',
            },
          },
        ],
        hasMore: false,
      });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('مسودة فقط');
    expect(fixture.nativeElement.textContent).not.toContain('يرى المنهج');
  });

  it('creates a student only after CSRF and never sends the password in a URL', async () => {
    await initial();
    const page = fixture.componentInstance;
    page.email = 'new.student@example.test';
    page.password = 'Synthetic!123';
    const creating = page.createStudent();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const request = http.expectOne(
      (item) => item.url === '/api/admin/groups/students' && item.method === 'POST',
    );
    expect(request.request.body).toEqual({
      email: 'new.student@example.test',
      password: 'Synthetic!123',
    });
    expect(request.request.url).not.toContain('Synthetic!123');
    request.flush({ id: studentId, email: 'new.student@example.test' }, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    http
      .expectOne(
        (item) =>
          item.url === '/api/admin/groups/students' &&
          item.params.get('query') === 'new.student@example.test',
      )
      .flush({ items: [{ id: studentId, email: 'new.student@example.test', activeGroup: null }], hasMore: false });
    await creating;
    expect(page.password).toBe('');
  });

  it('requires explicit confirmation before moving a student and sends the expected membership', async () => {
    await initial();
    const page = fixture.componentInstance;
    const student = page.students()[0];
    page.setTarget(student.id, group.id);
    await page.applyMove(student);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
    page.confirmMoveId.set(student.id);
    const moving = page.applyMove(student);
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const request = http.expectOne(`/api/admin/groups/students/${student.id}/membership`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ groupId: group.id, expectedMembershipId: null });
    request.flush({ membershipId: '33333333-3333-4333-8333-333333333333', groupId: group.id });
    await Promise.resolve();
    http
      .expectOne((item) => item.url === '/api/admin/groups/students' && item.method === 'GET')
      .flush({ items: [{ ...student, activeGroup: null }], hasMore: false });
    await moving;
  });

  it('loads membership history separately and paginates it', async () => {
    await initial();
    const loading = fixture.componentInstance.loadHistory(studentId, 1);
    http
      .expectOne((request) =>
        request.url === `/api/admin/groups/students/${studentId}/history` &&
        request.params.get('page') === '1' && request.params.get('pageSize') === '20',
      )
      .flush({
        items: [
          {
            membershipId: '33333333-3333-4333-8333-333333333333',
            groupId: group.id,
            groupName: group.name,
            startedAtUtc: '2026-09-01T10:00:00Z',
            endedAtUtc: '2026-09-10T10:00:00Z',
          },
        ],
        hasMore: false,
      });
    await loading;
    expect(fixture.componentInstance.history()[0].groupName).toBe(group.name);
  });
});
