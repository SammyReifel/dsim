import type { GameSettings } from "../types";
import type { BotLevel } from "../bots/botConfig";

const COUNTS = [0, 1, 2] as const;
const LEVELS: [BotLevel, string][] = [
  ["easy", "Easy"],
  ["normal", "Normal"],
  ["hard", "Hard"],
  ["nightmare", "Nightmare"],
];
/** what each level does, in one line: the ladder is measured, so say what changes */
const LEVEL_NOTE: Record<BotLevel, string> = {
  easy: "Easy bots drive slowly and wait for the hive to settle before they shoot.",
  normal: "Normal bots play the whole game at a steady pace.",
  hard: "Hard bots work as a team and play defence when you’re carrying.",
  nightmare:
    "Nightmare bots never play defence. Every second goes into outscoring you.",
};

/**
 * The BOTS configurator (`src/bots/`): how many opponents, a teammate, and how hard — three
 * segmented controls and one line saying what the chosen level does. One component so the Play page
 * and Configure → Match can never disagree about the options. Bots play in the two OFFLINE
 * modes only — an online room has real people in it.
 *
 * Every bot drives the PLAYER'S build (`botSetup`), so the level is the only difference.
 * The level row stays visible with no bots selected, disabled, so choosing bots never makes
 * the panel jump.
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
  const any = count > 0 || partner;
  return (
    <div className="cat-config">
      <div
        className="cat-spec-row"
        role="radiogroup"
        aria-label="Opponent bots"
      >
        <span className="cs-name">Opponents</span>
        <div className="cs-vals">
          {COUNTS.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={count === n}
              className={`cat-val${count === n ? " on" : ""}`}
              onClick={() => onChange({ opponentBots: n })}
            >
              {n === 0 ? "None" : n}
            </button>
          ))}
        </div>
      </div>
      <div className="cat-spec-row" role="radiogroup" aria-label="Bot teammate">
        <span className="cs-name">Teammate</span>
        <div className="cs-vals">
          <button
            role="radio"
            aria-checked={!partner}
            className={`cat-val${!partner ? " on" : ""}`}
            onClick={() => onChange({ botPartner: false })}
          >
            None
          </button>
          <button
            role="radio"
            aria-checked={partner}
            className={`cat-val${partner ? " on" : ""}`}
            onClick={() => onChange({ botPartner: true })}
          >
            Bot
          </button>
        </div>
      </div>
      <div className="cat-spec-row" role="radiogroup" aria-label="Bot level">
        <span className="cs-name">Level</span>
        <div className="cs-vals four">
          {LEVELS.map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={settings.botLevel === k}
              disabled={!any}
              className={`cat-val${settings.botLevel === k ? " on" : ""}`}
              onClick={() => onChange({ botLevel: k })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="cat-note">
        {any
          ? LEVEL_NOTE[settings.botLevel]
          : "Just you and the field. Add opponents or a teammate above."}
      </p>
    </div>
  );
}
