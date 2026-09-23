import type { GameSettings } from '../types';
import type { BotLevel, BotStyle } from '../bots/botConfig';

const COUNTS = [0, 1, 2] as const;
const STYLES: [BotStyle, string][] = [
  ['mixed', 'Mixed'],
  ['scorer', 'Scorers'],
  ['defender', 'Defenders'],
];
const LEVELS: [BotLevel, string][] = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
];

/**
 * The OPPONENT BOTS picker (`src/bots/`): how many, what they do, how hard. One component so
 * the mode select and Configure → Match setup can never disagree about the options. Bots play
 * in the two OFFLINE modes only — an online room has real opponents.
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
            {STYLES.map(([k, label]) => (
              <button
                key={k}
                className={`ds-opt mini ${settings.botStyle === k ? 'on' : ''}`}
                onClick={() => onChange({ botStyle: k })}
              >
                <span className="ot">{label}</span>
              </button>
            ))}
          </div>
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
          {settings.game === 'chain' && <p className="ds-hint">In Chain Reaction, bots only defend.</p>}
        </>
      )}
    </div>
  );
}
