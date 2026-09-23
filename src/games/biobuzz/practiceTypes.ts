import type { BbOpponentDifficulty, BbPracticeRobotType } from '../../types';

export const BB_DIFFICULTIES: readonly BbOpponentDifficulty[] = ['easy', 'medium', 'hard', 'xhard'];

export const BB_PRACTICE_TYPES: readonly {
  value: BbPracticeRobotType;
  label: string;
}[] = [
  { value: 'sniper', label: 'Sniper' },
  { value: 'hauler', label: 'Hauler' },
  { value: 'skimmer', label: 'Skimmer' },
];

export function bbPracticeType(raw: unknown, fallback: BbPracticeRobotType): BbPracticeRobotType {
  return raw === 'sniper' || raw === 'hauler' || raw === 'skimmer' ? raw : fallback;
}
