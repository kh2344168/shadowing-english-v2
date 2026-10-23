import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { StudentLayout } from './student-layout';

describe('StudentLayout', () => {
  it('hides the mobile navigation only while a lesson conversation is open', () => {
    const events = new Subject<NavigationStart | NavigationEnd>();
    const router = { url: '/student/lessons/slot-1/overview', events };
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
    const layout = TestBed.runInInjectionContext(() => new StudentLayout());

    expect(layout.conversationOpen()).toBe(false);
    events.next(new NavigationStart(1, '/student/lessons/slot-1/conversation'));
    expect(layout.conversationOpen()).toBe(false);
    events.next(
      new NavigationEnd(
        1,
        '/student/lessons/slot-1/conversation',
        '/student/lessons/slot-1/conversation?stageId=123',
      ),
    );
    expect(layout.conversationOpen()).toBe(true);
    events.next(
      new NavigationEnd(2, '/student/lessons/slot-1/overview', '/student/lessons/slot-1/overview'),
    );
    expect(layout.conversationOpen()).toBe(false);
  });
});
