import { firstValueFrom } from 'rxjs';
import { AiMaterial, StageLink, StudentLearningApi } from '../learning.api';

export function stageAt(stages: StageLink[] | null | undefined, key: string): StageLink | null {
  return stages?.find((stage) => stage.key === key) ?? null;
}

export function adjacentStage(
  stages: StageLink[] | null | undefined,
  key: string,
  direction: -1 | 1,
): StageLink | null {
  const ordered = [...(stages ?? [])].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((stage) => stage.key === key);
  return index < 0 ? null : ordered[index + direction] ?? null;
}

export function stageComplete(material: AiMaterial, key: string): boolean {
  switch (key) {
    case 'shadowing': return material.completed.shadowing === true;
    case 'vocabulary': return material.completed.vocabulary;
    case 'listen-type': return material.completed.listenType;
    case 'grammar': return material.completed.grammar === true;
    case 'vocabulary-quiz': return material.completed.vocabularyQuiz === true;
    case 'grammar-quiz': return material.completed.grammarQuiz === true;
    case 'word-order': return material.completed.wordOrder === true;
    case 'conversation': return material.completed.conversation;
    default: return false;
  }
}

export function stageReady(material: AiMaterial, key: string): boolean {
  if (!material.stages) return true;
  const ordered = [...material.stages].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((stage) => stage.key === key);
  return index >= 0 && ordered.slice(0, index).every((stage) => stageComplete(material, stage.key));
}

export async function stageReadyForStudent(
  api: Pick<StudentLearningApi, 'overview'>,
  slotId: string,
  material: AiMaterial,
  key: string,
): Promise<boolean> {
  if (stageReady(material, key)) return true;
  if (!material.stages?.some((stage) => stage.key === key)) return false;
  const overview = await firstValueFrom(api.overview(slotId));
  return overview.stages.some((stage) => stage.key === key && stage.isUnlocked);
}
