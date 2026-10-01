import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin-curriculums-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './curriculums.page.html',
  styleUrl: './curriculums.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCurriculumsPage {}
