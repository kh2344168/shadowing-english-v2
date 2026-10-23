import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-student-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './student-layout.html',
  styleUrl: './student-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentLayout {
  private readonly router = inject(Router);
  accountOpen = false;
  readonly conversationOpen = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => this.isConversation(event.urlAfterRedirects)),
    ),
    { initialValue: this.isConversation(this.router.url) },
  );

  private isConversation(url: string): boolean {
    return /\/student\/lessons\/[^/]+\/conversation(?:[/?#]|$)/.test(url);
  }

  toggleAccount(): void {
    this.accountOpen = !this.accountOpen;
  }
}
