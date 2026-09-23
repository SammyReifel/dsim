/**
 * OPPONENT BOTS — computer-driven robots for solo practice and free drive.
 *
 * A bot is a CONTROLLER, not a sim feature: it reads the world exactly as a driver reads the
 * screen and produces an ordinary `RobotCommand`, which `GameController.stepSolo` localizes and
 * steps beside the player's own. That is the whole seam, and it is why nothing in `src/sim/` or
 * `src/games/` knows bots exist: the recorder stores their commands like anyone else's, so a
 * practice replay with bots in it re-simulates exactly, with no bot logic running at playback.
 *
 * It follows that a bot may keep MEMORY here (its current target, a stuck timer, the team's
 * role split) without breaking determinism — the log is the commands, not the reasoning that
 * produced them. It still uses no `Math.random`, so the same world produces the same bot.
 *
 * ── WHAT A BOT DOES, BY GAME ───────────────────────────────────────────────
 *  - DECODE: collects ground artifacts, lets the auto-fire assist empty the hopper from the
 *    launch zone, drains its OWN ramp through the gate when the classifier is full, and parks
 *    in its BASE for the endgame.
 *  - BIOBUZZ: collects POLLEN off the tiles or out of the bottom of a FLOWER, and its own
 *    NECTAR; stands outboard of its own HIVE's UP cell (so Aim Assist's "nearer cell" IS the
 *    up cell) and holds fire, going as soon as the hopper can finish a TIP. Its human player
 *    enters NECTAR whenever it is entitled to, and after the 1:00 cue the bot places NECTAR —
 *    and then POLLEN — into the FLOWER worth most with the Box Tube. Parks in its LOADING ZONE.
 *  - CHAIN REACTION: sweeps up PARTICLES and lets the auto-firing turret score them, then
 *    ASCENDS a Ring Stand for the endgame.
 *
 * ── LEVELS ─────────────────────────────────────────────────────────────────
 *  EASY drives slowly, reacts late and plays the simplest version of the game. NORMAL plays
 *  the whole game at a sensible pace. HARD drives flat out and COORDINATES: whenever the player
 *  is carrying something worth stopping, one bot drops back to DEFEND (see `BotTeam`). Bots
 *  never chase the same element at any level — that is basic competence, not difficulty.
 *
 * ── MANNERS ────────────────────────────────────────────────────────────────
 *  A bot never drives INTO another robot (`drive` removes that component and slides it round),
 *  so it cannot PIN anyone — G421 bills a MAJOR every 3 seconds and an early defender drew 36
 *  of them in one match. It stays on its own half in AUTO (G402 / G06), and a bot that is
 *  wedged on something backs out toward open floor (`unstick`).
 */
import * as C from '../config';
import { clamp, rot, wrapAngle } from '../math';
import { baseZone, driverSide, gateZone, goalCenter, goalSide, loadZone, tunnelStrip, viewAngleOf } from '../sim/field';
import type { Alliance, Artifact, RobotCommand, RobotState, Vec2, World } from '../types';
import type { BotLevel } from './botConfig';
import {
  BB_FLOWER_FOOT,
  BB_FLOWER_D,
  BB_FLOWER_UNLOCK_S,
  BB_FLOWERS,
  BB_FRAME_BAR_IN,
  BB_FRAME_BAR_OUT,
  BB_FRAME_Y,
  BB_HIVE_CELL_DY,
  BB_HIVE_X,
  BB_LZ,
  FLOWER_MOUTH,
} from '../games/biobuzz/config';
import { bbFlowerInReach, bbFootprint, bbPlacePointLocal } from '../games/biobuzz/robot';
import { flowerFits, flowerScore } from '../games/biobuzz/flower';
import type { BbElementKind } from '../games/biobuzz/flower';

export { BOT_LEVELS, MAX_OPPONENT_BOTS } from './botConfig';
export type { BotLevel } from './botConfig';

interface Tune {
  /** stick magnitude the bot drives at */
  speed: number;
  /** DECODE artifacts / BIOBUZZ pollen collected before going to shoot */
  load: number;
  /** how far any stick axis may move in one tick — the bot's hands */
  slew: number;
  /** ticks between re-plans: an easy bot reacts late */
  replan: number;
  /** BIOBUZZ flowers (retrieve + place), DECODE gate, human-player nectar */
  fullGame: boolean;
  /** team play: role split + defence (`BotTeam`) */
  coordinate: boolean;
}

const TUNE: Record<BotLevel, Tune> = {
  easy: { speed: 0.55, load: 1, slew: 0.06, replan: 12, fullGame: false, coordinate: false },
  normal: { speed: 0.8, load: 2, slew: 0.12, replan: 3, fullGame: true, coordinate: false },
  hard: { speed: 1, load: 3, slew: 0.25, replan: 1, fullGame: true, coordinate: true },
};

/** seconds without closing on a target before the bot gives up on it */
const STUCK_S = 2;
/** inches of progress that count as "closing" */
const STUCK_PROGRESS = 3;
/** how long a given-up target is ignored */
const BLACKLIST_S = 6;
/** a defender in contact this long backs off */
const DEFEND_CONTACT_S = 2.5;
/** longer than the pin rules' 3-second release (G421 / G422 criterion A), so a back-off ENDS a pin */
const DEFEND_BACKOFF_S = 3.6;
/** commanded but not moving for this long ⇒ wedged on something: back out */
const STALL_S = 0.9;
const STALL_SPEED = 4;
const ESCAPE_S = 0.7;
/** a role, once swapped, holds at least this long — no flapping between score and defend */
const ROLE_HOLD_S = 2.5;
/** ticks between two presses of a placement / human-player button (each press acts once) */
const PRESS_EVERY = 16;

type Target = { key: string; pos: Vec2 };

interface Memory {
  target: string | null;
  bestDist: number;
  lastProgressAt: number;
  /** target key -> world.time it is forgiven */
  blacklist: Map<string, number>;
  shootSince: number | null;
  contactSince: number | null;
  backoffUntil: number;
  stallSince: number | null;
  escapeUntil: number;
  escapeTo: Vec2;
  escapes: number;
  /** DECODE gate run: when the push started, and when it may next be tried */
  gateSince: number | null;
  gateApproach: number | null;
  gateCooldown: number;
  /** BIOBUZZ flower retrieval: when the hopper last grew while on the foot, and how full */
  pullSince: number | null;
  pullHopper: number;
  lastPress: number;
  /** the last planned command and when it was planned (EASY re-plans rarely) */
  plan: RobotCommand | null;
  planTick: number;
  /** the last command actually sent — what the slew limit moves from */
  sent: RobotCommand | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// THE TEAM — shared by every bot on the alliance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What bots on one alliance agree on: who is chasing which element (so two never go for the
 * same one) and, on HARD, which of them — if any — is defending right now.
 *
 * HARD DEFENCE IS A RESPONSE, NOT A POSTURE. A bot drops back only while the player is
 * CARRYING something (`threat`): the nearer bot of a pair takes it and the other keeps
 * scoring; a lone bot defends only when the player is also closing on their goal, because a
 * lone defender scores nothing. Swaps hold `ROLE_HOLD_S` so the two do not flap.
 */
export class BotTeam {
  readonly bots: OpponentBot[] = [];
  defenderId: number | null = null;
  private tick = -1;
  private switchedAt = -Infinity;

  update(world: World, playerId: number): void {
    if (world.tick === this.tick) return;
    this.tick = world.tick;
    const lead = this.bots[0];
    let want: number | null = null;
    if (lead && TUNE[lead.level].coordinate && world.match.phase !== 'auto') {
      const me = world.robots.find((r) => r.id === lead.robotId);
      const player = world.robots.find((r) => r.id === playerId && me && r.alliance !== me.alliance);
      if (player && threat(world, player)) {
        const near = (b: OpponentBot): number => {
          const r = world.robots.find((x) => x.id === b.robotId);
          return r ? Math.hypot(r.pos.x - player.pos.x, r.pos.y - player.pos.y) : Infinity;
        };
        if (this.bots.length >= 2) {
          want = [...this.bots].sort((a, b) => near(a) - near(b))[0].robotId;
        } else {
          const g = goalOf(world, player.alliance);
          if (Math.hypot(g.x - player.pos.x, g.y - player.pos.y) < 70) want = lead.robotId;
        }
      }
    }
    if (want !== this.defenderId && world.time - this.switchedAt >= ROLE_HOLD_S) {
      this.defenderId = want;
      this.switchedAt = world.time;
    }
  }

  /** the targets every OTHER bot on the team is chasing */
  claimedBy(except: OpponentBot): Set<string> {
    const s = new Set<string>();
    for (const b of this.bots) if (b !== except && b.target) s.add(b.target);
    return s;
  }
}

/** is the player carrying enough to be worth stopping? */
function threat(world: World, p: RobotState): boolean {
  const game = world.game ?? 'decode';
  if (game === 'biobuzz') return p.hopper.filter((c) => c !== 'red' && c !== 'blue').length >= 2;
  if (game === 'chain') return p.hopper.length >= 4;
  return p.hopper.length >= 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE BOT
// ─────────────────────────────────────────────────────────────────────────────

export class OpponentBot {
  /** the game of the world being driven — `drive` routes round BIOBUZZ's HIVE frame */
  private game = 'decode';
  /** every other robot this tick — `drive` never pushes into one */
  private others: RobotState[] = [];
  /** places this bot must not drive into, as circles `drive` treats like robots */
  private keepOut: { pos: Vec2; r: number }[] = [];
  /** set by a plan that is DELIBERATELY pressing into something (a gate, a FLOWER foot), so
   * `unstick` does not read the stall as being wedged */
  private pressing = false;
  private mem: Memory = {
    target: null,
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
    gateSince: null,
    gateApproach: null,
    gateCooldown: -1,
    pullSince: null,
    pullHopper: 0,
    lastPress: -Infinity,
    plan: null,
    planTick: -Infinity,
    sent: null,
  };

  constructor(
    readonly robotId: number,
    readonly level: BotLevel,
    /** which of the bots this is (0, 1) — spreads their spots so they do not stack */
    readonly slot: number,
    readonly team: BotTeam,
  ) {}

  /** the element / flower this bot is going for, for `BotTeam.claimedBy` */
  get target(): string | null {
    return this.mem.target;
  }

  private get tune(): Tune {
    return TUNE[this.level];
  }

  command(world: World, playerId: number): RobotCommand {
    this.game = world.game ?? 'decode';
    const r = world.robots.find((x) => x.id === this.robotId);
    const phase = world.match.phase;
    if (!r || phase === 'pre' || phase === 'transition' || phase === 'post') {
      this.mem.sent = null;
      this.mem.plan = null;
      return zeroCmd();
    }
    this.others = world.robots.filter((x) => x.id !== r.id);
    this.keepOut = keepOutZones(world, r.alliance);
    this.team.update(world, playerId);

    const m = this.mem;
    if (!m.plan || world.tick - m.planTick >= this.tune.replan) {
      m.plan = this.think(world, r, playerId);
      m.planTick = world.tick;
    }
    const out = this.hands(this.unstick(world, r, m.plan));
    // a re-used plan must not press a button twice: presses belong to the tick that planned them
    if (m.planTick !== world.tick) {
      out.bbPlace = false;
      out.bbPlaceNectar = false;
      out.bbNectar = false;
    }
    m.sent = out;
    return out;
  }

  /**
   * THE HANDS: no stick axis jumps further than `slew` in one tick. It is what makes a bot
   * drive like a person rather than a servo — and what makes an EASY bot visibly clumsy.
   * Buttons are not slewed.
   */
  private hands(cmd: RobotCommand): RobotCommand {
    const prev = this.mem.sent;
    if (!prev) return { ...cmd };
    const k = this.tune.slew;
    const step = (from: number, to: number): number => from + clamp(to - from, -k, k);
    return {
      ...cmd,
      driveX: step(prev.driveX, cmd.driveX),
      driveY: step(prev.driveY, cmd.driveY),
      rotate: step(prev.rotate, cmd.rotate),
      leftDrive: step(prev.leftDrive, cmd.leftDrive),
      rightDrive: step(prev.rightDrive, cmd.rightDrive),
    };
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
    if (asked < 0.3 || moving || this.pressing) {
      m.stallSince = null;
      return cmd;
    }
    m.stallSince ??= t;
    if (t - m.stallSince < STALL_S) return cmd;
    // toward the field centre, swung 60° one way or the other on alternate escapes
    m.escapes++;
    const cl = Math.hypot(r.pos.x, r.pos.y) || 1;
    const out = rot({ x: -r.pos.x / cl, y: -r.pos.y / cl }, (m.escapes % 2 ? 1 : -1) * (Math.PI / 3));
    m.escapeTo = clampField({ x: r.pos.x + out.x * 30, y: r.pos.y + out.y * 30 });
    m.escapeUntil = t + ESCAPE_S;
    m.stallSince = null;
    // whatever it was going for is evidently hard to reach from here
    if (m.target) m.blacklist.set(m.target, t + BLACKLIST_S / 2);
    m.target = null;
    return cmd;
  }

  private think(world: World, r: RobotState, playerId: number): RobotCommand {
    this.pressing = false;
    const phase = world.match.phase;
    const game = this.game;

    // ENDGAME: leave in time to arrive, not at a fixed second
    if (phase === 'teleop') {
      const park = parkSpot(game, r, this.slot);
      const d = Math.hypot(park.x - r.pos.x, park.y - r.pos.y);
      const leave = clamp(d / (28 * this.tune.speed) + 4, 6, 16);
      if (world.match.phaseTimeLeft <= leave) {
        this.mem.target = null;
        // BIOBUZZ: a bot already lined up on a FLOWER finishes placing first
        if (game === 'biobuzz' && world.match.phaseTimeLeft > 4) {
          const placing = this.bbPlaceIfLinedUp(world, r);
          if (placing) return placing;
        }
        return this.drive(r, park, parkFace(game, r), 1);
      }
    }

    if (this.team.defenderId === r.id) return this.defend(world, r, playerId);
    if (game === 'biobuzz') return this.bbPlay(world, r);
    if (game === 'chain') return this.chainPlay(world, r);
    return this.decodePlay(world, r);
  }

  // ------------------------------------------------------------------ DECODE ----

  private decodePlay(world: World, r: RobotState): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const teleop = world.match.phase === 'teleop';

    // DRAIN OUR OWN RAMP. Nine retained artifacts and everything else overflows for 1 point
    // instead of 3, so a full classifier is worth a trip to the gate — but not late in the
    // match, where the PATTERN on the ramp is what is being scored.
    const drain =
      this.tune.fullGame && teleop && t >= m.gateCooldown && world.match.phaseTimeLeft > 35 &&
      rampCount(world, r.alliance) >= 9 && r.hopper.length < 2;
    if (m.gateSince !== null || m.gateApproach !== null || drain) return this.openGate(world, r);

    const target = this.pickElement(world, r, (b) => b.state.kind === 'ground');
    const wantShoot = r.hopper.length >= this.tune.load || (r.hopper.length > 0 && !target);
    if (!wantShoot) {
      m.shootSince = null;
      return this.collect(world, r, target, true);
    }
    m.target = null;
    const spot = this.shootSpot(r.alliance);
    if (Math.hypot(spot.x - r.pos.x, spot.y - r.pos.y) < 6) m.shootSince ??= t;
    // auto-fire does the shooting; point the intake AWAY from the goal so the turret has room
    const g = goalCenter(r.alliance);
    const face = Math.atan2(r.pos.y - g.y, r.pos.x - g.x);
    // a hopper that will not empty must not park the bot forever
    if (m.shootSince !== null && t - m.shootSince > 4) {
      m.shootSince = null;
      return this.collect(world, r, target, true);
    }
    return this.drive(r, spot, face, 2);
  }

  /** push our OWN gate open: square up in front of the handle, then drive straight at the wall */
  private openGate(world: World, r: RobotState): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const g = goalSide(r.alliance);
    const edge = C.FIELD_HALF - C.CLASSIFIER_W;
    const stand = { x: g * (edge - r.spec.length / 2 - 4), y: 0.5 };
    const face = g > 0 ? 0 : Math.PI; // nose at the wall: only a STRAIGHT push lifts the arm
    if (m.gateSince === null) {
      const lined =
        Math.abs(r.pos.y - stand.y) < 2.5 &&
        Math.abs(r.pos.x - stand.x) < 3 &&
        Math.abs(wrapAngle(face - r.heading)) < 0.15;
      if (!lined) {
        m.target = null;
        m.gateApproach ??= t;
        if (t - m.gateApproach > 6) {
          // could not get lined up (traffic, a pile) — play on and look again later
          m.gateApproach = null;
          m.gateCooldown = t + 10;
          return this.drive(r, this.shootSpot(r.alliance), face, 2);
        }
        return this.drive(r, stand, face, 1, 0.05);
      }
      m.gateApproach = null;
      m.gateSince = t;
    }
    if (t - m.gateSince > 1.6 || rampCount(world, r.alliance) <= 2) {
      m.gateSince = null;
      m.target = null;
      m.gateCooldown = t + 10;
      return this.drive(r, { x: g * (edge - 30), y: 0 }, face, 1);
    }
    this.pressing = true;
    return this.drive(r, { x: g * C.FIELD_HALF, y: 0.5 }, face, 0);
  }

  /** inside the big launch triangle, on our goal's side, spread per bot */
  private shootSpot(a: Alliance): Vec2 {
    const g = goalSide(a);
    return this.slot === 0 ? { x: g * 14, y: 34 } : { x: g * 26, y: 50 };
  }

  // ----------------------------------------------------------------- BIOBUZZ ----

  private bbPlay(world: World, r: RobotState): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const bb = world.biobuzz;
    const a = r.alliance;
    const hive = bb?.hives?.[a];
    const teleop = world.match.phase === 'teleop';
    const left = world.match.phaseTimeLeft;
    const full = this.tune.fullGame;
    const flowerTime = full && teleop && left <= BB_FLOWER_UNLOCK_S;
    const canPlace = bbPlacePointLocal(r.spec) !== null;

    const pollen = r.hopper.filter((c) => c !== 'red' && c !== 'blue').length;
    const nectar = r.hopper.filter((c) => c === a).length;
    const held = pollen + nectar;

    // THE HUMAN PLAYER. One NECTAR per TIP, and the whole remaining stock from the 1:00 cue;
    // it lands in our LOADING ZONE for us to collect. NECTAR is worth having all match — three
    // of them in the up cell and three POLLEN tip it — so it is entered as soon as it is earned.
    const callNectar =
      !!bb && full && this.slot === 0 && bb.nectarStock[a] > 0 &&
      (bb.nectarDue[a] > 0 || flowerTime) && world.tick - m.lastPress >= PRESS_EVERY * 2;
    const withNectar = (cmd: RobotCommand): RobotCommand => {
      if (callNectar) {
        cmd.bbNectar = true;
        m.lastPress = world.tick;
      }
      return cmd;
    };

    // ── FLOWERS, after the 1:00 cue (G410: no NECTAR in a FLOWER before it) ──
    const tips = hive ? bbWouldTip(world, hive.contents, pollen, nectar) : false;
    if (flowerTime && canPlace && bb) {
      if (nectar > 0) {
        const f = this.bestFlower(world, r, 'nectar');
        if (f !== null) return withNectar(this.bbPlace(world, r, f, 'nectar', pollen));
      }
      // a TIP the hopper can finish is worth more than a few owned-flower points
      if (pollen > 0 && !tips) {
        const owned = this.bestFlower(world, r, 'pollen');
        if (owned !== null) return withNectar(this.bbPlace(world, r, owned, 'pollen', pollen));
      }
    }

    // our own NECTAR is worth picking up all match (the opponent's is refused — G408)
    const wanted = (b: Artifact): boolean =>
      b.state.kind === 'ground' && (b.color === 'red' || b.color === 'blue' ? b.color === a : true);
    let target = this.pickElement(world, r, wanted);
    // a FLOWER is a POLLEN store too: pull from the bottom of one we do not own
    let pull: number | null = null;
    if (full && bb && held < 4 && !flowerTime) {
      pull = this.bestRetrieve(world, r, target);
      if (pull !== null) target = null;
    }

    const load = Math.min(4, this.tune.load + 1);
    // after the cue, NECTAR is for the FLOWERS; only POLLEN is shot
    const shootable = flowerTime && canPlace ? pollen : held;
    const wantShoot =
      shootable > 0 && (shootable >= load || (!target && pull === null) || tips || held >= 4);
    if (!wantShoot || !hive || hive.tipping > 0) {
      m.shootSince = null;
      if (pull !== null) return withNectar(this.bbRetrieve(world, r, pull));
      return withNectar(this.collect(world, r, target, true));
    }

    // ── SHOOT: BIOBUZZ has no auto-fire; the driver HOLDS fire and Aim Assist lets a shot go
    //    only when it would land in the NEARER of our two cells. So stand where the nearer cell
    //    IS the up cell, on its open (outboard) side, and hold the button. ──
    m.target = null;
    const spot = this.bbShootSpot(a, hive.up);
    const d = Math.hypot(spot.x - r.pos.x, spot.y - r.pos.y);
    if (d < 8) m.shootSince ??= t;
    if (m.shootSince !== null && t - m.shootSince > 4) {
      // nothing is going in from here (blocked, a jam) — collect more and come back
      m.shootSince = null;
      return withNectar(this.collect(world, r, target, true));
    }
    const cell = { x: a === 'red' ? -BB_HIVE_X : BB_HIVE_X, y: 0 };
    const cmd = this.drive(r, spot, Math.atan2(cell.y - r.pos.y, cell.x - r.pos.x), 3);
    cmd.fire = d < 14;
    return withNectar(cmd);
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

  /**
   * THE FLOWER WORTH MOST for one more element of `kind`, net of the drive to it, or null.
   * NECTAR: taking a FLOWER from the opponent swings every element in it; claiming an empty
   * one adds the bottom-NECTAR bonus. POLLEN only ever goes where we already own the top.
   */
  private bestFlower(world: World, r: RobotState, kind: 'nectar' | 'pollen'): number | null {
    const bb = world.biobuzz;
    if (!bb) return null;
    const a = r.alliance;
    const kindOf = kindLookup(world);
    const claimed = this.team.claimedBy(this);
    let best: number | null = null;
    let bestV = -Infinity;
    for (let i = 0; i < BB_FLOWERS.length; i++) {
      const key = `flower:${i}`;
      if (claimed.has(key) || this.blacklisted(world, key)) continue;
      const stack = bb.flowers[i].stack;
      if (!flowerFits(stack, kindOf, 0)) continue;
      const sc = flowerScore(stack, kindOf);
      let gain: number;
      if (kind === 'pollen') {
        if (sc.owner !== a) continue;
        gain = 2;
      } else if (sc.owner === a) {
        gain = 2;
      } else if (sc.owner) {
        gain = (sc.inVolume + 1) * 4; // theirs becomes ours
      } else {
        gain = (sc.inVolume + 1) * 2 + (sc.bonusAlliance ? 0 : 5);
      }
      const p = this.placePose(r, i);
      let v = gain - Math.hypot(p.pos.x - r.pos.x, p.pos.y - r.pos.y) / 12;
      // one with an opponent parked on it is one we would have to shove them off
      for (const o of this.others) {
        if (o.alliance !== a && Math.hypot(o.pos.x - p.pos.x, o.pos.y - p.pos.y) < 20) v -= 20;
      }
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    return best;
  }

  /** where the robot's centre goes, and which way it faces, for its Box Tube to be on flower `i` */
  private placePose(r: RobotState, i: number): { pos: Vec2; heading: number } {
    const f = BB_FLOWERS[i];
    const n = FLOWER_MOUTH[f.wall];
    const pl = bbPlacePointLocal(r.spec) ?? { x: -10, y: 0 };
    // turn so the placement point faces the wall (−n), then stand it on the ring
    const heading = Math.atan2(-n.y, -n.x) - Math.atan2(pl.y, pl.x);
    const off = rot(pl, heading);
    return { pos: { x: f.x - off.x, y: f.y - off.y }, heading };
  }

  /** back the Box Tube onto flower `i` and press the placement button once it is in reach */
  private bbPlace(world: World, r: RobotState, i: number, kind: 'nectar' | 'pollen', pollen: number): RobotCommand {
    const m = this.mem;
    const key = `flower:${i}`;
    if (m.target !== key) {
      m.target = key;
      m.bestDist = Infinity;
      m.lastProgressAt = world.time;
    }
    const pose = this.placePose(r, i);
    const d = Math.hypot(pose.pos.x - r.pos.x, pose.pos.y - r.pos.y);
    this.progress(world, d, 8);
    const cmd = this.drive(r, pose.pos, pose.heading, 0.3, 0.06);
    if (bbFlowerInReach(world, r) === i) {
      m.lastProgressAt = world.time; // lined up is progress, however long the stack takes
      this.pressing = true;
      if (world.tick - m.lastPress >= PRESS_EVERY) {
        m.lastPress = world.tick;
        // NECTAR first (it makes the FLOWER ours), then the POLLEN rides on the ownership
        if (kind === 'nectar') cmd.bbPlaceNectar = true;
        else if (pollen > 0) cmd.bbPlace = true;
      }
    }
    return cmd;
  }

  /** already on a FLOWER with something useful in the hopper? keep placing (the endgame uses it) */
  private bbPlaceIfLinedUp(world: World, r: RobotState): RobotCommand | null {
    const i = bbFlowerInReach(world, r);
    if (i === null || !world.biobuzz || world.match.phaseTimeLeft > BB_FLOWER_UNLOCK_S) return null;
    const a = r.alliance;
    const nectar = r.hopper.filter((c) => c === a).length;
    const pollen = r.hopper.filter((c) => c !== 'red' && c !== 'blue').length;
    const owner = flowerScore(world.biobuzz.flowers[i].stack, kindLookup(world)).owner;
    if (nectar > 0) return this.bbPlace(world, r, i, 'nectar', pollen);
    if (pollen > 0 && owner === a) return this.bbPlace(world, r, i, 'pollen', pollen);
    return null;
  }

  /**
   * The FLOWER to pull POLLEN from, if one beats the nearest loose element: a POLLEN at the
   * bottom (a NECTAR there locks it), not ours to lose, and not claimed by a teammate.
   */
  private bestRetrieve(world: World, r: RobotState, ground: Target | null): number | null {
    const bb = world.biobuzz;
    if (!bb) return null;
    const kindOf = kindLookup(world);
    const claimed = this.team.claimedBy(this);
    const groundD = ground ? Math.hypot(ground.pos.x - r.pos.x, ground.pos.y - r.pos.y) : Infinity;
    let best: number | null = null;
    // a stack of pollen is worth a longer drive than one loose element
    let bestD = groundD + 15;
    for (let i = 0; i < BB_FLOWERS.length; i++) {
      const key = `pull:${i}`;
      if (claimed.has(key) || this.blacklisted(world, key)) continue;
      const stack = bb.flowers[i].stack;
      if (stack.length === 0 || kindOf(stack[0]) !== 'pollen') continue;
      if (flowerScore(stack, kindOf).owner === r.alliance) continue;
      if (world.match.phase === 'auto' && BB_FLOWERS[i].x * ownSide(world, r.alliance) < 0) continue;
      const p = this.pullPose(r, i).pos;
      const d = Math.hypot(p.x - r.pos.x, p.y - r.pos.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** nose square on the FLOWER foot, so the front sweeper sits on the retrieval opening */
  private pullPose(r: RobotState, i: number): { pos: Vec2; heading: number; face: Vec2 } {
    const f = BB_FLOWERS[i];
    const n = FLOWER_MOUTH[f.wall];
    const out = BB_FLOWER_FOOT.deep - BB_FLOWER_D;
    const face = { x: f.x + n.x * out, y: f.y + n.y * out };
    const front = bbFootprint(r.spec).front;
    return {
      pos: { x: face.x + n.x * (front + 0.5), y: face.y + n.y * (front + 0.5) },
      heading: Math.atan2(-n.y, -n.x),
      face,
    };
  }

  private bbRetrieve(world: World, r: RobotState, i: number): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const key = `pull:${i}`;
    if (m.target !== key) {
      m.target = key;
      m.bestDist = Infinity;
      m.lastProgressAt = t;
      m.pullSince = null;
    }
    const pose = this.pullPose(r, i);
    const d = Math.hypot(pose.pos.x - r.pos.x, pose.pos.y - r.pos.y);
    const aligned = d < 2.5 && Math.abs(wrapAngle(pose.heading - r.heading)) < 0.2;
    if (!aligned) {
      m.pullSince = null;
      this.progress(world, d, 6);
      const cmd = this.drive(r, pose.pos, pose.heading, 0.4, 0.06);
      cmd.intake = d < 12;
      return cmd;
    }
    // on the foot: lean in gently with the rollers running until the stack stops giving
    if (m.pullSince === null || r.hopper.length > m.pullHopper) {
      m.pullSince = t;
      m.pullHopper = r.hopper.length;
    }
    m.lastProgressAt = t;
    if (t - m.pullSince > 1.5) {
      m.blacklist.set(key, t + BLACKLIST_S);
      m.target = null;
    }
    this.pressing = true;
    const cmd = this.drive(r, pose.face, pose.heading, 0, 0.15);
    const mag = Math.hypot(cmd.driveX, cmd.driveY);
    if (mag > 0.3) {
      cmd.driveX *= 0.3 / mag;
      cmd.driveY *= 0.3 / mag;
    }
    cmd.intake = true;
    return cmd;
  }

  // ---------------------------------------------------------- CHAIN REACTION ----

  /** sweep up PARTICLES; the turret's auto-fire scores them from anywhere */
  private chainPlay(world: World, r: RobotState): RobotCommand {
    const target = this.pickElement(world, r, (b) => b.state.kind === 'ground');
    return this.collect(world, r, target, true);
  }

  // ------------------------------------------------------------- collecting ----

  private collect(world: World, r: RobotState, target: Target | null, intake: boolean): RobotCommand {
    const m = this.mem;
    if (!target) {
      // nothing to pick up: wait somewhere central on our own side, out of everyone's way
      m.target = null;
      const cmd = this.drive(r, idleSpot(this.game, world, r.alliance, this.slot), r.heading, 4);
      cmd.intake = intake;
      return cmd;
    }
    if (m.target !== target.key) {
      m.target = target.key;
      m.bestDist = Infinity;
      m.lastProgressAt = world.time;
    }
    const d = Math.hypot(target.pos.x - r.pos.x, target.pos.y - r.pos.y);
    this.progress(world, d, 0);
    // AGAINST A WALL: square up first, then drive straight in. Come at it on an angle and the
    // chassis corner reaches it before the sweeper does and just shoves it along the wall —
    // which is exactly where a human player's NECTAR and a GARDEN's POLLEN sit.
    const n = wallNormal(target.pos);
    if (n) {
      const face = Math.atan2(-n.y, -n.x);
      const reach = this.frontReach(r);
      const rx = r.pos.x - target.pos.x;
      const ry = r.pos.y - target.pos.y;
      const along = rx * n.x + ry * n.y;
      const lateral = Math.abs(rx * -n.y + ry * n.x);
      const square = Math.abs(wrapAngle(face - r.heading)) < 0.25;
      if (lateral > 2.5 || !square || along < reach - 1) {
        const stage = { x: target.pos.x + n.x * (reach + 8), y: target.pos.y + n.y * (reach + 8) };
        const cmd = this.drive(r, stage, face, 1, 0.1);
        cmd.intake = intake;
        return cmd;
      }
      const cmd = this.drive(r, target.pos, face, 0, 0.35);
      cmd.intake = intake;
      return cmd;
    }
    const face = Math.atan2(target.pos.y - r.pos.y, target.pos.x - r.pos.x);
    const cmd = this.drive(r, target.pos, face, 0);
    cmd.intake = intake;
    return cmd;
  }

  /** chassis centre to the front of the intake */
  private frontReach(r: RobotState): number {
    return this.game === 'biobuzz' ? bbFootprint(r.spec).front : r.spec.length / 2 + 3;
  }

  /** stuck-on-target bookkeeping: no progress for `STUCK_S` ⇒ blacklist it for a while */
  private progress(world: World, d: number, slack: number): void {
    const m = this.mem;
    if (d < m.bestDist - STUCK_PROGRESS || d < slack) {
      m.bestDist = Math.min(m.bestDist, d);
      m.lastProgressAt = world.time;
    } else if (world.time - m.lastProgressAt > STUCK_S && m.target) {
      m.blacklist.set(m.target, world.time + BLACKLIST_S);
      m.target = null;
    }
  }

  private blacklisted(world: World, key: string): boolean {
    const until = this.mem.blacklist.get(key);
    if (until === undefined) return false;
    if (world.time < until) return true;
    this.mem.blacklist.delete(key);
    return false;
  }

  /** the nearest loose element this bot may legally and usefully chase, and no teammate is */
  private pickElement(world: World, r: RobotState, wanted: (b: Artifact) => boolean): Target | null {
    const m = this.mem;
    const auto = world.match.phase === 'auto';
    const side = ownSide(world, r.alliance);
    const claimed = this.team.claimedBy(this);
    // BIOBUZZ stages its GARDEN pollen against the wall and has little else loose, so its bots
    // try those too — the stuck timer gives up on a bad one
    const wall = this.game === 'biobuzz' ? 1 : this.game === 'chain' ? 3 : 4;
    let best: Target | null = null;
    let bestD = Infinity;
    for (const b of world.balls) {
      if (!wanted(b)) continue;
      const key = `ball:${b.id}`;
      if (claimed.has(key) || this.blacklisted(world, key)) continue;
      // own half in AUTO (G402 / G06)
      if (auto && b.pos.x * side < -2) continue;
      if (Math.abs(b.pos.x) > C.FIELD_HALF - wall || Math.abs(b.pos.y) > C.FIELD_HALF - wall) continue;
      if (this.keepOut.some((z) => Math.hypot(b.pos.x - z.pos.x, b.pos.y - z.pos.y) < z.r + halfDiag(r))) continue;
      // the OPPONENT'S LOADING ZONE is where their human player feeds them: going in there
      // means contact with them in a protected zone (G426), and in BIOBUZZ it is their NECTAR
      if (inOpponentLoading(this.game, r.alliance, b.pos)) continue;
      let d = Math.hypot(b.pos.x - r.pos.x, b.pos.y - r.pos.y);
      // stick with the current target unless something is clearly closer (no dithering)
      if (key === m.target) d -= 8;
      // one sitting against an opponent is one you cannot reach without shoving it
      for (const o of this.others) {
        if (o.alliance !== r.alliance && Math.hypot(b.pos.x - o.pos.x, b.pos.y - o.pos.y) < halfDiag(o) + 12) d += 60;
      }
      if (d < bestD) {
        bestD = d;
        best = { key, pos: b.pos };
      }
    }
    return best;
  }

  // --------------------------------------------------------------- defending ----

  private defend(world: World, r: RobotState, playerId: number): RobotCommand {
    const m = this.mem;
    const t = world.time;
    m.target = null;
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
    if (dist < reach + 2) m.contactSince ??= t;
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
    // THEIR PROTECTED ZONES ARE OFF LIMITS. Contact while the victim is in its own gate zone,
    // loading zone, tunnel or (endgame) base fouls the DEFENDER whoever initiates it (G424 /
    // G426 / G425 / G427 — a MAJOR, that last one), so wait just outside instead of following.
    if (inProtectedZone(world, victim)) {
      const k = (reach + 14) / (dist || 1);
      return this.drive(r, clampField({ x: victim.pos.x - dx * k, y: victim.pos.y - dy * k }), face, 2);
    }
    // stand on the line from the victim to ITS goal, a little ahead of it
    const g = goalOf(world, victim.alliance);
    const gx = g.x - victim.pos.x;
    const gy = g.y - victim.pos.y;
    const gl = Math.hypot(gx, gy) || 1;
    const ahead = Math.min(20, gl * 0.5);
    const spot = clampField({ x: victim.pos.x + (gx / gl) * ahead, y: victim.pos.y + (gy / gl) * ahead });
    // BLOCK, DON'T SHOVE: `drive` never pushes into another robot
    return this.drive(r, spot, face, 0);
  }

  // ------------------------------------------------------------------- drive ----

  /**
   * Drive toward `to` and turn toward `face`. The command is FIELD-centric (bots spawn with
   * `fieldCentric`), so the field-frame direction is rotated INTO the driver frame the sim
   * rotates back out of (`updateRobot`: `fieldVec = rot(stick, -viewAngle)`). `creep` is the
   * slowest fraction of top speed it closes the last foot at — small for precise work.
   */
  private drive(r: RobotState, to: Vec2, face: number, arrive: number, creep = 0.3): RobotCommand {
    const cmd = zeroCmd();
    const vmax = this.tune.speed;
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
      // intake meets the element nose-first rather than with a flank
      const align = 1 - 0.5 * Math.min(1, Math.abs(turnErr) / Math.PI);
      const s = vmax * clamp(d / 12, creep, 1) * align;
      fx = (dx / dv) * s;
      fy = (dy / dv) * s;
    }
    // NEVER SHOVE ANOTHER ROBOT: within reach of one, any drive toward it is removed and
    // turned SIDEWAYS (toward whichever side the target lies), so a robot in the way is driven
    // round, not through. Pushing a robot against something is a PIN.
    const obstacles = [
      ...this.others.map((o) => ({ pos: o.pos, r: halfDiag(o) + 6 })),
      ...this.keepOut,
    ];
    for (const o of obstacles) {
      const R = halfDiag(r) + o.r;
      const nx = o.pos.x - r.pos.x;
      const ny = o.pos.y - r.pos.y;
      const nd = Math.hypot(nx, ny) || 1;
      if (nd >= R) continue;
      const ux = nx / nd;
      const uy = ny / nd;
      const toward = fx * ux + fy * uy;
      if (toward <= 0) continue;
      fx -= toward * ux;
      fy -= toward * uy;
      const side = dx * -uy + dy * ux >= 0 ? 1 : -1;
      fx += side * -uy * toward * 0.8;
      fy += side * ux * toward * 0.8;
    }

    const tank = r.spec.drivetrain === 'tank' || (r.spec.drivetrain === 'butterfly' && r.butterflyTank);
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
    let stick: Vec2;
    if (r.fieldCentric) {
      stick = rot({ x: fx, y: fy }, viewAngleOf(r.alliance));
    } else {
      // robot-centric: stick up = robot forward, stick right = robot right
      const local = rot({ x: fx, y: fy }, -r.heading);
      stick = { x: -local.y, y: local.x };
    }
    cmd.driveX = clamp(stick.x, -1, 1);
    cmd.driveY = clamp(stick.y, -1, 1);
    cmd.rotate = turn;
    return cmd;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD KNOWLEDGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a bot must never go (DECODE):
 *  - the OPPONENT'S GATE. Touching its arm is a MAJOR on its own (G417) and opening it bills a
 *    MAJOR per artifact that drains (G418.B) — and artifacts that roll out beneath it are
 *    exactly what a collecting bot would otherwise wander over to;
 *  - the OPPONENT'S BASE, in the endgame, when any contact with a robot in it is a MAJOR
 *    (G427) and the opponent is about to park there.
 */
function keepOutZones(world: World, a: Alliance): { pos: Vec2; r: number }[] {
  if ((world.game ?? 'decode') !== 'decode') return [];
  const opp: Alliance = a === 'red' ? 'blue' : 'red';
  const g = goalSide(opp);
  const zones = [{ pos: { x: g * (C.FIELD_HALF - C.CLASSIFIER_W), y: 0.5 }, r: 12 }];
  if (world.match.phase === 'teleop' && world.match.phaseTimeLeft <= C.ENDGAME_START + 3) {
    zones.push({ pos: { x: driverSide(opp) * C.BASE_CENTER.x, y: C.BASE_CENTER.y }, r: 16 });
  }
  return zones;
}

/** is `p` inside the loading zone of `a`'s OPPONENT? */
function inOpponentLoading(game: string, a: Alliance, p: Vec2): boolean {
  const opp: Alliance = a === 'red' ? 'blue' : 'red';
  const z = game === 'biobuzz' ? BB_LZ[opp] : game === 'decode' ? loadZone(opp) : null;
  return !!z && p.x > z.x0 - 4 && p.x < z.x1 + 4 && p.y > z.y0 - 4 && p.y < z.y1 + 4;
}

/** is any part of `v` in one of ITS OWN protected zones, where touching it fouls the toucher? */
function inProtectedZone(world: World, v: RobotState): boolean {
  const game = world.game ?? 'decode';
  const pad = halfDiag(v);
  const inRect = (z: { x0: number; x1: number; y0: number; y1: number }): boolean =>
    v.pos.x > z.x0 - pad && v.pos.x < z.x1 + pad && v.pos.y > z.y0 - pad && v.pos.y < z.y1 + pad;
  if (game === 'biobuzz') return inRect(BB_LZ[v.alliance]);
  if (game !== 'decode') return false;
  const opp: Alliance = v.alliance === 'red' ? 'blue' : 'red';
  // the TUNNEL under the opponent's goal is the victim's (tunnelStrip(X) is owned by other(X))
  return inRect(gateZone(v.alliance)) || inRect(loadZone(v.alliance)) || inRect(baseZone(v.alliance)) || inRect(tunnelStrip(opp));
}

/** +1 / −1: which half of the field is `a`'s own (AUTO stays there) */
function ownSide(world: World, a: Alliance): number {
  const game = world.game ?? 'decode';
  // BIOBUZZ (G304.A) and Chain Reaction put red at x < 0; DECODE puts an alliance on its GOAL side
  if (game === 'biobuzz' || game === 'chain') return a === 'red' ? -1 : 1;
  return goalSide(a);
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

/** where each game's endgame points are: DECODE BASE, BIOBUZZ LOADING ZONE, CR Ring Stand */
function parkSpot(game: string, r: RobotState, slot: number): Vec2 {
  const a = r.alliance;
  if (game === 'biobuzz') return a === 'red' ? { x: -60, y: 36 - slot * 8 } : { x: 60, y: -36 + slot * 8 };
  if (game === 'chain') {
    // ALONGSIDE a corner Ring Stand assembly on our side, square to the wall, as close as the
    // chassis allows: "ascended" is slow AND within CHAIN_ASCEND_R of the corner block, and
    // a spot a few inches out reads as merely parked in the Lab Area
    const sx = a === 'red' ? -1 : 1;
    const sy = slot === 0 ? 1 : -1;
    const block = C.FIELD_HALF - 6; // the assembly's inner face (CHAIN_RINGSTAND_BOX 6)
    return { x: sx * (block - r.spec.length / 2 - 1), y: sy * (C.FIELD_HALF - r.spec.width / 2 - 1) };
  }
  return { x: driverSide(a) * C.BASE_CENTER.x, y: C.BASE_CENTER.y + slot * 2 };
}

/** which way to face when parked: square to the walls in CR (so the footprint fits the spot) */
function parkFace(game: string, r: RobotState): number {
  if (game === 'chain') return r.alliance === 'red' ? 0 : Math.PI;
  return r.heading;
}

/** somewhere to wait with nothing to do: central, on our own side */
function idleSpot(game: string, world: World, a: Alliance, slot: number): Vec2 {
  if (game === 'decode') return { x: goalSide(a) * (14 + slot * 12), y: 34 + slot * 16 };
  return { x: ownSide(world, a) * (36 + slot * 8), y: slot === 0 ? 30 : -30 };
}

/** the inward normal of the wall `p` is hugging (within 7 in of), or null in open floor */
function wallNormal(p: Vec2): Vec2 | null {
  const gap = C.FIELD_HALF - 7;
  const ex = Math.abs(p.x) - gap;
  const ey = Math.abs(p.y) - gap;
  if (ex <= 0 && ey <= 0) return null;
  return ex >= ey ? { x: -Math.sign(p.x), y: 0 } : { x: 0, y: -Math.sign(p.y) };
}

/** DECODE: classified artifacts retained on `a`'s ramp */
function rampCount(world: World, a: Alliance): number {
  let n = 0;
  for (const b of world.balls) if (b.state.kind === 'rail' && b.state.goal === a && !b.state.overflow) n++;
  return n;
}

function kindLookup(world: World): (id: number) => BbElementKind {
  const byId = new Map(world.balls.map((b) => [b.id, b] as const));
  return (id) => {
    const c = byId.get(id)?.color;
    return c === 'red' || c === 'blue' ? c : 'pollen';
  };
}

/** POLLEN needed to TIP, indexed by NECTAR in the cell (the measured table, reference §4.1) */
const BB_TIP_NEED = [8, 7, 6, 3, 1, 0];

/** would the up cell TIP with everything in the hopper added to what it already holds? */
function bbWouldTip(world: World, contents: readonly number[], pollen: number, nectar: number): boolean {
  const kindOf = kindLookup(world);
  let n = nectar;
  let p = pollen;
  for (const id of contents) {
    if (kindOf(id) === 'pollen') p++;
    else n++;
  }
  return p >= BB_TIP_NEED[Math.min(n, 5)];
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
    // the target itself is in the keep-out (a pollen by the bar): go straight, and let the
    // stuck timer be the backstop
    if (inBox(to, b)) continue;
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
        Math.hypot(c.x - p.x, c.y - p.y) + Math.hypot(to.x - c.x, to.y - c.y) + (segHitsBox(c, to, b) ? 1000 : 0);
      if (len < bestLen) {
        bestLen = len;
        best = c;
      }
    }
    return best ?? to;
  }
  return to;
}

function halfDiag(r: RobotState): number {
  return Math.hypot(r.spec.length, r.spec.width) / 2;
}

function clampField(p: Vec2): Vec2 {
  const m = C.FIELD_HALF - 12;
  return { x: clamp(p.x, -m, m), y: clamp(p.y, -m, m) };
}

/** Build the bots for a set of opponent ids, as one coordinated team. */
export function makeBots(ids: number[], level: BotLevel): OpponentBot[] {
  const team = new BotTeam();
  const bots = ids.map((id, i) => new OpponentBot(id, level, i, team));
  team.bots.push(...bots);
  return bots;
}
