import type { Alliance, GameId } from '../types';
import { DEFAULT_ASSISTS, DEFAULT_SPEC, type RobotSetup } from '../sim/spawn';
import { BB_PRESET_LIST } from '../games/biobuzz/presets';
import { bbCoerceSpec } from '../games/biobuzz/robotConfig';
import { bbLauncherOf } from '../games/biobuzz/mechs';
import { BB_HOOD_DEFAULT_DEG } from '../games/biobuzz/config';
import type { RobotSpec } from '../types';
import { rpmLimits } from '../sim/drivetrain';
import type { BotLevel } from './botConfig';

/**
 * WHAT A BOT DRIVES. One function, so the game and the bot tests spawn the same robot.
 *
 * DECODE and Chain Reaction bots drive the default build with auto intake + auto fire: the
 * mechanisms do their own work and the brain only drives. BIOBUZZ has no auto-fire, so a
 * BIOBUZZ bot fires and runs its intake by hand, and drives the SKIMMER with a Box Tube on its
 * back (`BB_BOT_SPEC`): the one build that plays every part of the game. Its DOUBLE turret aims
 * itself and launches NECTAR as well as POLLEN (which the Sniper's single turret cannot even
 * carry, `bbIntakeAccepts`), and the tube places into the FLOWERS.
 */
export function botSetup(
  game: GameId,
  id: number,
  alliance: Alliance,
  startIndex: number,
  opts: { level?: BotLevel; name?: string; teamName?: string } = {},
): RobotSetup {
  const bb = game === 'biobuzz';
  const base = bb ? BB_BOT_SPEC : DEFAULT_SPEC;
  // NIGHTMARE gears its drivetrain as fast as the builder allows. Still a legal robot — the
  // same `rpmLimits` envelope the builder's slider offers anyone — just the fastest one.
  const driveRpm = opts.level === 'nightmare' ? rpmLimits(base.drivetrain).max : base.driveRpm;
  return {
    id,
    alliance,
    spec: {
      ...base,
      driveRpm,
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
