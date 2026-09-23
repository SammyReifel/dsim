import type { BbPracticeRobotType } from '../types';
import { BB_PRACTICE_TYPES } from '../games/biobuzz/practiceTypes';

export function BiobuzzPracticeTypeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BbPracticeRobotType;
  onChange: (type: BbPracticeRobotType) => void;
}) {
  return (
    <label className="ds-practice-type">
      <select
        className="ds-select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as BbPracticeRobotType)}
      >
        {BB_PRACTICE_TYPES.map((type) => (
          <option key={type.value} value={type.value}>{type.label}</option>
        ))}
      </select>
    </label>
  );
}
