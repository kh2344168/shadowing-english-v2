import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { ShadowingRecordingStore } from '../lesson/shadowing/shadowing-recording.store';
import { StudentRecordingsPage } from './recordings.page';

describe('StudentRecordingsPage', () => {
  it('reads only the signed-in student recordings and shows an empty state', async () => {
    const listForStudent = vi.fn().mockResolvedValue([]);
    await TestBed.configureTestingModule({
      imports: [StudentRecordingsPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: {
          session: () => of({ authenticated: true, userId: 'student-b', roles: ['Student'] }),
        } },
        { provide: ShadowingRecordingStore, useValue: { listForStudent } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(StudentRecordingsPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    expect(listForStudent).toHaveBeenCalledExactlyOnceWith('student-b');
    expect(fixture.nativeElement.textContent).toContain('لسه ما عندكش تسجيلات');
  });
});
