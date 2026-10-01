import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
@Component({
  selector: 'app-teacher-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './teacher-layout.html',
  styleUrl: './teacher-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeacherLayout {}
