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
 *  - SCORER — DECODE: collects ground artifacts, drives into the launch zone and lets the
 *    auto-fire assist empty the hopper, parks in its BASE for the endgame.
 *    BIOBUZZ: collects POLLEN (and its own NECTAR), drives outboard of its own HIVE's UP cell
 *    and holds fire — Aim Assist only releases a shot that lands, and enough of them TIP the
 *    HIVE — then parks in its LOADING ZONE for the endgame. Chain Reaction falls back to
 *    DEFENDER, since the bot has no idea what that game's scoring elements are.
 *  - DEFENDER — shadows the player, parking itself on the line between the player and the
 *    player's goal. It backs off after a few seconds of sustained contact, so it plays defence
 *    rather than farming G422 pinning fouls for you.
 * Both play SCORER in AUTO (a defender crossing the field in auto is a G402 MAJOR every time).
 */
import * as C from '../config';
import { clamp, rot, wrapAngle } from '../math';
import { driverSide, goalCenter, goalSide, viewAngleOf } from '../sim/field';
import type { Alliance, Artifact, RobotCommand, RobotState, Vec2, World } from '../types';
import { BB_FRAME_BAR_IN, BB_FRAME_BAR_OUT, BB_FRAME_Y, BB_HIVE_CELL_DY, BB_HIVE_X } from '../games/biobuzz/config';
import type { BotLevel, BotStyle } from './botConfig';

export { BOT_LEVELS, BOT_STYLES, MAX_OPPONENT_BOTS } from './botConfig';
export type { BotLevel, BotStyle } from './botConfig';

/** the stick magnitude each level drives at — a bot on EASY is a slower driver, not a dumber one */
const LEVEL_SPEED: Record<BotLevel, number> = { easy: 0.55, normal: 0.8, hard: 1 };
/** how many artifacts a scorer collects before it goes to shoot */
const LEVEL_LOAD: Record<BotLevel, number> = { easy: 1, normal: 2, hard: 3 };

/** seconds without closing on a target before the bot gives up on it */
const STUCK_S = 2;
/** inches of progress that count as "closing" */
const STUCK_PROGRESS = 3;
/** how long a given-up artifact is ignored */
const BLACKLIST_S = 5;
/** a defender in contact this long backs off */
const DEFEND_CONTACT_S = 2.5;
/** longer than the pin rules' 3-second release (G421 / G422 criterion A), so a back-off ENDS a pin */
const DEFEND_BACKOFF_S = 3.6;
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
  /** world.time the robot started going nowhere despite being told to move, or null */
  stallSince: number | null;
  escapeUntil: number;
  escapeTo: Vec2;
  escapes: number;
}

/** commanded but not moving for this long ⇒ wedged on something: back out */
const STALL_S = 0.9;
const STALL_SPEED = 4;
const ESCAPE_S = 0.7;

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
  /** the game of the world being driven — `drive` routes around BIOBUZZ's HIVE frame */
  private game: string = 'decode';
  private mem: Memory = {
    targetId: null,
    bestDist: Infinity,
    lastProgressAt: 0,
    blacklist: new Map(),
    shootSince: null,
    contactSince: null,
    backoffUntil: -1,
    stallSince: null,
    escapeUntil: -1,
    escapeTo: { x: 0, y: 0 },
    escapes: 0,
  };
  /** every other robot this tick — `drive` never pushes into one (see `drive`) */
  private others: RobotState[] = [];

  constructor(
    readonly robotId: number,
    readonly role: Role,
    readonly level: BotLevel,
    /** which of the bots this is (0, 1) — spreads their shooting spots so they do not stack */
    readonly slot: number,
  ) {}

  command(world: World, playerId: number): RobotCommand {
    this.game = world.game ?? 'decode';
    const r = world.robots.find((x) => x.id === this.robotId);
    const phase = world.match.phase;
    if (!r || phase === 'pre' || phase === 'transition' || phase === 'post') return zeroCmd();

    this.others = world.robots.filter((x) => x.id !== r.id);
    const cmd = this.think(world, r, playerId);
    return this.unstick(world, r, cmd);
  }

  /**
   * WEDGED? A bot that keeps asking to move and goes nowhere is stuck on something the plan did
   * not know about (a FLOWER foot, a wall corner, a pile). It backs out for a moment toward open
   * floor, alternating which side it swings to, and then the plan resumes from where it is.
   */
  private unstick(world: World, r: RobotState, cmd: RobotCommand): RobotCommand {
    const m = this.mem;
    const t = world.time;
    if (t < m.escapeUntil) {
      const out = this.drive(r, m.escapeTo, r.heading, 0);
      out.intake = cmd.intake;
      return out;
    }
    const asked = Math.max(Math.hypot(cmd.driveX, cmd.driveY), Math.abs(cmd.leftDrive + cmd.rightDrive) / 2);
    const moving = Math.hypot(r.vel.x, r.vel.y) > STALL_SPEED;
    if (asked < 0.3 || moving) {
      m.stallSince = null;
      return cmd;
    }
    m.stallSince ??= t;
    if (t - m.stallSince < STALL_S) return cmd;
    // toward the field centre, swung 60° one way or the other on alternate escapes
    m.escapes++;
    const cx = -r.pos.x;
    const cy = -r.pos.y;
    const cl = Math.hypot(cx, cy) || 1;
    const out = rot({ x: cx / cl, y: cy / cl }, (m.escapes % 2 ? 1 : -1) * (Math.PI / 3));
    m.escapeTo = clampField({ x: r.pos.x + out.x * 30, y: r.pos.y + out.y * 30 });
    m.escapeUntil = t + ESCAPE_S;
    m.stallSince = null;
    return cmd;
  }

  private think(world: World, r: RobotState, playerId: number): RobotCommand {
    const phase = world.match.phase;
    const game = world.game ?? 'decode';
    const scores = game === 'decode' || game === 'biobuzz';
    const endgame = phase === 'teleop' && world.match.phaseTimeLeft <= PARK_AT_S;
    if (game === 'decode' && endgame) return this.drive(r, baseCenter(r.alliance), -Math.PI / 2, 1.5);
    if (game === 'biobuzz' && endgame) return this.drive(r, bbLoadingZone(r.alliance), r.heading, 2);

    const role: Role = !scores ? 'defender' : phase === 'auto' ? 'scorer' : this.role;
    if (role === 'defender') return this.defend(world, r, playerId);
    return game === 'biobuzz' ? this.bbScore(world, r) : this.score(world, r);
  }

  // ---------------------------------------------------------------- BIOBUZZ ----

  /**
   * BIOBUZZ has no auto-fire: the driver HOLDS fire and Aim Assist lets a shot go only when it
   * would land in the NEARER of the robot's own two cells, pretending that cell is up. So the
   * bot's whole job is to stand where the nearer cell IS the up cell, on its open (outboard)
   * side, and hold the button. It reads which cell is up off the world — a driver can see that.
   */
  private bbScore(world: World, r: RobotState): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const hive = world.biobuzz?.hives?.[r.alliance];
    const target = this.pickArtifact(world, r, (b) => bbWanted(b, r.alliance));
    const load = Math.min(4, LEVEL_LOAD[this.level] + 1);
    // what the up cell still needs to TIP (docs/biobuzz-reference.md §4.1); if the hopper can
    // finish it, go now rather than filling up first
    const short = hive ? bbTipShortfall(world, hive.contents) : Infinity;
    const wantShoot =
      r.hopper.length >= load || (r.hopper.length > 0 && (!target || r.hopper.length >= short));
    // a swinging HIVE takes nothing — collect while it settles
    if (!wantShoot || !hive || hive.tipping > 0) {
      m.shootSince = null;
      return this.collect(world, r, target);
    }
    m.targetId = null;
    const spot = this.bbShootSpot(r.alliance, hive.up);
    const d = Math.hypot(spot.x - r.pos.x, spot.y - r.pos.y);
    if (d < 8 && m.shootSince === null) m.shootSince = t;
    if (m.shootSince !== null && t - m.shootSince > 4) {
      // nothing is going in from here (blocked, a jam) — collect more and come back
      m.shootSince = null;
      return this.collect(world, r, target);
    }
    // face the hive so a chassis-fixed launcher is already close to lined up
    const cell = { x: r.alliance === 'red' ? -BB_HIVE_X : BB_HIVE_X, y: 0 };
    const face = Math.atan2(cell.y - r.pos.y, cell.x - r.pos.x);
    const cmd = this.drive(r, spot, face, 3);
    cmd.fire = d < 14;
    return cmd;
  }

  /** outboard of the up cell (its mouth faces away from the pivot), on our own half, spread per bot */
  private bbShootSpot(a: Alliance, up: 'north' | 'south'): Vec2 {
    const s = up === 'south' ? -1 : 1;
    const hx = a === 'red' ? -BB_HIVE_X : BB_HIVE_X;
    const out = a === 'red' ? -1 : 1;
    return this.slot === 0
      ? { x: hx + out * 4, y: s * (BB_HIVE_CELL_DY + 26) }
      : { x: hx + out * 16, y: s * (BB_HIVE_CELL_DY + 34) };
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
  private pickArtifact(
    world: World,
    r: RobotState,
    wanted: (b: Artifact) => boolean = () => true,
  ): { id: number; pos: Vec2 } | null {
    const m = this.mem;
    const t = world.time;
    const auto = world.match.phase === 'auto';
    // our own half: DECODE puts an alliance on its GOAL side; BIOBUZZ puts red at x < 0 (G304.A)
    const side = (world.game ?? 'decode') === 'biobuzz' ? (r.alliance === 'red' ? -1 : 1) : goalSide(r.alliance);
    let best: { id: number; pos: Vec2 } | null = null;
    let bestD = Infinity;
    for (const b of world.balls) {
      if (b.state.kind !== 'ground' || !wanted(b)) continue;
      const until = m.blacklist.get(b.id);
      if (until !== undefined) {
        if (t < until) continue;
        m.blacklist.delete(b.id);
      }
      // G402: stay on our own half in AUTO
      if (auto && b.pos.x * side < -2) continue;
      // hugging the perimeter: the intake cannot get its mouth behind these reliably
      // (BIOBUZZ stages its GARDEN pollen against the wall and there is little else loose on
      // that field, so its bots try those anyway — the stuck timer gives up on a bad one)
      const wall = this.game === 'biobuzz' ? 1 : 4;
      if (Math.abs(b.pos.x) > C.FIELD_HALF - wall || Math.abs(b.pos.y) > C.FIELD_HALF - wall) continue;
      let d = Math.hypot(b.pos.x - r.pos.x, b.pos.y - r.pos.y);
      // one sitting against an opponent is one you cannot reach without shoving it
      for (const o of world.robots) {
        if (o.alliance !== r.alliance && Math.hypot(b.pos.x - o.pos.x, b.pos.y - o.pos.y) < halfDiag(o) + 12) d += 60;
      }
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
    // half-DIAGONALS, not half-lengths: two rotated chassis touch corner-first well outside
    // the sum of their half-lengths, and a contact this test missed never triggered a back-off
    const reach = halfDiag(r) + halfDiag(victim);
    const touching = dist < reach + 2;
    if (touching) m.contactSince ??= t;
    else m.contactSince = null;
    if (m.contactSince !== null && t - m.contactSince > DEFEND_CONTACT_S) {
      m.contactSince = null;
      m.backoffUntil = t + DEFEND_BACKOFF_S;
    }
    const face = Math.atan2(dy, dx);
    if (t < m.backoffUntil) {
      const away = { x: r.pos.x - (dx / (dist || 1)) * 40, y: r.pos.y - (dy / (dist || 1)) * 40 };
      return this.drive(r, clampField(away), face, 0);
    }
    // stand on the line from the victim to ITS goal, a little ahead of it
    const g = goalOf(world, victim.alliance);
    const gx = g.x - victim.pos.x;
    const gy = g.y - victim.pos.y;
    const gl = Math.hypot(gx, gy) || 1;
    const ahead = Math.min(20, gl * 0.5);
    const spot = clampField({ x: victim.pos.x + (gx / gl) * ahead, y: victim.pos.y + (gy / gl) * ahead });
    // BLOCK, DON'T SHOVE: close on the spot but never drive INTO the victim. A defender
    // pushing an opponent is the textbook PIN (and in BIOBUZZ a MAJOR every 3 seconds).
    return this.drive(r, spot, face, 0, victim.pos, reach + 8);
  }

  // -------------------------------------------------------------------- drive ----

  /**
   * Drive toward `to` and turn toward `face`. The command is FIELD-centric (bots spawn with
   * `fieldCentric`), so the field-frame direction is rotated INTO the driver frame the sim
   * rotates back out of (`updateRobot`: `fieldVec = rot(stick, -viewAngle)`).
   */
  private drive(
    r: RobotState,
    to: Vec2,
    face: number,
    arrive: number,
    /** a robot not to push: within `noPushR` of it, any drive toward it is removed */
    noPush?: Vec2,
    noPushR = 0,
  ): RobotCommand {
    const cmd = zeroCmd();
    const vmax = LEVEL_SPEED[this.level];
    // speed comes from the distance to the real target; the DIRECTION may be a detour
    const d = Math.hypot(to.x - r.pos.x, to.y - r.pos.y);
    const via = this.game === 'biobuzz' ? bbRoute(r.pos, to) : to;
    const dx = via.x - r.pos.x;
    const dy = via.y - r.pos.y;
    const dv = Math.hypot(dx, dy) || 1;
    const turnErr = wrapAngle(face - r.heading);
    const turn = clamp(turnErr * 2.2, -1, 1) * Math.max(0.6, vmax);

    let fx = 0;
    let fy = 0;
    if (d > arrive) {
      // ease in over the last foot; hold back a little while badly misaligned so the
      // intake meets the artifact nose-first rather than with a flank
      const align = 1 - 0.5 * Math.min(1, Math.abs(turnErr) / Math.PI);
      const s = vmax * clamp(d / 12, 0.3, 1) * align;
      fx = (dx / dv) * s;
      fy = (dy / dv) * s;
    }
    // NEVER SHOVE AN OPPONENT: within reach of one, any drive toward it is removed. Pushing a
    // robot against something is a PIN (G421 bills a MAJOR every 3 seconds), and a scorer
    // collecting next to you should go round you, not through you.
    // Teammates are avoided the same way, so two bots on one alliance slide past each other
    // instead of stalling nose to nose. What is removed is turned SIDEWAYS (toward whichever side
    // the detour target lies), so a robot in the way is driven round, not just stopped at.
    const avoid: [Vec2, number][] = this.others.map((o) => [o.pos, halfDiag(r) + halfDiag(o) + 6]);
    if (noPush) avoid.push([noPush, noPushR]);
    for (const [q, R] of avoid) {
      const nx = q.x - r.pos.x;
      const ny = q.y - r.pos.y;
      const nd = Math.hypot(nx, ny) || 1;
      const ux = nx / nd;
      const uy = ny / nd;
      const toward = fx * ux + fy * uy;
      if (nd < R && toward > 0) {
        fx -= toward * ux;
        fy -= toward * uy;
        // slide round on the side the goal is on (the perpendicular with the goal's sign)
        const side = dx * -uy + dy * ux >= 0 ? 1 : -1;
        fx += side * -uy * toward * 0.8;
        fy += side * ux * toward * 0.8;
      }
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

/**
 * BIOBUZZ's HIVE FRAME has a solid base bar either side of centre (x ∈ ±[24, 25], |y| ≤ 19.4).
 * Robots drive UNDER the hives, but not through a bar. Each bar is treated as a keep-out box
 * inflated by a chassis half-diagonal, and a straight line that would clip one is bent round
 * the nearest clear corner — a one-step visibility graph, which is all two thin bars need.
 */
const BAR_KEEP = 11;
const BAR_BOXES = [-1, 1].map((sx) => {
  const a = sx * (BB_FRAME_BAR_IN - BAR_KEEP);
  const b = sx * (BB_FRAME_BAR_OUT + BAR_KEEP);
  return { x0: Math.min(a, b), x1: Math.max(a, b), y0: -BB_FRAME_Y - BAR_KEEP, y1: BB_FRAME_Y + BAR_KEEP };
});
type Box = (typeof BAR_BOXES)[number];

function inBox(p: Vec2, b: Box): boolean {
  return p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1;
}

/** does segment p→q pass through the interior of `b`? (Liang–Barsky) */
function segHitsBox(p: Vec2, q: Vec2, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const clip = (pp: number, qq: number): boolean => {
    if (pp === 0) return qq > 0;
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  const e = 0.5; // a line grazing the corner is clear
  return (
    clip(-dx, p.x - (b.x0 + e)) &&
    clip(dx, b.x1 - e - p.x) &&
    clip(-dy, p.y - (b.y0 + e)) &&
    clip(dy, b.y1 - e - p.y) &&
    t1 - t0 > 1e-6
  );
}

function bbRoute(p: Vec2, to: Vec2): Vec2 {
  for (const b of BAR_BOXES) {
    if (inBox(p, b)) {
      // already inside the keep-out (a shove put us there): leave sideways, the short way
      const left = p.x - b.x0;
      const right = b.x1 - p.x;
      return { x: left < right ? b.x0 - 2 : b.x1 + 2, y: p.y };
    }
    if (!segHitsBox(p, to, b)) continue;
    const m = 3;
    const corners: Vec2[] = [
      { x: b.x0 - m, y: b.y0 - m },
      { x: b.x1 + m, y: b.y0 - m },
      { x: b.x0 - m, y: b.y1 + m },
      { x: b.x1 + m, y: b.y1 + m },
    ];
    let best: Vec2 | null = null;
    let bestLen = Infinity;
    for (const c of corners) {
      // a corner already reached is not a waypoint (steering at it orbits it forever), and
      // one that leaves the bar still in the way is only a last resort
      if (segHitsBox(p, c, b) || Math.hypot(c.x - p.x, c.y - p.y) < 4) continue;
      const len =
        Math.hypot(c.x - p.x, c.y - p.y) +
        Math.hypot(to.x - c.x, to.y - c.y) +
        (segHitsBox(c, to, b) ? 1000 : 0);
      if (len < bestLen) {
        bestLen = len;
        best = c;
      }
    }
    return best ?? to;
  }
  return to;
}

/** where `a` scores, per game — what a defender stands in front of */
function goalOf(world: World, a: Alliance): Vec2 {
  const game = world.game ?? 'decode';
  if (game === 'biobuzz') {
    const up = world.biobuzz?.hives?.[a]?.up ?? 'north';
    const s = up === 'south' ? -1 : 1;
    // the shot comes in from outboard of the up cell, so guard the lane beyond it
    return { x: a === 'red' ? -BB_HIVE_X : BB_HIVE_X, y: s * (BB_HIVE_CELL_DY + 20) };
  }
  // Chain Reaction's ACCELERATOR hangs outside its own side wall (red left), centred in y
  if (game === 'chain') return { x: a === 'red' ? -C.FIELD_HALF : C.FIELD_HALF, y: 0 };
  return goalCenter(a);
}

/** POLLEN needed to TIP, indexed by NECTAR in the cell (the measured table, reference §4.1) */
const BB_TIP_NEED = [8, 7, 6, 3, 1, 0];

/** how many more elements the up cell needs before it tips (counting a nectar as a pollen) */
function bbTipShortfall(world: World, contents: readonly number[]): number {
  let nectar = 0;
  let pollen = 0;
  for (const id of contents) {
    const b = world.balls.find((x) => x.id === id);
    if (b && (b.color === 'red' || b.color === 'blue')) nectar++;
    else pollen++;
  }
  return Math.max(1, BB_TIP_NEED[Math.min(nectar, 5)] - pollen);
}

/** BIOBUZZ: POLLEN, or NECTAR of our own colour (the intake refuses the other — G408) */
function bbWanted(b: Artifact, a: Alliance): boolean {
  return b.color === 'red' || b.color === 'blue' ? b.color === a : true;
}

/** the middle of `a`'s LOADING ZONE, pulled in off the wall — PARK needs only part of the robot in */
function bbLoadingZone(a: Alliance): Vec2 {
  return a === 'red' ? { x: -60, y: 36 } : { x: 60, y: -36 };
}

function halfDiag(r: RobotState): number {
  return Math.hypot(r.spec.length, r.spec.width) / 2;
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
