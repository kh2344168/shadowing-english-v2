import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminGroupsPage } from './groups.page';

describe('AdminGroupsPage', () => {
  let fixture: ComponentFixture<AdminGroupsPage>;
  let http: HttpTestingController;
  const group = { id: '22222222-2222-4222-8222-222222222222', name: 'مجموعة أ' };
  const studentId = '11111111-1111-4111-8111-111111111111';
  const membershipId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminGroupsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminGroupsPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function loadInitial(activeGroup: object | null = null): Promise<void> {
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

  it('reads groups and student membership without writing during page load', async () => {
    await loadInitial();
    expect(fixture.nativeElement.textContent).toContain('مجموعة أ');
    expect(fixture.nativeElement.textContent).toContain('بدون مجموعة');
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('links each group card to curriculum management without changing membership', async () => {
    await loadInitial();
    const link = fixture.nativeElement.querySelector(
      'a[href^="/admin/curriculums"]',
    ) as HTMLAnchorElement;
    expect(link.textContent).toContain('إدارة المنهج');
    expect(link.getAttribute('href')).toBe(`/admin/curriculums?groupId=${group.id}`);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('filters the loaded groups without writing or hiding the student controls', async () => {
    await loadInitial();
    const input = fixture.nativeElement.querySelector('#group-search') as HTMLInputElement;
    input.value = 'غير موجودة';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('لا توجد مجموعات مطابقة');
    expect(fixture.nativeElement.textContent).toContain('student@example.test');
    input.value = 'مجموعة';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('مجموعة أ');
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('opens and cancels the create dialog without creating a group', async () => {
    await loadInitial();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const openButton = buttons.find((button) => button.textContent?.includes('إنشاء مجموعة'));
    expect(openButton).toBeTruthy();
    openButton!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form[role="dialog"]')).toBeTruthy();
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);

    (
      fixture.nativeElement.querySelector('button[aria-label="إغلاق"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form[role="dialog"]')).toBeNull();
  });

  it('requests CSRF and sends the expected membership when the admin confirms a move', async () => {
    await loadInitial();
    const page = fixture.componentInstance;
    page.setTarget(studentId, group.id);
    page.confirmMoveId.set(studentId);
    const moving = page.applyMove(studentId);
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const moveRequest = http.expectOne(
      (request) => request.url === `/api/admin/groups/students/${studentId}/membership`,
    );
    expect(moveRequest.request.method).toBe('PUT');
    expect(moveRequest.request.body).toEqual({ groupId: group.id, expectedMembershipId: null });
    moveRequest.flush({ membershipId, groupId: group.id });
    await Promise.resolve();
    http
      .expectOne(
        (request) => request.url === '/api/admin/groups/students' && request.method === 'GET',
      )
      .flush({
        items: [
          {
            id: studentId,
            email: 'student@example.test',
            activeGroup: {
              membershipId,
              groupId: group.id,
              groupName: group.name,
              startedAtUtc: '2026-09-28T15:00:00Z',
            },
          },
        ],
        hasMore: false,
      });
    await moving;
    expect(page.students()[0].activeGroup?.membershipId).toBe(membershipId);
  });

  it('reloads the student on a concurrent membership conflict without claiming success', async () => {
    await loadInitial({
      membershipId,
      groupId: group.id,
      groupName: group.name,
      startedAtUtc: '2026-09-28T15:00:00Z',
    });
    const page = fixture.componentInstance;
    page.setTarget(studentId, '');
    page.confirmMoveId.set(studentId);
    const moving = page.applyMove(studentId);
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const moveRequest = http.expectOne(
      (request) => request.url === `/api/admin/groups/students/${studentId}/membership`,
    );
    expect(moveRequest.request.body).toEqual({ groupId: null, expectedMembershipId: membershipId });
    moveRequest.flush({ error: 'membership_changed' }, { status: 409, statusText: 'Conflict' });
    await Promise.resolve();
    http
      .expectOne(
        (request) => request.url === '/api/admin/groups/students' && request.method === 'GET',
      )
      .flush({
        items: [{ id: studentId, email: 'student@example.test', activeGroup: null }],
        hasMore: false,
      });
    await moving;
    expect(page.error()).toContain('تغيّرت');
    expect(page.success()).toBe('');
    expect(page.students()[0].activeGroup).toBeNull();
  });

  it('ignores an older student search response after a newer search finishes', async () => {
    await loadInitial();
    const page = fixture.componentInstance;
    page.searchQuery = 'old';
    page.searchStudents();
    const older = http.expectOne(
      (request) =>
        request.url === '/api/admin/groups/students' && request.params.get('query') === 'old',
    );
    page.searchQuery = 'new';
    page.searchStudents();
    http
      .expectOne(
        (request) =>
          request.url === '/api/admin/groups/students' && request.params.get('query') === 'new',
      )
      .flush({
        items: [{ id: studentId, email: 'new@example.test', activeGroup: null }],
        hasMore: false,
      });
    older.flush({
      items: [{ id: studentId, email: 'old@example.test', activeGroup: null }],
      hasMore: false,
    });
    await fixture.whenStable();
    expect(page.students()[0].email).toBe('new@example.test');
  });

  it('reuses the group creation request ID after a lost response', async () => {
    await loadInitial();
    const page = fixture.componentInstance;
    page.groupName = 'مجموعة جديدة';
    const first = page.createGroup();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const failedCreate = http.expectOne(
      (request) => request.url === '/api/admin/groups' && request.method === 'POST',
    );
    const requestId = failedCreate.request.body.requestId;
    expect(requestId).toBeTruthy();
    failedCreate.flush({}, { status: 0, statusText: 'Network Error' });
    await first;

    const retry = page.createGroup();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const secondCreate = http.expectOne(
      (request) => request.url === '/api/admin/groups' && request.method === 'POST',
    );
    expect(secondCreate.request.body).toEqual({ name: 'مجموعة جديدة', requestId });
    secondCreate.flush({ id: group.id, name: 'مجموعة جديدة' });
    await Promise.resolve();
    http
      .expectOne((request) => request.url === '/api/admin/groups' && request.method === 'GET')
      .flush({ items: [{ id: group.id, name: 'مجموعة جديدة' }], hasMore: false });
    await retry;
    expect(page.success()).toContain('تم إنشاء');
  });

  it('summarizes publication state without equating assignment with student visibility', async () => {
    http
      .expectOne((request) => request.url === '/api/admin/groups' && request.method === 'GET')
      .flush({
        items: [
          { ...group, assignedCurriculumTemplateId: 'draft-only', assignedCurriculumName: 'منهج مسودة' },
          {
            id: '55555555-5555-4555-8555-555555555555',
            name: 'مجموعة منشورة',
            assignedCurriculumTemplateId: 'published',
            publishedCurriculumTemplateId: 'published',
            draftRevision: 'rev-1',
            publishedDraftRevision: 'rev-1',
            currentVersionId: '66666666-6666-4666-8666-666666666666',
          },
        ],
        hasMore: false,
      });
    http
      .expectOne((request) => request.url === '/api/admin/groups/students' && request.method === 'GET')
      .flush({ items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.assignedDraftOnlyCount()).toBe(1);
    expect(fixture.componentInstance.publishedGroupsCount()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('مسند ولم يُنشر بعد');
    expect(fixture.nativeElement.textContent).toContain('الإتاحة النهائية للدروس يحددها Student API');
  });

  it('de-duplicates overlapping group pages', async () => {
    await loadInitial();
    const loading = fixture.componentInstance.loadGroups(2);
    http
      .expectOne((request) => request.url === '/api/admin/groups' && request.params.get('page') === '2')
      .flush({ items: [group, { id: '77777777-7777-4777-8777-777777777777', name: 'مجموعة ب' }], hasMore: false });
    await loading;
    expect(fixture.componentInstance.groups().map((item) => item.id)).toEqual([
      group.id,
      '77777777-7777-4777-8777-777777777777',
    ]);
  });

});
