import { useState } from 'react';
import type { GameSettings } from '../types';
import type { GameId } from '../games/types';
import { BiobuzzPracticeTypeSelect } from './BiobuzzPracticeTypeSelect';
import { BiobuzzDifficultySlider } from './BiobuzzDifficultySlider';
import { QueueCounts } from './QueueCounts';
import { useLanEnabled } from './useLanEnabled';

/**
 * Game-mode select — reached from PLAY. These are the tiles that used to live on
 * Home. Every start action is still wrapped in App's `guardStart()` (stale-build
 * refresh + scheduled-restart block) by the caller, so nothing here bypasses it.
 */
export function ModeSelect({
  multiplayer,
  signedIn,
  onLan,
  game,
  opponentCount,
  opponentTypes,
  opponentDifficulty,
  practiceTeammate,
  teammateType,
  onPracticeChange,
  activeGame,
  onRejoin,
  onFreeDrive,
  onSoloMatch,
  onRecordRun,
  onDuoRecord,
  onRanked,
  onCustomRoom,
  onWatch,
}: {
  multiplayer: boolean;
  signedIn: boolean;
  game: GameId;
  opponentCount: number;
  opponentTypes: GameSettings['opponentTypes'];
  opponentDifficulty: GameSettings['opponentDifficulty'];
  practiceTeammate: boolean;
  teammateType: GameSettings['teammateType'];
  onPracticeChange: (patch: Partial<Pick<GameSettings, 'opponentCount' | 'opponentTypes' | 'opponentDifficulty' | 'practiceTeammate' | 'teammateType'>>) => void;
  /** a multiplayer game this browser is mid-way through (offer to rejoin it), or null */
  activeGame: { kind: 'ranked' | 'custom' | 'record' } | null;
  onRejoin: () => void;
  onFreeDrive: () => void;
  onSoloMatch: () => void;
  onRecordRun: () => void;
  onDuoRecord: () => void;
  onRanked: () => void;
  onCustomRoom: () => void;
  onWatch: () => void;
  /** host or join a game on this network (docs/lan-selfhost.md) */
  onLan: () => void;
}) {
  const lanOn = useLanEnabled();
  const [practiceOpen, setPracticeOpen] = useState(false);
  return (
    <>
      <h1 className="ds-h1">Pick a mode</h1>

      {activeGame && (
        <div className="ds-rejoin" role="alert">
          <b>You’re already in a game.</b>
          <button className="ds-btn primary" onClick={onRejoin}>
            Rejoin match →
          </button>
        </div>
      )}

      {/* Offline, always available — the safe default (Solo Practice is primary) */}
      <section className="ds-tileset">
        <p className="ds-tileset-label">Practice · offline</p>
        <div className="ds-tiles">
          <button
            className="ds-tile primary"
            onClick={game === 'biobuzz' ? () => setPracticeOpen((open) => !open) : onSoloMatch}
            aria-expanded={game === 'biobuzz' ? practiceOpen : undefined}
            aria-controls={game === 'biobuzz' && practiceOpen ? 'biobuzz-solo-setup' : undefined}
          >
            <span className="k">Solo</span>
            <span>
              <span className="t">Solo Practice</span>
            </span>
          </button>

          <button className="ds-tile" onClick={onFreeDrive}>
            <span className="k">Practice</span>
            <span>
              <span className="t">Free Drive</span>
            </span>
          </button>
        </div>
        {game === 'biobuzz' && practiceOpen && (
          <div className="ds-practice-panel" id="biobuzz-solo-setup" role="region" aria-label="Solo Practice setup">
            <div className="ds-practice-head"><h2>Solo Practice</h2></div>
            <fieldset className="ds-practice-group">
              <legend>Opponents</legend>
              <div className="ds-opts three">
                {([0, 1, 2] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`ds-opt mini ${opponentCount === count ? 'on' : ''}`}
                    onClick={() => onPracticeChange({ opponentCount: count })}
                    aria-pressed={opponentCount === count}
                  >
                    <span className="ot">{count}</span>
                  </button>
                ))}
              </div>
              {opponentCount > 0 && (
                <>
                  <BiobuzzDifficultySlider value={opponentDifficulty} onChange={(value) => onPracticeChange({ opponentDifficulty: value })} />
                  <div className="ds-practice-type-list">
                    {Array.from({ length: opponentCount }, (_, index) => (
                      <BiobuzzPracticeTypeSelect
                        key={index}
                        label={`Opponent ${index + 1}`}
                        value={opponentTypes[index]}
                        onChange={(type) => onPracticeChange({
                          opponentTypes: index === 0
                            ? [type, opponentTypes[1]]
                            : [opponentTypes[0], type],
                        })}
                      />
                    ))}
                  </div>
                </>
              )}
            </fieldset>
            <fieldset className="ds-practice-group">
              <legend>Teammate</legend>
              <div className="ds-opts two">
                <button
                  type="button"
                  className={`ds-opt mini ${!practiceTeammate ? 'on' : ''}`}
                  onClick={() => onPracticeChange({ practiceTeammate: false })}
                  aria-pressed={!practiceTeammate}
                >
                  <span className="ot">No</span>
                </button>
                <button
                  type="button"
                  className={`ds-opt mini ${practiceTeammate ? 'on' : ''}`}
                  onClick={() => onPracticeChange({ practiceTeammate: true })}
                  aria-pressed={practiceTeammate}
                >
                  <span className="ot">Yes</span>
                </button>
              </div>
              {practiceTeammate && (
                <div className="ds-practice-type-list">
                  <BiobuzzPracticeTypeSelect
                    label="Robot type"
                    value={teammateType}
                    onChange={(type) => onPracticeChange({ teammateType: type })}
                  />
                </div>
              )}
            </fieldset>
            <div className="ds-practice-actions">
              <span>{practiceTeammate ? '2' : '1'}v{opponentCount}</span>
              <button className="ds-btn primary" onClick={onSoloMatch}>Start</button>
            </div>
          </div>
        )}
      </section>

      {/* Online — ranked + score-attack records (need the game server / sign-in) */}
      <section className="ds-tileset">
        <p className="ds-tileset-label">Compete · online</p>
        <div className="ds-tiles">
          <button className="ds-tile" onClick={onRanked} disabled={!multiplayer || !signedIn}>
            <span className="k">Ranked</span>
            <span>
              <span className="t">
                Find Match
                <QueueCounts className="tile" />
              </span>
              {/* ⚠️ CONDITIONAL, and it must stay that way. A previous pass rendered
                  this line ALWAYS, with a non-breaking space when there was nothing to
                  say, to stop the tile growing when `signedIn` resolves asynchronously.
                  That trade is backwards: `.ds-tiles` is a grid, so the reserved line
                  made Find Match, Solo Record AND Duo Record permanently a line taller
                  for everyone, to spare signed-in users one shrink at first paint —
                  and most visitors are signed out, where the line is there from the
                  start and never moves at all. If the shift is worth fixing, thread an
                  `authReady` flag down from AccountSync; do not reserve the line. */}
              {(!multiplayer || !signedIn) && (
                <span className="d">
                  {!multiplayer ? 'Needs the game server' : 'Sign in to play ranked'}
                </span>
              )}
            </span>
          </button>

          <button className="ds-tile" onClick={onRecordRun} disabled={!multiplayer}>
            <span className="k">Records</span>
            <span>
              <span className="t">Solo Record</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>

          <button className="ds-tile" onClick={onDuoRecord} disabled={!multiplayer}>
            <span className="k">Records</span>
            <span>
              <span className="t">Duo Record</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>
        </div>
      </section>

      {/* Custom room */}
      <section className="ds-tileset">
        <p className="ds-tileset-label">Custom · online</p>
        <div className="ds-tiles">
          <button className="ds-tile" onClick={onCustomRoom} disabled={!multiplayer}>
            <span className="k">Custom</span>
            <span>
              <span className="t">Custom Room</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>
          <button className="ds-tile" onClick={onWatch} disabled={!multiplayer}>
            <span className="k">Live</span>
            <span>
              <span className="t">Watch Live</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>
        </div>
      </section>

      {/* LAN — LAST on the page (owner, 2026-09-13). Never disabled on `multiplayer`: not
          needing our servers is the point of it.

          Hidden entirely where `LAN_ENABLED` is off, rather than shown disabled: a greyed tile
          advertises a mode this build will not play, and the reason it is off is that the
          feature is being held back, not that the player is missing a prerequisite. */}
      {lanOn && (
        <section className="ds-tileset">
          <p className="ds-tileset-label">LAN · same network</p>
          <div className="ds-tiles">
            <button className="ds-tile" onClick={onLan}>
              <span className="k">LAN</span>
              <span>
                <span className="t">Host or Join</span>
              </span>
            </button>
          </div>
        </section>
      )}
    </>
  );
}
