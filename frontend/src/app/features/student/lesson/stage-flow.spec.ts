import { describe, expect, it } from 'vitest';
import { adjacentStage, stageAt, stageReady } from './stage-flow';
import { AiMaterial, StageLink } from '../learning.api';

describe('student stage flow', () => {
  const stages: StageLink[] = [
    { key: 'conversation', title: 'محادثة', position: 7, route: '/conversation' },
    { key: 'grammar', title: 'قواعد', position: 5, route: '/grammar' },
    { key: 'vocabulary', title: 'كلمات', position: 2, route: '/vocabulary' },
  ];

  it('uses enabled stage order rather than fixed stage numbers', () => {
    expect(stageAt(stages, 'grammar')?.position).toBe(5);
    expect(adjacentStage(stages, 'vocabulary', 1)?.key).toBe('grammar');
    expect(adjacentStage(stages, 'grammar', 1)?.key).toBe('conversation');
    expect(adjacentStage(stages, 'conversation', 1)).toBeNull();
  });

  it('checks every earlier stage, including when optional types are skipped', () => {
    const material = { stages, completed: { vocabulary: true, grammar: false } } as AiMaterial;
    expect(stageReady(material, 'grammar')).toBe(true);
    expect(stageReady(material, 'conversation')).toBe(false);
    expect(stageReady({ ...material, completed: { ...material.completed, grammar: true } }, 'conversation'))
      .toBe(true);
  });
});
