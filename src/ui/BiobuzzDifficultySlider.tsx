import type { BbOpponentDifficulty } from '../types';
import { BB_DIFFICULTIES } from '../games/biobuzz/practiceTypes';

export function BiobuzzDifficultySlider({ value, onChange }: {
  value: BbOpponentDifficulty;
  onChange: (value: BbOpponentDifficulty) => void;
}) {
  return (
    <div className="ds-practice-difficulty">
      <label htmlFor="bb-opponent-difficulty">Difficulty: <strong>{value === 'xhard' ? 'Xhard' : value[0].toUpperCase() + value.slice(1)}</strong></label>
      <input
        id="bb-opponent-difficulty"
        type="range"
        min={0}
        max={3}
        step={1}
        value={BB_DIFFICULTIES.indexOf(value)}
        onChange={(event) => onChange(BB_DIFFICULTIES[Number(event.target.value)])}
        aria-label="Opponent difficulty"
      />
      <div className="ds-practice-difficulty-labels" aria-hidden="true">
        <span>Easy</span><span>Medium</span><span>Hard</span><span>Xhard</span>
      </div>
    </div>
  );
}
