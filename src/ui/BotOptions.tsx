import type { GameSettings } from '../types';
import type { BotLevel } from '../bots/botConfig';

const COUNTS = [0, 1, 2] as const;
const LEVELS: [BotLevel, string][] = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
];

/**
 * The OPPONENT BOTS picker (`src/bots/`): how many, and how hard. One component so the mode
 * select and Configure → Match setup can never disagree about the options. Bots play in the
 * two OFFLINE modes only — an online room has real opponents.
 *
 * There is no play-style choice: the level decides it. Easy and Normal just play the game;
 * Hard coordinates, and is the only level that plays defence — which is why Hard, alone, gets
 * a line saying so. The other two do what their names say.
 */
export function BotOptions({
  settings,
  onChange,
}: {
  settings: GameSettings;
  onChange: (patch: Partial<GameSettings>) => void;
}) {
  const count = settings.opponentBots ?? 0;
  return (
    <div className="ds-botpick">
      <div className="ds-opts three">
        {COUNTS.map((n) => (
          <button
            key={n}
            className={`ds-opt mini ${count === n ? 'on' : ''}`}
            onClick={() => onChange({ opponentBots: n })}
          >
            <span className="ot">{n === 0 ? 'No bots' : `${n} bot${n > 1 ? 's' : ''}`}</span>
          </button>
        ))}
      </div>
      {count > 0 && (
        <>
          <div className="ds-opts three">
            {LEVELS.map(([k, label]) => (
              <button
                key={k}
                className={`ds-opt mini ${settings.botLevel === k ? 'on' : ''}`}
                onClick={() => onChange({ botLevel: k })}
              >
                <span className="ot">{label}</span>
              </button>
            ))}
          </div>
          {settings.botLevel === 'hard' && (
            <p className="ds-hint">Hard bots work as a team and play defence when you’re carrying.</p>
          )}
        </>
      )}
    </div>
  );
}
