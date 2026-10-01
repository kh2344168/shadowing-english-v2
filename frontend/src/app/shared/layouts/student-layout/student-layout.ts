import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-student-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './student-layout.html',
  styleUrl: './student-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentLayout {
  accountOpen = false;
  toggleAccount(): void {
    this.accountOpen = !this.accountOpen;
  }
}
