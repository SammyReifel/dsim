import type { Alliance, GameSettings, RobotCommand, RobotState, Vec2, World } from '../../types';
import { clamp, datan2, hyp, rot, wrapAngle } from '../../math';
import { viewAngleOf } from '../../sim/field';
import { PLAYER_ASSISTS, coerceSpec, type RobotSetup } from '../../sim/spawn';
import { BB_HIVE_X, bbHopperCap } from './config';
import { BB_DEFAULT_SPEC } from './coerce';

/** Computer-controlled BIOBUZZ robots for offline practice only. */
export function bbOpponentSetups(settings: GameSettings): RobotSetup[] {
  if (settings.game !== 'biobuzz') return [];
  const alliance: Alliance = settings.alliance === 'blue' ? 'red' : 'blue';
  const base = coerceSpec(BB_DEFAULT_SPEC, BB_DEFAULT_SPEC, 'biobuzz');
  const setups: RobotSetup[] = [];
  for (let i = 0; i < Math.min(2, settings.opponentCount); i++) {
    setups.push({
      id: i + 1,
      alliance,
      spec: { ...base, name: `Opponent ${i + 1}`, teamName: 'Computer', teamNumber: 0 },
      assists: { ...PLAYER_ASSISTS, autoFire: false },
      startIndex: i,
    });
  }
  return setups;
}

const idle = (): RobotCommand => ({
  driveX: 0, driveY: 0, rotate: 0, leftDrive: 0, rightDrive: 0, intake: false, fire: false,
});

/** A deterministic command from the BIOBUZZ field state. Aim Assist controls shot timing. */
export function bbOpponentCommand(world: World, robot: RobotState): RobotCommand {
  if (world.match.phase === 'pre' || world.match.phase === 'transition' || world.match.phase === 'post') return idle();

  const cmd = idle();
  cmd.intake = true;
  cmd.fire = robot.hopper.length > 0;
  let target: Vec2 | null = null;
  if (robot.hopper.length >= bbHopperCap(robot.spec)) {
    // Shoot from outside the north or south HIVE mouth, whichever side the robot is on.
    target = { x: robot.alliance === 'red' ? -BB_HIVE_X : BB_HIVE_X, y: robot.pos.y < 0 ? -38 : 38 };
  } else {
    let best = Infinity;
    for (const ball of world.balls) {
      // The single-turret practice build collects POLLEN, not alliance NECTAR.
      if (ball.state.kind !== 'ground' || ball.color !== 'yellow') continue;
      const dx = ball.pos.x - robot.pos.x;
      const dy = ball.pos.y - robot.pos.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < best) {
        best = distanceSq;
        target = ball.pos;
      }
    }
  }
  if (!target) return cmd;

  const dx = target.x - robot.pos.x;
  const dy = target.y - robot.pos.y;
  const distance = hyp(dx, dy);
  if (distance < 1e-6) return cmd;
  const speed = clamp((distance - 5) / 24, 0, 0.85);
  const driver = rot({ x: dx / distance * speed, y: dy / distance * speed }, viewAngleOf(robot.alliance));
  cmd.driveX = driver.x;
  cmd.driveY = driver.y;
  cmd.rotate = clamp(wrapAngle(datan2(dy, dx) - robot.heading) * 1.1, -1, 1);
  cmd.leftDrive = clamp(speed - cmd.rotate, -1, 1);
  cmd.rightDrive = clamp(speed + cmd.rotate, -1, 1);
  return cmd;
}
