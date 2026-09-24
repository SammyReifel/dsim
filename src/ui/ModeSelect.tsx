import { QueueCounts } from "./QueueCounts";
import { useLanEnabled } from "./useLanEnabled";
import { BotOptions } from "./BotOptions";
import type { GameSettings } from "../types";

/**
 * Game-mode select — reached from PLAY. These are the tiles that used to live on
 * Home. Every start action is still wrapped in App's `guardStart()` (stale-build
 * refresh + scheduled-restart block) by the caller, so nothing here bypasses it.
 */
export function ModeSelect({
  multiplayer,
  signedIn,
  onLan,
  activeGame,
  onRejoin,
  onFreeDrive,
  onSoloMatch,
  onRecordRun,
  onDuoRecord,
  onRanked,
  onCustomRoom,
  onWatch,
  settings,
  onSettings,
}: {
  /** the opponent-bot picker sits under the offline tiles and edits these directly */
  settings: GameSettings;
  onSettings: (patch: Partial<GameSettings>) => void;
  multiplayer: boolean;
  signedIn: boolean;
  /** a multiplayer game this browser is mid-way through (offer to rejoin it), or null */
  activeGame: { kind: "ranked" | "custom" | "record" } | null;
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
  const offline = !multiplayer ? "Needs the game server" : null;
  return (
    <>
      <h1 className="ds-h1">Play</h1>

      {activeGame && (
        <div className="ds-rejoin" role="alert">
          <b>You’re already in a game.</b>
          <button className="ds-btn primary" onClick={onRejoin}>
            Rejoin match →
          </button>
        </div>
      )}

      <section className="cat-practice" aria-labelledby="play-practice">
        <div className="cat-parts">
          <h2 className="cat-h2" id="play-practice">
            Practice offline
          </h2>
          <div className="cat-list">
            <PartRow
              primary
              name="Solo Practice"
              desc="A full scored match against the bots you pick."
              onClick={onSoloMatch}
            />
            <PartRow
              name="Free Drive"
              desc="No clock and no score. Your bots come along."
              onClick={onFreeDrive}
            />
          </div>
        </div>
        <div className="cat-configbox">
          <h2 className="cat-h2">Bots</h2>
          <BotOptions settings={settings} onChange={onSettings} />
        </div>
      </section>

      <section className="cat-parts" aria-labelledby="play-compete">
        <h2 className="cat-h2" id="play-compete">
          Compete online
        </h2>
        <div className="cat-list">
          <PartRow
            name="Find Match"
            extra={<QueueCounts className="tile" />}
            desc="Ranked 1v1 or 2v2 against real drivers."
            blocked={offline ?? (!signedIn ? "Sign in to play ranked" : null)}
            onClick={onRanked}
          />
          <PartRow
            name="Solo Record"
            desc="Score attack. Your best run goes on the board."
            blocked={offline}
            onClick={onRecordRun}
          />
          <PartRow
            name="Duo Record"
            desc="Score attack with a partner."
            blocked={offline}
            onClick={onDuoRecord}
          />
        </div>
      </section>

      <section className="cat-parts" aria-labelledby="play-custom">
        <h2 className="cat-h2" id="play-custom">
          Rooms
        </h2>
        <div className="cat-list">
          <PartRow
            name="Custom Room"
            desc="Make a room and share the code with friends."
            blocked={offline}
            onClick={onCustomRoom}
          />
          <PartRow
            name="Watch Live"
            desc="Spectate ranked matches in progress."
            blocked={offline}
            onClick={onWatch}
          />
          {/* Hidden entirely where `LAN_ENABLED` is off, rather than shown disabled: a greyed row
            advertises a mode this build will not play. */}
          {lanOn && (
            <PartRow
              name="LAN"
              desc="Host or join a game on the same network."
              onClick={onLan}
            />
          )}
        </div>
      </section>
    </>
  );
}

/**
 * One mode as a list ROW: its name, one line on what it is, and the
 * action at the end of the row. A mode that cannot be played here says why in place of the
 * arrow — a greyed row with no reason reads as broken.
 */
function PartRow({
  name,
  desc,
  onClick,
  primary,
  blocked = null,
  extra,
}: {
  name: string;
  desc: string;
  onClick: () => void;
  primary?: boolean;
  blocked?: string | null;
  extra?: React.ReactNode;
}) {
  return (
    <button
      className={`cat-part${primary ? " primary" : ""}`}
      onClick={onClick}
      disabled={!!blocked}
    >
      <span className="cp-name">
        {name}
        {extra}
      </span>
      <span className="cp-desc">{desc}</span>
      {blocked ? (
        <span className="cp-why">{blocked}</span>
      ) : (
        <svg className="cp-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}
