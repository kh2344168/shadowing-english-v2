import { TestBed } from '@angular/core/testing';
import { AdminAIProcessingPage } from './ai-processing.page';

describe('AdminAIProcessingPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminAIProcessingPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminAIProcessingPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
