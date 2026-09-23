/**
 * OPPONENT BOTS — computer-driven robots for solo practice and free drive.
 *
 * A bot is a CONTROLLER, not a sim feature: it reads the world exactly as a driver reads the
 * screen and produces an ordinary `RobotCommand`, which `GameController.stepSolo` localizes and
 * steps beside the player's own. That is the whole seam, and it is why nothing in `src/sim/`
 * knows bots exist: the recorder stores their commands like anyone else's, so a practice replay
 * with bots in it re-simulates exactly, with no bot logic running at playback.
 *
 * It follows that a bot may keep MEMORY here (its current target, a stuck timer) without
 * breaking determinism — the log is the commands, not the reasoning that produced them. It still
 * uses no `Math.random`, so the same world and the same player produce the same bot.
 *
 * Two styles:
 *  - SCORER — DECODE only: collects ground artifacts, drives into the launch zone and lets the
 *    auto-fire assist empty the hopper, parks in its BASE for the endgame. In any other game it
 *    falls back to DEFENDER, since it has no idea what that game's scoring elements are.
 *  - DEFENDER — shadows the player, parking itself on the line between the player and the
 *    player's goal. It backs off after a few seconds of sustained contact, so it plays defence
 *    rather than farming G422 pinning fouls for you.
 * Both play SCORER in AUTO (a defender crossing the field in auto is a G402 MAJOR every time).
 */
import * as C from '../config';
import { clamp, rot, wrapAngle } from '../math';
import { driverSide, goalCenter, goalSide, viewAngleOf } from '../sim/field';
import type { Alliance, RobotCommand, RobotState, Vec2, World } from '../types';
import type { BotLevel, BotStyle } from './botConfig';

export { BOT_LEVELS, BOT_STYLES, MAX_OPPONENT_BOTS } from './botConfig';
export type { BotLevel, BotStyle } from './botConfig';

/** the stick magnitude each level drives at — a bot on EASY is a slower driver, not a dumber one */
const LEVEL_SPEED: Record<BotLevel, number> = { easy: 0.55, normal: 0.8, hard: 1 };
/** how many artifacts a scorer collects before it goes to shoot */
const LEVEL_LOAD: Record<BotLevel, number> = { easy: 1, normal: 2, hard: 3 };

/** seconds without closing on a target before the bot gives up on it */
const STUCK_S = 1.4;
/** inches of progress that count as "closing" */
const STUCK_PROGRESS = 3;
/** how long a given-up artifact is ignored */
const BLACKLIST_S = 5;
/** a defender in contact this long backs off */
const DEFEND_CONTACT_S = 3;
const DEFEND_BACKOFF_S = 1.5;
/** teleop seconds left when every bot heads for its BASE */
const PARK_AT_S = 12;

type Role = 'scorer' | 'defender';

interface Memory {
  targetId: number | null;
  bestDist: number;
  lastProgressAt: number;
  blacklist: Map<number, number>; // artifact id -> world.time it is forgiven
  shootSince: number | null;
  contactSince: number | null;
  backoffUntil: number;
}

const zeroCmd = (): RobotCommand => ({
  driveX: 0,
  driveY: 0,
  rotate: 0,
  leftDrive: 0,
  rightDrive: 0,
  intake: false,
  fire: false,
});

/** one bot's brain. `role` is fixed at construction — `mixed` is resolved by the caller. */
export class OpponentBot {
  private mem: Memory = {
    targetId: null,
    bestDist: Infinity,
    lastProgressAt: 0,
    blacklist: new Map(),
    shootSince: null,
    contactSince: null,
    backoffUntil: -1,
  };

  constructor(
    readonly robotId: number,
    readonly role: Role,
    readonly level: BotLevel,
    /** which of the bots this is (0, 1) — spreads their shooting spots so they do not stack */
    readonly slot: number,
  ) {}

  command(world: World, playerId: number): RobotCommand {
    const r = world.robots.find((x) => x.id === this.robotId);
    const phase = world.match.phase;
    if (!r || phase === 'pre' || phase === 'transition' || phase === 'post') return zeroCmd();

    const decode = (world.game ?? 'decode') === 'decode';
    const endgame = phase === 'teleop' && world.match.phaseTimeLeft <= PARK_AT_S;
    if (decode && endgame) return this.drive(r, baseCenter(r.alliance), -Math.PI / 2, 1.5);

    const role: Role = !decode ? 'defender' : phase === 'auto' ? 'scorer' : this.role;
    return role === 'scorer' ? this.score(world, r) : this.defend(world, r, playerId);
  }

  // ------------------------------------------------------------------ scoring ----

  private score(world: World, r: RobotState): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const load = LEVEL_LOAD[this.level];
    const target = this.pickArtifact(world, r);
    const wantShoot = r.hopper.length >= load || (r.hopper.length > 0 && !target);

    if (wantShoot) {
      m.targetId = null;
      const spot = this.shootSpot(r.alliance);
      const there = Math.hypot(spot.x - r.pos.x, spot.y - r.pos.y) < 6;
      if (there && m.shootSince === null) m.shootSince = t;
      // auto-fire does the shooting; point the intake AWAY from the goal so the turret has room
      const g = goalCenter(r.alliance);
      const face = Math.atan2(r.pos.y - g.y, r.pos.x - g.x);
      const cmd = this.drive(r, spot, face, 2);
      // a hopper that will not empty (a jam, a phase the shooter will not fire in) must not
      // park the bot forever — go collect again and try later
      if (m.shootSince !== null && t - m.shootSince > 4) {
        m.shootSince = null;
        return this.collect(world, r, target);
      }
      return cmd;
    }
    m.shootSince = null;
    return this.collect(world, r, target);
  }

  private collect(world: World, r: RobotState, target: { id: number; pos: Vec2 } | null): RobotCommand {
    const m = this.mem;
    const t = world.time;
    if (!target) {
      // nothing to pick up: loiter at the shooting spot out of everyone's way
      return this.drive(r, this.shootSpot(r.alliance), r.heading, 3);
    }
    if (m.targetId !== target.id) {
      m.targetId = target.id;
      m.bestDist = Infinity;
      m.lastProgressAt = t;
    }
    const d = Math.hypot(target.pos.x - r.pos.x, target.pos.y - r.pos.y);
    if (d < m.bestDist - STUCK_PROGRESS) {
      m.bestDist = d;
      m.lastProgressAt = t;
    } else if (t - m.lastProgressAt > STUCK_S) {
      m.blacklist.set(target.id, t + BLACKLIST_S);
      m.targetId = null;
    }
    const face = Math.atan2(target.pos.y - r.pos.y, target.pos.x - r.pos.x);
    // drive at the ball's centre but slow down on the way in so the intake gets its bite
    const cmd = this.drive(r, target.pos, face, 0);
    cmd.intake = true;
    return cmd;
  }

  /** the nearest loose ground artifact this bot may legally and usefully chase */
  private pickArtifact(world: World, r: RobotState): { id: number; pos: Vec2 } | null {
    const m = this.mem;
    const t = world.time;
    const auto = world.match.phase === 'auto';
    const side = goalSide(r.alliance);
    let best: { id: number; pos: Vec2 } | null = null;
    let bestD = Infinity;
    for (const b of world.balls) {
      if (b.state.kind !== 'ground') continue;
      const until = m.blacklist.get(b.id);
      if (until !== undefined) {
        if (t < until) continue;
        m.blacklist.delete(b.id);
      }
      // G402: stay on our own half in AUTO
      if (auto && b.pos.x * side < -2) continue;
      // hugging the perimeter: the intake cannot get its mouth behind these reliably
      if (Math.abs(b.pos.x) > C.FIELD_HALF - 4 || Math.abs(b.pos.y) > C.FIELD_HALF - 4) continue;
      let d = Math.hypot(b.pos.x - r.pos.x, b.pos.y - r.pos.y);
      // stick with the current target unless something is clearly closer (no dithering)
      if (b.id === m.targetId) d -= 8;
      if (d < bestD) {
        bestD = d;
        best = { id: b.id, pos: b.pos };
      }
    }
    return best;
  }

  /** inside the big launch triangle, on our goal's side, spread per bot */
  private shootSpot(a: Alliance): Vec2 {
    const g = goalSide(a);
    return this.slot === 0 ? { x: g * 14, y: 34 } : { x: g * 26, y: 50 };
  }

  // ---------------------------------------------------------------- defending ----

  private defend(world: World, r: RobotState, playerId: number): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const victim =
      world.robots.find((x) => x.id === playerId && x.alliance !== r.alliance) ??
      world.robots.find((x) => x.alliance !== r.alliance && !x.passive);
    if (!victim) return zeroCmd();

    const dx = victim.pos.x - r.pos.x;
    const dy = victim.pos.y - r.pos.y;
    const dist = Math.hypot(dx, dy);
    const touching = dist < (r.spec.length + victim.spec.length) / 2 + 3;
    if (touching) m.contactSince ??= t;
    else m.contactSince = null;
    if (m.contactSince !== null && t - m.contactSince > DEFEND_CONTACT_S) {
      m.contactSince = null;
      m.backoffUntil = t + DEFEND_BACKOFF_S;
    }
    const face = Math.atan2(dy, dx);
    if (t < m.backoffUntil) {
      const away = { x: r.pos.x - (dx / (dist || 1)) * 30, y: r.pos.y - (dy / (dist || 1)) * 30 };
      return this.drive(r, clampField(away), face, 0);
    }
    // stand on the line from the victim to ITS goal, a little ahead of it
    const g = goalCenter(victim.alliance);
    const gx = g.x - victim.pos.x;
    const gy = g.y - victim.pos.y;
    const gl = Math.hypot(gx, gy) || 1;
    const ahead = Math.min(20, gl * 0.5);
    const spot = clampField({ x: victim.pos.x + (gx / gl) * ahead, y: victim.pos.y + (gy / gl) * ahead });
    return this.drive(r, spot, face, 0);
  }

  // -------------------------------------------------------------------- drive ----

  /**
   * Drive toward `to` and turn toward `face`. The command is FIELD-centric (bots spawn with
   * `fieldCentric`), so the field-frame direction is rotated INTO the driver frame the sim
   * rotates back out of (`updateRobot`: `fieldVec = rot(stick, -viewAngle)`).
   */
  private drive(r: RobotState, to: Vec2, face: number, arrive: number): RobotCommand {
    const cmd = zeroCmd();
    const vmax = LEVEL_SPEED[this.level];
    const dx = to.x - r.pos.x;
    const dy = to.y - r.pos.y;
    const d = Math.hypot(dx, dy);
    const turnErr = wrapAngle(face - r.heading);
    const turn = clamp(turnErr * 2.2, -1, 1) * Math.max(0.6, vmax);

    let fx = 0;
    let fy = 0;
    if (d > arrive) {
      // ease in over the last foot; hold back a little while badly misaligned so the
      // intake meets the artifact nose-first rather than with a flank
      const align = 1 - 0.5 * Math.min(1, Math.abs(turnErr) / Math.PI);
      const s = vmax * clamp(d / 12, 0.3, 1) * align;
      fx = (dx / d) * s;
      fy = (dy / d) * s;
    }

    const tank =
      r.spec.drivetrain === 'tank' || (r.spec.drivetrain === 'butterfly' && r.butterflyTank);
    if (tank) {
      // no strafe: turn toward the travel direction and drive along the heading
      const travel = d > arrive ? Math.atan2(dy, dx) : face;
      const err = wrapAngle(travel - r.heading);
      const fwd = (fx * Math.cos(r.heading) + fy * Math.sin(r.heading)) * Math.max(0, Math.cos(err));
      const w = clamp(err * 2.2, -1, 1) * vmax;
      cmd.leftDrive = clamp(fwd - w, -1, 1);
      cmd.rightDrive = clamp(fwd + w, -1, 1);
      return cmd;
    }
    const stick = r.fieldCentric
      ? rot({ x: fx, y: fy }, viewAngleOf(r.alliance))
      : (() => {
          // robot-centric: stick up = robot forward, stick right = robot right
          const local = rot({ x: fx, y: fy }, -r.heading);
          return { x: -local.y, y: local.x };
        })();
    cmd.driveX = clamp(stick.x, -1, 1);
    cmd.driveY = clamp(stick.y, -1, 1);
    cmd.rotate = turn;
    return cmd;
  }
}

function baseCenter(a: Alliance): Vec2 {
  return { x: driverSide(a) * C.BASE_CENTER.x, y: C.BASE_CENTER.y };
}

function clampField(p: Vec2): Vec2 {
  const m = C.FIELD_HALF - 12;
  return { x: clamp(p.x, -m, m), y: clamp(p.y, -m, m) };
}

/**
 * Build the bot brains for a set of opponent ids. `mixed` makes the first a scorer and the
 * second a defender (a lone mixed bot scores — a solo defender with nothing to defend FOR is
 * just a wall).
 */
export function makeBots(ids: number[], style: BotStyle, level: BotLevel): OpponentBot[] {
  return ids.map((id, i) => {
    const role: Role = style === 'mixed' ? (i === 0 ? 'scorer' : 'defender') : style;
    return new OpponentBot(id, role, level, i);
  });
}
