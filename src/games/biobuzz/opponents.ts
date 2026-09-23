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
      spec: { ...base, name: base.name, teamName: 'Computer', teamNumber: 0 },
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
    spec: { ...base, name: base.name, teamName: 'Computer', teamNumber: 0 },
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

type BotMemory = { tick: number; pos: Vec2; stalled: number; detour: Vec2 | null; detourUntil: number; escapes: number; homeY: number; patrolY: number; shotLane: 'inner' | 'outer' | null; laneLockedUntil: number; crossing: boolean; fireTick: number; fireLoad: number };
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
    const homeY = robot.pos.y < 0 ? -1 : 1;
    memory = { tick: world.tick, pos: { ...robot.pos }, stalled: 0, detour: null, detourUntil: 0, escapes: 0, homeY, patrolY: homeY * 42, shotLane: null, laneLockedUntil: 0, crossing: false, fireTick: world.tick, fireLoad: 0 };
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
  // Above or below the frame, crossing x is already clear. Inserting a
  // waypoint here makes tank robots flip routes as y jitters near its gate.
  if (from.y * goal.y > 0 && Math.min(Math.abs(from.y), Math.abs(goal.y)) > 27) return goal;
  const zone = (x: number) => x < -20 ? -1 : x > 20 ? 1 : 0;
  const current = zone(from.x);
  const destination = zone(goal.x);
  if (current === destination) return goal;
  const barSide = current || destination;
  const laneSide = Math.abs(goal.y) > 20 ? (goal.y < 0 ? -1 : 1) : (from.y < 0 ? -1 : 1);
  const laneY = laneSide * 48;
  if (current === 0) {
    // From under the HIVE, first clear the inner end of the bar, then cross it.
    return Math.abs(from.y) < 36
      ? { x: barSide * 7, y: laneY }
      : { x: barSide * 43, y: laneY };
  }
  // Approaching from outside: travel past the bar end before cutting in.
  return Math.abs(from.y) < 36
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
  const profile = skill[difficulty];
  const memory = memoryFor(world, robot);
  const scoringSide = robot.alliance === 'red' ? -1 : 1;
  let target: Vec2 | null = null;
  let crossing = false;
  if (carrying) {
    // Stay outside the CELL mouth and the central frame. A turret can keep moving
    // along this lane; a dumper travels there before asking Aim Assist to turn it.
    const spot = (lane: 'inner' | 'outer'): Vec2 => lane === 'outer'
      ? { x: allianceSign * (dumper ? 38 : 55), y: scoringSide * (dumper ? 32 : 42) }
      : { x: allianceSign * (dumper ? 10 : 34), y: scoringSide * (dumper ? 38 : 34) };
    if (!memory.shotLane) {
      memory.shotLane = robot.alliance === world.robots.find((other) => other.id === 0)?.alliance || robot.id % 2 === 0 ? 'outer' : 'inner';
      memory.crossing = robot.pos.y * scoringSide < 0;
    }
    const alternate = memory.shotLane === 'inner' ? 'outer' : 'inner';
    const occupied = (lane: 'inner' | 'outer') => {
      const point = spot(lane);
      return world.robots.some((other) => other.id !== robot.id && !other.passive &&
        hyp(other.pos.x - point.x, other.pos.y - point.y) < 25);
    };
    if (world.tick >= memory.laneLockedUntil && occupied(memory.shotLane) && !occupied(alternate)) {
      memory.shotLane = alternate;
      memory.laneLockedUntil = world.tick + 240;
    }
    target = spot(memory.shotLane);
    // Loaded robots use the outside traffic lane when they must cross from
    // the other end of the field to the active CELL. Empty collectors can
    // still work their home half without driving head-on into that route.
    if (robot.pos.y * scoringSide > 32) memory.crossing = false;
    crossing = memory.crossing;
    if (crossing) target = { x: allianceSign * 54, y: scoringSide * 44 };
  } else {
    memory.shotLane = null;
    memory.crossing = false;
    // Perimeter POLLEN can sit behind a wall from a chassis-sized robot's point
    // of view. Chasing it was the source of long, motionless wall presses.
    const candidates = world.balls
      .filter((ball) => ball.state.kind === 'ground' && ball.color === 'yellow' &&
        ball.pos.x * allianceSign >= 2 && Math.abs(ball.pos.x) < 60 && Math.abs(ball.pos.y) < 60 &&
        !(Math.abs(ball.pos.x) < 30 && Math.abs(ball.pos.y) < 25))
      .map((ball) => {
        const dx = ball.pos.x - robot.pos.x;
        const dy = ball.pos.y - robot.pos.y;
        const distanceSquared = dx * dx + dy * dy;
        const claimed = world.robots.some((other) => {
          if (other.id === robot.id || other.alliance !== robot.alliance ||
              other.passive || other.hopper.length > 0) return false;
          const ox = ball.pos.x - other.pos.x;
          const oy = ball.pos.y - other.pos.y;
          const otherDistanceSquared = ox * ox + oy * oy;
          if (other.id === 0) return otherDistanceSquared < 42 * 42;
          return otherDistanceSquared < distanceSquared - 100 ||
            (Math.abs(otherDistanceSquared - distanceSquared) <= 100 && other.id < robot.id);
        });
        return { ball, claimed, cost: distanceSquared + (ball.pos.y * memory.homeY < 0 ? 1800 : 0) };
      })
      .sort((a, b) => a.cost - b.cost || a.ball.id - b.ball.id);
    const available = candidates.find((candidate) => !candidate.claimed);
    if (available) {
      target = available.ball.pos;
    } else {
      // Keep patrolling when the only POLLEN left is against the perimeter.
      if (Math.abs(robot.pos.y - memory.patrolY) < 8) memory.patrolY = memory.homeY * (Math.abs(memory.patrolY) > 40 ? 28 : 50);
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
  const taskDistance = hyp(target.x - robot.pos.x, target.y - robot.pos.y);
  if (memory.stalled > 55 && taskDistance > 8 && !memory.detour) {
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
  const nearShot = carrying && !navigating && shotDistance < 3;
  cmd.fire = carrying && !crossing && !memory.detour && !navigating && (dumper ? nearShot : shotDistance < profile.fireRange);
  if (!cmd.fire || memory.fireLoad !== robot.hopper.length) {
    memory.fireTick = world.tick;
    memory.fireLoad = robot.hopper.length;
  } else if (world.tick - memory.fireTick > 180) {
    memory.shotLane = memory.shotLane === 'inner' ? 'outer' : 'inner';
    memory.laneLockedUntil = world.tick + 240;
    memory.fireTick = world.tick;
    cmd.fire = false;
    memory.detour = { x: allianceSign * 43, y: scoringSide * 46 };
    memory.detourUntil = world.tick + 180;
  }
  const speed = distance < 2 || cmd.fire ? 0 : clamp(distance / 32, 0.38, profile.speed);
  let steerX = dx / Math.max(distance, 1e-6);
  let steerY = dy / Math.max(distance, 1e-6);
  // Give one robot right of way instead of having both cancel their routes.
  // Carrying wins; the human driver wins every encounter. The yielding robot
  // moves aside early enough for its drivetrain to respond before contact.
  for (const other of world.robots) {
    if (other.id === robot.id || other.passive) continue;
    const ox = robot.pos.x - other.pos.x;
    const oy = robot.pos.y - other.pos.y;
    const separation = hyp(ox, oy);
    const yielding = other.id === 0 ||
      (robot.hopper.length === 0 && other.hopper.length > 0) ||
      ((robot.hopper.length > 0) === (other.hopper.length > 0) && robot.id > other.id);
    const radius = other.id === 0 ? 30 : yielding ? 48 : 34;
    if (separation >= radius) continue;
    const safeDistance = separation > 1e-6 ? separation : 1;
    const awayX = separation > 1e-6 ? ox / safeDistance : (robot.id < other.id ? -1 : 1);
    const awayY = separation > 1e-6 ? oy / safeDistance : 0;
    const strength = (radius - separation) / radius * (yielding ? 2.4 : 0.4);
    const sidestep = other.id === 0 ? 0 : 0.8;
    steerX += (awayX - awayY * sidestep) * strength;
    steerY += (awayY + awayX * sidestep) * strength;
  }
  // The perimeter is solid. Never let collision avoidance point a robot into
  // that wall; favor open floor even if another chassis is pinning it there.
  if (robot.pos.x > 55 && steerX > -0.4) steerX = -0.8;
  if (robot.pos.x < -55 && steerX < 0.4) steerX = 0.8;
  if (robot.pos.y > 55 && steerY > -0.4) steerY = -0.8;
  if (robot.pos.y < -55 && steerY < 0.4) steerY = 0.8;
  const steerLength = hyp(steerX, steerY);
  if (steerLength > 1) { steerX /= steerLength; steerY /= steerLength; }
  const driver = rot({ x: steerX * speed, y: steerY * speed }, viewAngleOf(robot.alliance));
  cmd.driveX = driver.x;
  cmd.driveY = driver.y;
  const angleError = wrapAngle(datan2(steerY, steerX) - robot.heading);
  cmd.rotate = clamp(angleError * profile.turn, -1, 1);
  // A tank must face its travel direction before accelerating. When a dumper
  // shoots, Aim Assist owns the turn; stop the tank long enough to release.
  const reverse = Math.abs(angleError) > 2.35;
  const tankSpeed = Math.abs(angleError) < 0.35 || reverse ? speed * dcos(angleError) : 0;
  const tankTurn = reverse ? cmd.rotate * 0.35 : cmd.rotate;
  cmd.leftDrive = clamp(tankSpeed - tankTurn, -1, 1);
  cmd.rightDrive = clamp(tankSpeed + tankTurn, -1, 1);
  return cmd;
}
