import type { Alliance, BbOpponentDifficulty, BbPracticeRobotType, GameSettings, RobotCommand, RobotState, Vec2, World } from '../../types';
import { clamp, datan2, dcos, hyp, rot, wrapAngle } from '../../math';
import { viewAngleOf } from '../../sim/field';
import { PLAYER_ASSISTS, coerceSpec, type RobotSetup } from '../../sim/spawn';
import { BB_HOOD_DEFAULT_DEG, BB_PRESETS, bbAnchorCat } from './config';
import { BB_DEFAULT_SPEC } from './coerce';
import { bbLauncherOf } from './mechs';
import { bbPracticeType } from './practiceTypes';

function practiceSpec(type: BbPracticeRobotType) {
  const preset = BB_PRESETS.find((p) => p.name.toLowerCase() === type) ?? BB_DEFAULT_SPEC;
  return coerceSpec(preset, BB_DEFAULT_SPEC, 'biobuzz');
}

/** Computer-controlled BIOBUZZ robots for offline practice only. */
export function bbOpponentSetups(settings: GameSettings): RobotSetup[] {
  if (settings.game !== 'biobuzz') return [];
  const alliance: Alliance = settings.alliance === 'blue' ? 'red' : 'blue';
  const setups: RobotSetup[] = [];
  for (let i = 0; i < Math.min(2, settings.opponentCount); i++) {
    const type = bbPracticeType(settings.opponentTypes[i], i === 0 ? 'sniper' : 'skimmer');
    const base = practiceSpec(type);
    setups.push({
      id: i + 1,
      alliance,
      spec: { ...base, name: `Opponent ${i + 1} · ${base.name}`, teamName: 'Computer', teamNumber: 0 },
      assists: { ...PLAYER_ASSISTS, autoFire: false },
      startIndex: i,
    });
  }
  return setups;
}

/** The player's computer partner starts in the other top/bottom role. */
export function bbTeammateSetup(settings: GameSettings): RobotSetup | null {
  if (settings.game !== 'biobuzz' || !settings.practiceTeammate) return null;
  const playerTop = settings.startPose
    ? settings.startPose.y >= 0
    : bbAnchorCat(settings.startIndex) === 'close';
  const base = practiceSpec(bbPracticeType(settings.teammateType, 'sniper'));
  return {
    id: bbOpponentSetups(settings).length + 1,
    alliance: settings.alliance,
    spec: { ...base, name: `Teammate · ${base.name}`, teamName: 'Computer', teamNumber: 0 },
    assists: { ...PLAYER_ASSISTS, autoFire: false },
    startIndex: playerTop ? 1 : 0,
  };
}

export function bbDifficultyFor(settings: GameSettings, robot: RobotState): BbOpponentDifficulty {
  return robot.alliance === settings.alliance ? 'hard' : settings.opponentDifficulty;
}

const idle = (): RobotCommand => ({
  driveX: 0, driveY: 0, rotate: 0, leftDrive: 0, rightDrive: 0, intake: false, fire: false,
});

type BotMemory = { tick: number; pos: Vec2; stalled: number; detour: Vec2 | null; detourUntil: number; escapes: number; patrolY: number };
const botMemory = new WeakMap<RobotState, BotMemory>();

const skill = {
  easy: { speed: 0.55, fireRange: 4, turn: 0.75 },
  medium: { speed: 0.72, fireRange: 5, turn: 0.9 },
  hard: { speed: 0.9, fireRange: 6, turn: 1.1 },
  xhard: { speed: 1, fireRange: 8, turn: 1.35 },
} as const;

function memoryFor(world: World, robot: RobotState): BotMemory {
  let memory = botMemory.get(robot);
  if (!memory || world.tick < memory.tick) {
    memory = { tick: world.tick, pos: { ...robot.pos }, stalled: 0, detour: null, detourUntil: 0, escapes: 0, patrolY: robot.id % 2 ? 42 : -42 };
    botMemory.set(robot, memory);
  }
  const elapsed = world.tick - memory.tick;
  if (elapsed > 0) {
    const moved = hyp(robot.pos.x - memory.pos.x, robot.pos.y - memory.pos.y);
    memory.stalled = moved < 0.025 * elapsed ? memory.stalled + elapsed : 0;
    memory.tick = world.tick;
    memory.pos = { ...robot.pos };
  }
  return memory;
}

function routeAroundHive(from: Vec2, goal: Vec2): Vec2 {
  const zone = (x: number) => x < -20 ? -1 : x > 20 ? 1 : 0;
  const current = zone(from.x);
  const destination = zone(goal.x);
  if (current === destination) return goal;
  const barSide = current || destination;
  const laneSide = Math.abs(from.y) > 8 ? (from.y < 0 ? -1 : 1) : (goal.y < 0 ? -1 : 1);
  const laneY = laneSide * 48;
  if (current === 0) {
    // From under the HIVE, first clear the inner end of the bar, then cross it.
    return Math.abs(from.y) < 43
      ? { x: barSide * 7, y: laneY }
      : { x: barSide * 43, y: laneY };
  }
  // Approaching from outside: travel past the bar end before cutting in.
  return Math.abs(from.y) < 43
    ? { x: barSide * 43, y: laneY }
    : { x: barSide * 7, y: laneY };
}

/** A deterministic command from the BIOBUZZ field state. Aim Assist controls shot timing. */
export function bbOpponentCommand(world: World, robot: RobotState, difficulty: BbOpponentDifficulty = 'hard'): RobotCommand {
  if (world.match.phase === 'pre' || world.match.phase === 'transition' || world.match.phase === 'post') return idle();

  const cmd = idle();
  cmd.intake = true;
  const carrying = robot.hopper.length > 0;
  const dumper = bbLauncherOf(robot.spec, BB_HOOD_DEFAULT_DEG).kind === 'dumper';
  const side = robot.pos.y < 0 ? -1 : 1;
  const allianceSign = robot.alliance === 'red' ? -1 : 1;
  const scoringSide = robot.alliance === 'red' ? -1 : 1;
  const profile = skill[difficulty];
  const memory = memoryFor(world, robot);
  let target: Vec2 | null = null;
  if (carrying) {
    // Stay outside the CELL mouth and the central frame. A turret can keep moving
    // along this lane; a dumper travels there before asking Aim Assist to turn it.
    const laneOffset = robot.id % 2 === 0 ? 8 : 0;
    target = { x: allianceSign * ((dumper ? 30 : 36) + laneOffset), y: scoringSide * (dumper ? 36 : 40) };
  } else {
    // Perimeter POLLEN can sit behind a wall from a chassis-sized robot's point
    // of view. Chasing it was the source of long, motionless wall presses.
    const candidates = world.balls
      .filter((ball) => ball.state.kind === 'ground' && ball.color === 'yellow' &&
        Math.abs(ball.pos.x) < 60 && Math.abs(ball.pos.y) < 60)
      .map((ball) => {
        const dx = ball.pos.x - robot.pos.x;
        const dy = ball.pos.y - robot.pos.y;
        const distanceSquared = dx * dx + dy * dy;
        const claimed = world.robots.some((other) => {
          if (other.id === robot.id || other.id === 0 || other.alliance !== robot.alliance ||
              other.passive || other.hopper.length > 0) return false;
          const ox = ball.pos.x - other.pos.x;
          const oy = ball.pos.y - other.pos.y;
          const otherDistanceSquared = ox * ox + oy * oy;
          return otherDistanceSquared < distanceSquared - 100 ||
            (Math.abs(otherDistanceSquared - distanceSquared) <= 100 && other.id < robot.id);
        });
        const framePenalty = Math.abs(ball.pos.x) < 30 && Math.abs(ball.pos.y) < 25 ? 800 : 0;
        return { ball, claimed, cost: distanceSquared + framePenalty };
      })
      .sort((a, b) => a.cost - b.cost || a.ball.id - b.ball.id);
    const available = candidates.find((candidate) => !candidate.claimed);
    if (available) {
      target = available.ball.pos;
    } else {
      // Keep patrolling when the only POLLEN left is against the perimeter.
      if (Math.abs(robot.pos.y - memory.patrolY) < 8) memory.patrolY = -memory.patrolY;
      target = { x: allianceSign * 42, y: memory.patrolY };
    }
  }
  if (!target) return cmd;

  // A straight line to POLLEN can run into a HIVE base bar or FLOWER foot.
  // Route toward open floor when a chassis stops advancing, then retry the task.
  if (memory.detour && (world.tick >= memory.detourUntil ||
      hyp(robot.pos.x - memory.detour.x, robot.pos.y - memory.detour.y) < 7)) {
    memory.detour = null;
    memory.stalled = 0;
  }
  if (memory.stalled > 55 && hyp(target.x - robot.pos.x, target.y - robot.pos.y) > 8) {
    memory.escapes++;
    const escapeSide = memory.escapes % 3 === 0 ? -side : side;
    memory.detour = { x: (robot.pos.x < 0 ? -1 : 1) * (memory.escapes % 2 ? 46 : 40), y: escapeSide * 46 };
    memory.detourUntil = world.tick + 240;
    memory.stalled = 0;
  }
  if (memory.detour) target = memory.detour;
  const taskTarget = target;
  target = routeAroundHive(robot.pos, target);
  const navigating = target !== taskTarget;

  const dx = target.x - robot.pos.x;
  const dy = target.y - robot.pos.y;
  const distance = hyp(dx, dy);
  const shotDistance = hyp(taskTarget.x - robot.pos.x, taskTarget.y - robot.pos.y);
  const nearShot = carrying && !navigating && shotDistance < 12;
  cmd.fire = carrying && !memory.detour && !navigating && (dumper ? nearShot : shotDistance < profile.fireRange);
  const speed = distance < 2 || cmd.fire ? 0 : clamp(distance / 32, 0.38, profile.speed);
  let steerX = dx / Math.max(distance, 1e-6);
  let steerY = dy / Math.max(distance, 1e-6);
  // Give nearby robots room, including the human driver's robot. The same
  // passing side for a pair makes head-on robots steer in opposite directions.
  for (const other of world.robots) {
    if (other.id === robot.id || other.passive) continue;
    const ox = robot.pos.x - other.pos.x;
    const oy = robot.pos.y - other.pos.y;
    const separation = hyp(ox, oy);
    if (separation >= 34) continue;
    const safeDistance = separation > 1e-6 ? separation : 1;
    const awayX = separation > 1e-6 ? ox / safeDistance : (robot.id < other.id ? -1 : 1);
    const awayY = separation > 1e-6 ? oy / safeDistance : 0;
    const strength = (34 - separation) / 34 * 1.6;
    steerX += (awayX - awayY * 0.7) * strength;
    steerY += (awayY + awayX * 0.7) * strength;
  }
  const steerLength = hyp(steerX, steerY);
  if (steerLength > 1) { steerX /= steerLength; steerY /= steerLength; }
  const driver = rot({ x: steerX * speed, y: steerY * speed }, viewAngleOf(robot.alliance));
  cmd.driveX = driver.x;
  cmd.driveY = driver.y;
  const angleError = wrapAngle(datan2(steerY, steerX) - robot.heading);
  cmd.rotate = clamp(angleError * profile.turn, -1, 1);
  // A tank must face its travel direction before accelerating. When a dumper
  // shoots, Aim Assist owns the turn; stop the tank long enough to release.
  const tankSpeed = speed * (dcos(angleError) > 0 ? dcos(angleError) : 0);
  cmd.leftDrive = clamp(tankSpeed - cmd.rotate, -1, 1);
  cmd.rightDrive = clamp(tankSpeed + cmd.rotate, -1, 1);
  return cmd;
}
