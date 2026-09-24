import type { Alliance, GameId } from '../types';
import { DEFAULT_ASSISTS, DEFAULT_SPEC, type RobotSetup } from '../sim/spawn';
import { BB_PRESET_LIST } from '../games/biobuzz/presets';
import { bbCoerceSpec } from '../games/biobuzz/robotConfig';
import { bbLauncherOf } from '../games/biobuzz/mechs';
import { BB_HOOD_DEFAULT_DEG } from '../games/biobuzz/config';
import type { RobotSpec } from '../types';
import type { BotLevel } from './botConfig';

/**
 * WHAT A BOT DRIVES. One function, so the game and the bot tests spawn the same robot.
 *
 * ⚠️ BOTS DRIVE THE PLAYER'S OWN BUILD (`opts.spec`, the player's `GameSettings.spec`). A match
 * against robots that are simply better machines is not practice for anything, and being out-
 * built is not the same as being out-played — so the difficulty is ALL in the driving. The
 * brain reads what that build can do (`bbCaps` in `opponentBot.ts`: a turret or a dumper,
 * NECTAR or not, a Box Tube or not, which edges the intake is on) and plays to it.
 *
 * Chain Reaction keeps the default build: its turretless archetypes need an aiming routine
 * the bot does not have. Without a spec, BIOBUZZ falls back to the Skimmer + Box Tube
 * (`BB_BOT_SPEC`), the one build that plays every part of that game.
 *
 * Assists are the bot's own, not the player's: field-centric (the brain thinks in field
 * coordinates), and in DECODE auto intake + auto fire. BIOBUZZ has no auto fire, and its bots
 * run the intake by hand so a build that cannot launch NECTAR does not fill up on it.
 */
export function botSetup(
  game: GameId,
  id: number,
  alliance: Alliance,
  startIndex: number,
  opts: { level?: BotLevel; name?: string; teamName?: string; spec?: RobotSpec } = {},
): RobotSetup {
  const bb = game === 'biobuzz';
  const base = game === 'chain' || !opts.spec ? (bb ? BB_BOT_SPEC : DEFAULT_SPEC) : opts.spec;
  return {
    id,
    alliance,
    spec: {
      ...base,
      name: opts.name ?? `Bot ${startIndex + 1}`,
      teamName: opts.teamName ?? 'Opponent bot',
      teamNumber: 0,
    },
    assists: { ...DEFAULT_ASSISTS, fieldCentric: true, autoIntake: !bb, autoFire: !bb },
    startIndex,
  };
}

/** Skimmer + a back-mounted Box Tube, through the ONE coercion chokepoint like any build */
const BB_BOT_SPEC: RobotSpec = (() => {
  const skimmer = BB_PRESET_LIST.find((p) => p.name === 'Skimmer') ?? BB_PRESET_LIST[0];
  return bbCoerceSpec({
    ...skimmer,
    bbMech: { launcher: bbLauncherOf(skimmer, BB_HOOD_DEFAULT_DEG), lift: { kind: 'vslide', mount: 'back' } },
  });
})();
