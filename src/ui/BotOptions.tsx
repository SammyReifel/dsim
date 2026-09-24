import type { GameSettings } from '../types';
import type { BotLevel } from '../bots/botConfig';

const COUNTS = [0, 1, 2] as const;
const LEVELS: [BotLevel, string][] = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
  ['nightmare', 'Nightmare'],
];
/** what the two levels that are more than "faster" actually change */
const LEVEL_NOTE: Partial<Record<BotLevel, string>> = {
  hard: 'Hard bots work as a team and play defence when you’re carrying.',
  nightmare: 'Nightmare bots play flat out to beat you. They only defend once they’re ahead.',
};

/**
 * The BOTS picker (`src/bots/`): how many opponents, a teammate, and how hard. One component so
 * the mode select and Configure → Match setup can never disagree about the options. Bots play
 * in the two OFFLINE modes only — an online room has real people in it.
 *
 * Every bot drives the PLAYER'S build (`botSetup`), so the level is the only difference.
 * There is no play-style choice: the level decides it, and it applies to every bot, teammate
 * included. Hard and Nightmare get a line saying what else they do; the other two do what
 * their names say.
 */
export function BotOptions({
  settings,
  onChange,
}: {
  settings: GameSettings;
  onChange: (patch: Partial<GameSettings>) => void;
}) {
  const count = settings.opponentBots ?? 0;
  const partner = !!settings.botPartner;
  const note = LEVEL_NOTE[settings.botLevel];
  return (
    <div className="ds-botpick">
      <div className="ds-opts four">
        {COUNTS.map((n) => (
          <button
            key={n}
            className={`ds-opt mini ${count === n ? 'on' : ''}`}
            onClick={() => onChange({ opponentBots: n })}
          >
            <span className="ot">{n === 0 ? 'No opponents' : `${n} opponent${n > 1 ? 's' : ''}`}</span>
          </button>
        ))}
        <button className={`ds-opt mini ${partner ? 'on' : ''}`} onClick={() => onChange({ botPartner: !partner })}>
          <span className="ot">Teammate {partner ? 'on' : 'off'}</span>
        </button>
      </div>
      {(count > 0 || partner) && (
        <>
          <div className="ds-opts four">
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
          {note && <p className="ds-hint">{note}</p>}
        </>
      )}
    </div>
  );
}
