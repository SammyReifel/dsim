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
  BB_GARDEN,
  bbHopperCap,
  FLOWER_MOUTH,
} from '../games/biobuzz/config';
import { bbFlowerInReach, bbMouths, bbPlacePointLocal } from '../games/biobuzz/robot';
import { bbIntakeAccepts, bbLauncherOf } from '../games/biobuzz/mechs';
import { chainIntakeMouths } from '../games/chain/state';
import { bbFootprintGap } from '../games/biobuzz/penalties';
import { BB_TIP_RELEASE_S } from '../games/biobuzz/hive';
import { driveIntent } from '../sim/physics';
import type { RobotSpec } from '../types';
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
  /** BIOBUZZ: a turret holds fire while it collects (shoots on the move), and a loaded bot
   * heads for the next up cell while the HIVE is still swinging. The two habits that separate
   * a good driver from a merely fast one. */
  sharp: boolean;
  /** the lead over the player's alliance the team must hold before it spends a robot on
   * defence. HARD defends whatever the score; NIGHTMARE only once it is winning, so a bot is
   * never parked in front of you while its alliance falls behind. */
  defendLead: number;
  /** NIGHTMARE's kit (BIOBUZZ). Each is one habit of a driver who plays the OPPONENT, not
   * just the field:
   *  - `starve`: take the POLLEN you are about to reach (when we get there first), your
   *    GARDEN's, and the FLOWERS on your side — every element we take is one you do not shoot;
   *  - `harass`: body-block you while you are loaded and we have nothing to deliver, i.e. only
   *    when it costs you more than it costs us;
   *  - `clutch`: in the last seconds, only park if there is no TIP left to start (a TIP is 20,
   *    PARK is 5), and leave for the park at the last moment rather than early;
   *  - `scoreAware`: behind late, stop blocking and parking and go all-in on scoring; ahead
   *    late, spend the spare robot-time protecting the lead. */
  starve: boolean;
  harass: boolean;
  clutch: boolean;
  scoreAware: boolean;
}

const TUNE: Record<BotLevel, Tune> = {
  easy: { speed: 0.4, load: 1, slew: 0.035, replan: 24, fullGame: false, sharp: false, coordinate: false, defendLead: Infinity,
    starve: false, harass: false, clutch: false, scoreAware: false },
  normal: { speed: 0.62, load: 2, slew: 0.07, replan: 8, fullGame: true, sharp: false, coordinate: false, defendLead: Infinity,
    starve: false, harass: false, clutch: false, scoreAware: false },
  hard: { speed: 0.92, load: 3, slew: 0.22, replan: 2, fullGame: true, sharp: true, coordinate: true, defendLead: -Infinity,
    starve: false, harass: false, clutch: true, scoreAware: false },
  nightmare: { speed: 1, load: 3, slew: 1, replan: 1, fullGame: true, sharp: true, coordinate: true, defendLead: Infinity,
    starve: false, harass: false, clutch: true, scoreAware: true },
};

/**
 * BIOBUZZ drives the lower levels slower than the other games do: with the whole kit its
 * Normal scored within a tip of Hard. The ladder is the numbers in `LEVEL_KNOBS`' note.
 */
const BB_TUNE: Record<BotLevel, Tune> = {
  easy: { ...TUNE.easy, speed: 0.35 },
  normal: { ...TUNE.normal, speed: 0.55 },
  hard: { ...TUNE.hard, speed: 0.85 },
  nightmare: TUNE.nightmare,
};

/**
 * THE TUNING KNOBS — the numbers the BIOBUZZ brain's choices turn on, in one place so a variant
 * can be raced against the defaults head to head (`makeBots(..., knobs)`; the tuning arena does
 * exactly that) instead of edited in and eyeballed. The defaults are the measured winners.
 */
export interface BotKnobs {
  /** inches of drive a NECTAR pickup is worth, to a build that can shoot it */
  nectarBonus: number;
  /** inches a pickup already inside a TURRET's firing zone is worth */
  zoneBonus: number;
  /** fraction of the trip from a pickup to the firing zone charged to that pickup */
  zoneTrip: number;
  /** inches per neighbouring element (up to three) a pickup is worth */
  cluster: number;
  /** inches of preference for the element already being chased (no dithering) */
  sticky: number;
  /** inches per POLLEN in a FLOWER stack that pulling from it is worth */
  pullStack: number;
  /** a pickup within this many inches beats repositioning during a HIVE swing */
  swingGrab: number;
  /** seconds with nothing leaving the hopper before a shooter moves spot */
  shootStall: number;
  /** fire at the RISING cell this many seconds before the swing passes level (<0: wait for the swing to end) */
  preFire: number;
  /** the same lead for a DUMPER, whose lob spends longer in the air */
  preFireDump: number;
  /** empty bots wait where our own spill lands, intake to the HIVE (the mouth line, in from the wall) */
  spillWait: boolean;
  /** ...and at the OPPONENT'S spill, when ours is not coming */
  spillSteal: boolean;
  spillY: number;
  /** end AUTO parked in the LOADING ZONE (+5), clear of the wall (LEAVE stays) */
  autoPark: boolean;
  /** top up during a HIVE swing only with pickups that still get us back in time */
  swingPlan: boolean;
  /** fire as soon as the whole TEAM's load tips the HIVE, not each bot's own */
  teamTip: boolean;
  /** a PAIR splits the field: slot 0 works near our HIVE, slot 1 fetches from far away */
  roleSplit: boolean;
  /** overrides for the level's own settings (undefined = the level decides) */
  defendLead?: number;
  starve?: boolean;
  harass?: boolean;
}

export const DEFAULT_KNOBS: BotKnobs = {
  nectarBonus: 22,
  zoneBonus: 10,
  zoneTrip: 0.35,
  cluster: 4,
  sticky: 8,
  pullStack: 6,
  swingGrab: 30,
  shootStall: 1.5,
  preFire: 0.4,
  preFireDump: 0.9,
  spillWait: true,
  spillSteal: true,
  spillY: 34,
  autoPark: false,
  swingPlan: true,
  teamTip: true,
  roleSplit: false,
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
  /** when the bot got CLOSE to a pose it needs to be exactly on (a FLOWER) without making it */
  nearSince: number | null;
  /** which alternative shooting spot the bot is trying (after one that did not work) */
  shootShift: number;
  /** closest the bot has come to its shooting spot, and when — "is it getting there?" */
  spotBest: number;
  spotAt: number;
  /** hopper count at the last shot, and when it last changed — "is anything leaving?" */
  shootHop: number;
  shootLastAt: number;
  /** NIGHTMARE's opportunistic block: until when, and when it may start another */
  harassUntil: number;
  harassCooldown: number;
  /** the stuck watchdog: where the bot was, and when */
  anchor: Vec2;
  anchorAt: number;
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
 * DEFENCE IS A RESPONSE, NOT A POSTURE. A bot drops back only while the player is CARRYING
 * something (`threat`): the nearer bot of a pair takes it and the other keeps scoring; a lone
 * bot defends only when the player is also closing on their goal, because a lone defender
 * scores nothing. `defendLead` is the lead that buys a defender. NIGHTMARE never pays it:
 * measured head to head, a Nightmare pair that dropped a bot back once 15 ahead lost 16 points
 * a match to one that kept both scoring, so it is always playing to win, never to annoy.
 * Swaps hold `ROLE_HOLD_S` so the two do not flap.
 */
export class BotTeam {
  readonly bots: OpponentBot[] = [];
  defenderId: number | null = null;
  private tick = -1;
  private switchedAt = -Infinity;

  update(world: World, playerId: number): void {
    if (world.tick === this.tick) return;
    this.tick = world.tick;
    const first = this.bots[0];
    let want: number | null = null;
    if (first && TUNE[first.level].coordinate && world.match.phase !== 'auto') {
      const me = world.robots.find((r) => r.id === first.robotId);
      const player = world.robots.find((r) => r.id === playerId && me && r.alliance !== me.alliance);
      const lead = me && player
        ? world.match.scores[me.alliance].total - world.match.scores[player.alliance].total
        : 0;
      if (player && threat(world, player) && lead >= (first.knobs.defendLead ?? TUNE[first.level].defendLead)) {
        const near = (b: OpponentBot): number => {
          const r = world.robots.find((x) => x.id === b.robotId);
          return r ? Math.hypot(r.pos.x - player.pos.x, r.pos.y - player.pos.y) : Infinity;
        };
        // A LONE BOT NEVER DEFENDS BY ROLE — a lone defender scores nothing, and every second it
        // spends in front of you is a second you are not being outscored. It still defends when
        // there is nothing left to collect (`bbPlay`'s idle branch).
        if (this.bots.length >= 2) want = [...this.bots].sort((a, b) => near(a) - near(b))[0].robotId;
      }
    }
    // NO DEFENCE INTO THE ENDGAME. The player is about to park, and in DECODE any contact with a
    // robot in its BASE is a MAJOR (G427) — so the defender is called off at once, not after
    // the usual role hold.
    const late = world.match.phase === 'teleop' && world.match.phaseTimeLeft <= C.ENDGAME_START + 5;
    if (late) want = null;
    if (want !== this.defenderId && (late || world.time - this.switchedAt >= ROLE_HOLD_S)) {
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

/** is the player carrying enough to be worth stopping — and actually going somewhere with it? */
function threat(world: World, p: RobotState): boolean {
  const game = world.game ?? 'decode';
  if (game === 'biobuzz') {
    // a robot sitting still with a full hopper is not a threat to anybody; one on the move, or
    // already where its shots land, is
    const up = world.biobuzz?.hives?.[p.alliance]?.up ?? 'north';
    const s = up === 'south' ? -1 : 1;
    const moving = Math.hypot(p.vel.x, p.vel.y) > 10;
    return p.hopper.filter((c) => c !== 'red' && c !== 'blue').length >= 2 && (moving || s * p.pos.y >= 20);
  }
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
  /** BIOBUZZ AUTO: the sign of x that is our half (G402), or 0 when the line is open */
  private autoSide = 0;
  /** set by a plan that is DELIBERATELY pressing into something (a gate, a FLOWER foot), so
   * `unstick` does not read the stall as being wedged */
  private pressing = false;
  /** set by a plan that is DELIBERATELY standing still (shooting, placing, parked, waiting), so
   * the stuck watchdog leaves it alone */
  private holding = false;
  /** the robot this bot's team plays against (the player), for idle defence */
  private victim = -1;
  /** what the bot is doing, for diagnostics */
  status = '';
  /** a tank's last forward/reverse choice, for hysteresis */
  private tankRev = false;
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
    nearSince: null,
    shootShift: 0,
    shootHop: -1,
    spotBest: Infinity,
    spotAt: 0,
    shootLastAt: 0,
    harassUntil: -1,
    harassCooldown: -1,
    anchor: { x: 0, y: 0 },
    anchorAt: 0,
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
    readonly knobs: BotKnobs = DEFAULT_KNOBS,
  ) {}

  /** the element / flower this bot is going for, for `BotTeam.claimedBy` */
  get target(): string | null {
    return this.mem.target;
  }

  private get tune(): Tune {
    return this.game === 'biobuzz' ? BB_TUNE[this.level] : TUNE[this.level];
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
    this.autoSide = this.game === 'biobuzz' && phase === 'auto' ? ownSide(world, r.alliance) : 0;
    this.team.update(world, playerId);

    const m = this.mem;
    if (!m.plan || world.tick - m.planTick >= this.tune.replan) {
      m.plan = this.think(world, r, playerId);
      m.planTick = world.tick;
    }
    const out = this.noPin(r, this.hands(this.unstick(world, r, m.plan)));
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
   * THE LAST WORD ON CONTACT (BIOBUZZ): a robot touching an opponent never DRIVES toward it.
   * G421 reads the pinner's commanded intent (`driveIntent`, the same function asked here), so
   * a tank creeping onto its shooting spot with an opponent against its bumper was billed a
   * MAJOR every three seconds by nothing worse than its own approach. The swerve in `drive`
   * cannot catch that case: a tank goes where its HEADING points, not where the plan asked.
   */
  private noPin(r: RobotState, cmd: RobotCommand): RobotCommand {
    if (this.game !== 'biobuzz') return cmd;
    for (const o of this.others) {
      if (o.alliance === r.alliance || bbFootprintGap(r, o) > 3) continue;
      const ex = o.pos.x - r.pos.x;
      const ey = o.pos.y - r.pos.y;
      const el = Math.hypot(ex, ey) || 1;
      const I = driveIntent(r, cmd);
      const mag = Math.hypot(I.x, I.y);
      const along = (I.x * ex + I.y * ey) / el;
      if (mag < 0.05 || along < 0.2 * mag) continue;
      if (isTank(r)) {
        // no strafe to slide off with: stop driving, keep turning
        const w = ((cmd.rightDrive ?? 0) - (cmd.leftDrive ?? 0)) / 2;
        cmd.leftDrive = -w;
        cmd.rightDrive = w;
        continue;
      }
      const f = { x: I.x - (along * ex) / el, y: I.y - (along * ey) / el };
      if (r.fieldCentric) {
        const st = rot(f, viewAngleOf(r.alliance));
        cmd.driveX = st.x;
        cmd.driveY = st.y;
      } else {
        const local = rot(f, -r.heading);
        cmd.driveX = -local.y;
        cmd.driveY = local.x;
      }
    }
    return cmd;
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
    // THE WATCHDOG: whatever the plan says, a bot that has gone nowhere for a few seconds
    // without MEANING to stand still is stuck on something — give up its target and back out.
    // (The stall test below only catches a bot that is pushing; this catches one that has been
    // talked into standing still by a plan that is not working.)
    if (Math.hypot(r.pos.x - m.anchor.x, r.pos.y - m.anchor.y) > 6 || this.holding) {
      m.anchor = { ...r.pos };
      m.anchorAt = t;
    } else if (t - m.anchorAt > 3) {
      m.anchor = { ...r.pos };
      m.anchorAt = t;
      if (m.target) m.blacklist.set(m.target, t + BLACKLIST_S);
      m.target = null;
      m.escapes++;
      // a shooting spot we could not reach is not the spot: try the next one after this
      // FACE TO FACE WITH A ROBOT? Neither side will shove (a PIN is a MAJOR), so two polite
      // robots can stand nose to nose for the rest of the match. Back away from it, then.
      // Otherwise out toward open floor, swung one way or the other on alternate escapes.
      let near: RobotState | null = null;
      for (const o of this.others) {
        const d = Math.hypot(o.pos.x - r.pos.x, o.pos.y - r.pos.y);
        if (d < halfDiag(o) + halfDiag(r) + 10 && (!near || d < Math.hypot(near.pos.x - r.pos.x, near.pos.y - r.pos.y))) near = o;
      }
      let out: Vec2;
      if (near) {
        const ax = r.pos.x - near.pos.x;
        const ay = r.pos.y - near.pos.y;
        const al = Math.hypot(ax, ay) || 1;
        out = rot({ x: ax / al, y: ay / al }, (m.escapes % 2 ? 1 : -1) * 0.5);
      } else {
        const cl = Math.hypot(r.pos.x, r.pos.y) || 1;
        out = rot({ x: -r.pos.x / cl, y: -r.pos.y / cl }, (m.escapes % 2 ? 1 : -1) * (Math.PI / 3));
      }
      m.escapeTo = clampField({ x: r.pos.x + out.x * 30, y: r.pos.y + out.y * 30 });
      m.escapeUntil = t + ESCAPE_S;
      return cmd;
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
    this.holding = false;
    this.victim = playerId;
    const phase = world.match.phase;
    const game = this.game;

    // ENDGAME: leave in time to arrive, not at a fixed second
    if (phase === 'teleop') {
      const park = parkSpot(game, r, this.parkSlot(world, r));
      const d = Math.hypot(park.x - r.pos.x, park.y - r.pos.y);
      const left = world.match.phaseTimeLeft;
      // a CLUTCH driver leaves at the last moment, and not at all while a TIP can still start
      const leave = this.tune.clutch
        ? clamp(d / ((isTank(r) ? 30 : 38) * this.tune.speed) + 2, 3, 10)
        : clamp(d / (28 * this.tune.speed) + 4, 6, 16);
      const clutch = this.tune.clutch && game === 'biobuzz' && left > 1 && this.bbClutch(world, r, left);
      if (left <= leave && !clutch) {
        this.mem.target = null;
        // BIOBUZZ: a bot already lined up on a FLOWER finishes placing first
        if (game === 'biobuzz' && world.match.phaseTimeLeft > 4) {
          const placing = this.bbPlaceIfLinedUp(world, r);
          if (placing) return placing;
        }
        this.status = 'park';
        this.holding = true;
        return this.drive(r, park, parkFace(game, r), 1);
      }
    }

    // AUTO PARK (BIOBUZZ): finish AUTO partly in the LOADING ZONE — 5 points, assessed at the end
    // of AUTO — and clear of the wall, so LEAVE (3) still counts. Leave for it at the last
    // moment a sharp driver would.
    if (phase === 'auto' && game === 'biobuzz' && this.tune.sharp && this.knobs.autoPark) {
      const park = parkSpot(game, r, this.parkSlot(world, r));
      const d = Math.hypot(park.x - r.pos.x, park.y - r.pos.y);
      if (world.match.phaseTimeLeft <= d / (40 * this.tune.speed) + 1.2) {
        this.mem.target = null;
        this.status = 'auto-park';
        this.holding = true;
        return this.drive(r, park, r.heading, 1);
      }
    }

    if (this.team.defenderId === r.id && !this.behindLate(world, r)) {
      this.status = 'defend';
      this.holding = true;
      return this.defend(world, r, playerId);
    }
    if (game === 'biobuzz') return this.bbPlay(world, r);
    if (game === 'chain') return this.chainPlay(world, r);
    return this.decodePlay(world, r);
  }

  /** which PARK spot is ours: the pair of assignments with the shorter total drive (BIOBUZZ) */
  private parkSlot(world: World, r: RobotState): number {
    if (this.game !== 'biobuzz') return this.slot;
    const mate = this.team.bots.find((b) => b !== this);
    const o = mate && world.robots.find((x) => x.id === mate.robotId);
    if (!o) return 0;
    const d = (q: RobotState, k: number): number => {
      const p = parkSpot(this.game, q, k);
      return Math.hypot(p.x - q.pos.x, p.y - q.pos.y);
    };
    const keep = d(r, 0) + d(o, 1);
    const swap = d(r, 1) + d(o, 0);
    // a tie goes by id, so both bots settle it the same way
    return keep < swap || (keep === swap && r.id < o.id) ? 0 : 1;
  }

  /** our alliance's total minus the best opposing alliance's */
  private margin(world: World, r: RobotState): number {
    const other: Alliance = r.alliance === 'red' ? 'blue' : 'red';
    return world.match.scores[r.alliance].total - world.match.scores[other].total;
  }

  /** SCORE-AWARE: behind in the last minute — every robot scores, nothing else */
  private behindLate(world: World, r: RobotState): boolean {
    return this.tune.scoreAware && world.match.phase === 'teleop' && world.match.phaseTimeLeft < 60 &&
      this.margin(world, r) < 0;
  }

  /**
   * CLUTCH: is there a TIP this bot can still START before the buzzer? A swing that has begun
   * by 0:00 is scored as the TIP it must become, so what matters is getting the last element in,
   * not the four seconds after. Worth 20 against PARK's 5 — and behind on the scoreboard, even
   * a few elements left in the up cell (2 each) beat parking.
   */
  private bbClutch(world: World, r: RobotState, left: number): boolean {
    const hive = world.biobuzz?.hives?.[r.alliance];
    if (!hive || hive.tipping > 0) return false;
    const caps = bbCaps(r);
    const a = r.alliance;
    const pollen = r.hopper.filter((c) => c !== 'red' && c !== 'blue').length;
    const nectar = caps.nectarShot ? r.hopper.filter((c) => c === a).length : 0;
    if (pollen + nectar === 0) return false;
    const zone = bbZone(a, hive.up, caps);
    const spot = zone.contains(r.pos) ? r.pos : zone.spot(r.pos, this.slot);
    const reach = Math.hypot(spot.x - r.pos.x, spot.y - r.pos.y) / (40 * this.tune.speed) + 0.4 * (pollen + nectar);
    if (reach > left - 0.3) return false;
    if (bbWouldTip(world, hive.contents, pollen, nectar)) return true;
    return this.behindLate(world, r) && (pollen + nectar) * 2 > 5;
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

  /**
   * BIOBUZZ. The shape of the game, measured rather than guessed (a robot parked on a grid
   * with four POLLEN, fire held — see HANDOFF):
   *  - a TURRET lands its shots from almost ANYWHERE on the up cell's side of the field, the
   *    whole width of it, except right under the cell. So a turret bot holds fire the whole time
   *    it is carrying and on that side — it scores while it collects — and only drives
   *    somewhere to shoot when it has nothing better to do on the way.
   *  - a DUMPER (turretless) has to be in a RING 14–38 in from the up cell, outboard of it; Aim
   *    Assist turns the chassis while fire is held, so it is held only once in the ring.
   *  - Aim Assist releases a shot only when it would land, so holding fire costs nothing.
   *
   * What the bot does with its hopper depends on what the build can do (`bbCaps`) — it drives
   * the PLAYER'S build, so it may or may not carry NECTAR, have a turret, or have a Box Tube.
   */
  private bbPlay(world: World, r: RobotState): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const bb = world.biobuzz;
    const a = r.alliance;
    const hive = bb?.hives?.[a];
    const caps = bbCaps(r);
    const teleop = world.match.phase === 'teleop';
    const left = world.match.phaseTimeLeft;
    const full = this.tune.fullGame;
    const flowerTime = full && teleop && left <= BB_FLOWER_UNLOCK_S && caps.place !== null;
    const pollen = r.hopper.filter((c) => c !== 'red' && c !== 'blue').length;
    const nectar = r.hopper.filter((c) => c === a).length;
    const held = pollen + nectar;
    // after the cue a Box Tube build keeps its NECTAR for the FLOWERS; otherwise it is ammunition
    const shootable = pollen + (caps.nectarShot && !flowerTime ? nectar : 0);
    const K = this.knobs;
    // THE RISING CELL TAKES SHOTS BEFORE THE SWING ENDS: once the bar passes level
    // (`released`) the tray coming up is the one that catches (`hiveTakingSide`), so a loaded
    // bot fires at it then — a little early, even, for the time a shot spends in the air —
    // rather than standing through the whole 4-s swing
    const lead = caps.turreted ? K.preFire : K.preFireDump;
    const early = !!hive && hive.tipping > 0 && lead >= 0 && (hive.released || hive.tipping - BB_TIP_RELEASE_S < lead);
    const upSide = hive ? (early ? (hive.up === 'south' ? 'north' : 'south') : hive.up) : 'north';
    // what the up cell holds: the rising tray is empty until it has caught something
    const contents = hive ? (early && !hive.released ? [] : hive.contents) : [];
    const tipping = !hive || (hive.tipping > 0 && !early);
    const zone = hive ? bbZone(a, upSide, caps) : null;
    this.status = '';

    // THE HUMAN PLAYER: one NECTAR per TIP, the whole stock from the 1:00 cue — entered as soon
    // as it is earned, whenever this build has a use for NECTAR at all
    const wantsNectar = caps.nectarShot || caps.place !== null;
    const callNectar =
      !!bb && full && wantsNectar && this.team.bots[0] === this && bb.nectarStock[a] > 0 &&
      (bb.nectarDue[a] > 0 || (teleop && left <= BB_FLOWER_UNLOCK_S)) && world.tick - m.lastPress >= PRESS_EVERY * 2;
    // a TURRET scores on the move: hold fire whenever it is carrying and on the right side
    const turretFire = this.tune.sharp && caps.turreted && shootable > 0 && !tipping && !!zone &&
      zone.contains(r.pos) && !(flowerTime && nectar > 0);
    const finish = (cmd: RobotCommand): RobotCommand => {
      if (callNectar) {
        cmd.bbNectar = true;
        m.lastPress = world.tick;
      }
      if (turretFire) cmd.fire = true;
      return cmd;
    };

    // ── FLOWERS, after the 1:00 cue (G410: no NECTAR in a FLOWER before it) ──
    if (flowerTime && bb) {
      if (nectar > 0) {
        const f = this.bestFlower(world, r, 'nectar');
        if (f !== null) return finish(this.bbPlace(world, r, f, 'nectar', pollen));
      }
      // POLLEN into a FLOWER we own only when the HIVE can no longer use it: late, and not a TIP
      const tips = hive ? bbWouldTip(world, contents, pollen, caps.nectarShot ? nectar : 0) : false;
      if (pollen > 0 && !tips && left < 25) {
        const owned = this.bestFlower(world, r, 'pollen');
        if (owned !== null) return finish(this.bbPlace(world, r, owned, 'pollen', pollen));
      }
    }

    // ── WHAT TO PICK UP ──
    const nectarUse = caps.nectarShot || (caps.place !== null && teleop && left <= BB_FLOWER_UNLOCK_S + 12);
    const wanted = (b: Artifact): boolean =>
      b.state.kind === 'ground' && (b.color === 'red' || b.color === 'blue' ? nectarUse && b.color === a : true);
    const room = held < caps.cap;
    let target = room ? this.pickElement(world, r, wanted, zone) : null;
    let pull: number | null = null;
    if (room && full && bb && !flowerTime) {
      pull = this.bestRetrieve(world, r, target);
      if (pull !== null) target = null;
    }

    // ── SHOOT ──
    const tipNow = hive ? bbWouldTip(world, contents, pollen, caps.nectarShot ? nectar : 0) : false;
    const load = caps.turreted ? caps.cap : Math.min(caps.cap, this.tune.load + 1);
    // THE TEAM'S LOAD: if what the whole alliance is carrying already tips the HIVE, every bot
    // that is carrying goes and fires now, rather than each topping up its own hopper first —
    // the HIVE, not the collecting, is what a match is rationed by (one TIP, then a 4-s swing)
    const teamTips = K.teamTip && caps.turreted && hive && this.team.bots.length > 1 && bbTeamWouldTip(world, contents, this.team, caps);
    const goShoot =
      shootable > 0 && !tipping && !!zone &&
      (shootable >= load || !room || (!target && pull === null) || tipNow || !!teamTips);
    if (goShoot && zone) {
      m.target = null;
      this.status = 'shoot';
      // NOTHING LEAVING? Aim Assist only lets a shot go that will land, and from some spots —
      // a bad angle, a robot in the way — nothing will. A hopper that has not got lighter in
      // 1.5 s means move, not wait.
      if (m.shootHop !== held) {
        // something went: this spot works, so stop looking for another
        if (held < m.shootHop) m.shootShift = 0;
        m.shootHop = held;
        m.shootLastAt = t;
      } else if (zone.contains(r.pos) && t - m.shootLastAt > K.shootStall) {
        m.shootShift = (m.shootShift + 1) % 4;
        m.shootLastAt = t;
      }
      let spot = zone.spot(r.pos, this.slot, m.shootShift);
      // NOT GETTING THERE? Out of the zone and no closer to the spot for a second means
      // something is in the way — usually a robot we will not shove. Pick another spot rather
      // than stand behind it (the reported "stuck just short of shooting position").
      if (!zone.contains(r.pos)) {
        const ds = Math.hypot(spot.x - r.pos.x, spot.y - r.pos.y);
        if (ds < m.spotBest - 2) {
          m.spotBest = ds;
          m.spotAt = t;
        } else if (t - m.spotAt > (isTank(r) ? 2.8 : 1.2)) {
          // (a TANK turning on the spot to line up is not getting closer either, and is not stuck)
          m.shootShift = (m.shootShift % 3) + 1;
          m.spotBest = Infinity;
          m.spotAt = t;
          spot = zone.spot(r.pos, this.slot, m.shootShift);
        }
      } else {
        m.spotBest = Infinity;
        m.spotAt = t;
      }
      // AUTO: our own half (G402 bills a MAJOR for contact from the far side)
      if (world.match.phase === 'auto') spot.x = ownSide(world, a) * Math.max(ownSide(world, a) * spot.x, 6);
      const inZone = zone.contains(r.pos);
      this.holding = inZone;
      const cell = { x: a === 'red' ? -BB_HIVE_X : BB_HIVE_X, y: zone.cellY };
      // a turret that is firing stays put; one that has been told to move (shift) moves
      const stay = inZone && caps.turreted && m.shootShift === 0;
      // a DUMPER arrives already aimed: its launcher edge at the cell (a rear dumper backs in)
      const aim = Math.atan2(cell.y - r.pos.y, cell.x - r.pos.x) - (caps.turreted ? 0 : caps.launchAngle);
      const cmd = this.drive(r, stay ? r.pos : spot, aim, 3);
      // a DUMPER's fire button steers the chassis, so it is held only once in the ring
      if (inZone) cmd.fire = true;
      return finish(cmd);
    }
    m.shootSince = null;

    // THE SPILL AMBUSH. A TIP dumps eight elements out of the cell that just filled, two seconds
    // after it starts, rolling OUTBOARD — and measured, nearly half of every spill used to be
    // picked up by the OTHER alliance, while our own bots took a median 3–6 s to get to theirs.
    // So an empty bot does not wander off during the swing: it waits where the spill lands,
    // mouth to the HIVE, and the elements roll into it.
    // THEIRS TOO: when their HIVE is about to dump and ours is not, the same wait at THEIR spill
    // is a point for us and one less for them — the field only has forty POLLEN.
    const opp: Alliance = a === 'red' ? 'blue' : 'red';
    const theirs = bb?.hives?.[opp];
    const ours = !!hive && hive.tipping > 0 && !hive.released;
    const steal = K.spillSteal && !ours && !!theirs && theirs.tipping > 0 && !theirs.released;
    const ambush = ours ? hive : steal ? theirs : null;
    // (not THEIR spill in AUTO: it lands on their half, and G402 is a MAJOR)
    if ((ours ? K.spillWait : steal) && ambush && this.tune.sharp && room && shootable <= 1 && !flowerTime &&
      (ours || world.match.phase !== 'auto')) {
      const s = ambush.up === 'north' ? 1 : -1;
      const hx = (ours ? a : opp) === 'red' ? -BB_HIVE_X : BB_HIVE_X;
      const n = this.team.bots.length;
      const mouth = pickMouth(caps.mouths, -s * Math.PI / 2, r.heading);
      const spot = { x: hx + (n > 1 ? (this.slot === 0 ? -8 : 8) : 0), y: s * (K.spillY + mouth.reach) };
      m.target = null;
      this.status = ours ? 'ambush' : 'steal';
      const cmd = this.drive(r, spot, -s * Math.PI / 2 - mouth.angle, 2);
      cmd.intake = true;
      return finish(cmd);
    }

    // THE HIVE IS SWINGING and we are loaded: the other cell is about to be the up one, so be
    // there when it lands rather than waiting where the old one was
    // TOP UP DURING THE SWING — but only with a pickup we can make AND still be at the new up
    // side when the swing lands: arriving loaded as it settles is what makes the next TIP
    // instant. (`tipping` is the seconds left in the swing.)
    let nearTarget: boolean;
    if (K.swingPlan && caps.turreted && hive && hive.tipping > 0 && target && room) {
      const v = 45 * this.tune.speed;
      const next = bbZone(a, hive.up === 'south' ? 'north' : 'south', caps);
      const via = next.spot(target.pos, this.slot);
      const eta = (Math.hypot(target.pos.x - r.pos.x, target.pos.y - r.pos.y) + Math.hypot(via.x - target.pos.x, via.y - target.pos.y)) / v;
      nearTarget = eta < hive.tipping + 0.6;
    } else {
      nearTarget = !!target && Math.hypot(target.pos.x - r.pos.x, target.pos.y - r.pos.y) < K.swingGrab;
    }
    if (this.tune.sharp && hive && hive.tipping > 0 && shootable >= Math.min(2, caps.cap) && !nearTarget && pull === null) {
      this.status = 'reposition';
      this.holding = true;
      const next = bbZone(a, hive.up === 'south' ? 'north' : 'south', caps);
      const cmd = this.drive(r, next.spot(r.pos, this.slot), r.heading, 3);
      cmd.intake = true;
      return finish(cmd);
    }

    // SMART BLOCK: you are loaded and heading somewhere with it, and we have nothing to deliver
    // and nothing close to pick up — then a few seconds in your way cost you more than us. Never
    // when behind late (every robot scores then), never so long it becomes a PIN (`defend`
    // backs off after 2.5 s of contact, and G421 needs 3).
    if ((this.knobs.harass ?? this.tune.harass) && teleop && left > 22 && !this.behindLate(world, r) && shootable === 0) {
      const foe = world.robots.find((x) => x.id === this.victim && x.alliance !== a);
      const lead = this.margin(world, r);
      if (foe && t >= m.harassCooldown && threat(world, foe)) {
        const dFoe = Math.hypot(foe.pos.x - r.pos.x, foe.pos.y - r.pos.y);
        const dWork = target ? Math.hypot(target.pos.x - r.pos.x, target.pos.y - r.pos.y) : pull !== null ? 40 : Infinity;
        // ahead late, the spare robot-time is worth more spent on you than on a far pollen
        const worth = dFoe < 55 && (dWork > 35 || (this.tune.scoreAware && left < 50 && lead > 30));
        if (worth && m.harassUntil < t) m.harassUntil = t + 3;
      }
      if (t < m.harassUntil && foe) {
        this.status = 'block';
        if (t + 0.05 >= m.harassUntil) m.harassCooldown = t + 6;
        return finish(this.defend(world, r, foe.id));
      }
    }

    if (pull !== null) {
      this.status = 'pull';
      return finish(this.bbRetrieve(world, r, pull));
    }
    if (target) {
      this.status = 'collect';
      return finish(this.collect(world, r, target, true));
    }
    // NOTHING LOOSE ANYWHERE: a coordinating team makes itself useful by getting in the way;
    // anyone else waits on the scoring side where the next HIVE spill will land
    if (this.tune.coordinate && this.victim) {
      this.status = 'idle-defend';
      return finish(this.defend(world, r, this.victim));
    }
    this.status = 'idle';
    m.target = null;
    this.holding = true;
    const wait = zone ? zone.spot(r.pos, this.slot) : idleSpot(this.game, world, a, this.slot);
    const cmd = this.drive(r, wait, r.heading, 4);
    cmd.intake = true;
    return finish(cmd);
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

  /**
   * Back the Box Tube onto flower `i` and press the placement button once it is in reach.
   * ⚠️ "CLOSE" IS NOT PROGRESS. A bot a few inches off the pose that the foot or a wall will not
   * let any closer used to count as arriving forever and never place — so close-but-not-in-
   * reach runs its own clock, and gives the flower up.
   */
  private bbPlace(world: World, r: RobotState, i: number, kind: 'nectar' | 'pollen', pollen: number): RobotCommand {
    const m = this.mem;
    const t = world.time;
    const key = `flower:${i}`;
    this.status = `place-${kind}`;
    if (m.target !== key) {
      m.target = key;
      m.bestDist = Infinity;
      m.lastProgressAt = t;
      m.nearSince = null;
    }
    const pose = this.placePose(r, i);
    const d = Math.hypot(pose.pos.x - r.pos.x, pose.pos.y - r.pos.y);
    this.progress(world, d, 0);
    const cmd = this.drive(r, pose.pos, pose.heading, 0.3, 0.08);
    if (bbFlowerInReach(world, r) === i) {
      m.lastProgressAt = t; // lined up is progress, however long the stack takes
      m.nearSince = null;
      this.pressing = true;
      this.holding = true;
      if (world.tick - m.lastPress >= PRESS_EVERY) {
        m.lastPress = world.tick;
        // NECTAR first (it makes the FLOWER ours), then the POLLEN rides on the ownership
        if (kind === 'nectar') cmd.bbPlaceNectar = true;
        else if (pollen > 0) cmd.bbPlace = true;
      }
    } else if (d < 10) {
      m.nearSince ??= t;
      this.holding = true;
      if (t - m.nearSince > 2.5) {
        m.blacklist.set(key, t + BLACKLIST_S);
        m.target = null;
        m.nearSince = null;
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
   * bottom (a NECTAR there locks it), not ours to lose, and not claimed by a teammate. A stack
   * is worth a longer drive than one loose element, the more so the taller it is.
   */
  private bestRetrieve(world: World, r: RobotState, ground: Target | null): number | null {
    const bb = world.biobuzz;
    if (!bb) return null;
    const kindOf = kindLookup(world);
    const claimed = this.team.claimedBy(this);
    const groundD = ground ? Math.hypot(ground.pos.x - r.pos.x, ground.pos.y - r.pos.y) : Infinity;
    let best: number | null = null;
    let bestD = groundD;
    for (let i = 0; i < BB_FLOWERS.length; i++) {
      const key = `pull:${i}`;
      if (claimed.has(key) || this.blacklisted(world, key)) continue;
      const stack = bb.flowers[i].stack;
      if (stack.length === 0 || kindOf(stack[0]) !== 'pollen') continue;
      if (flowerScore(stack, kindOf).owner === r.alliance) continue;
      if (world.match.phase === 'auto' && BB_FLOWERS[i].x * ownSide(world, r.alliance) < 0) continue;
      const p = this.pullPose(r, i).pos;
      let pollenIn = 0;
      for (const id of stack) if (kindOf(id) === 'pollen') pollenIn++;
      let d = Math.hypot(p.x - r.pos.x, p.y - r.pos.y) - this.knobs.pullStack * Math.min(pollenIn, 4);
      // STARVE: the flowers on the opponent's side are the ones feeding them
      if ((this.knobs.starve ?? this.tune.starve) && BB_FLOWERS[i].x * ownSide(world, r.alliance) < 0) d -= 12;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** a MOUTH square on the FLOWER foot, so its roller sits on the retrieval opening */
  private pullPose(r: RobotState, i: number): { pos: Vec2; heading: number; face: Vec2 } {
    const f = BB_FLOWERS[i];
    const n = FLOWER_MOUTH[f.wall];
    const out = BB_FLOWER_FOOT.deep - BB_FLOWER_D;
    const face = { x: f.x + n.x * out, y: f.y + n.y * out };
    const toWall = Math.atan2(-n.y, -n.x);
    const mouth = pickMouth(bbCaps(r).mouths, toWall, r.heading);
    return {
      pos: { x: face.x + n.x * (mouth.reach + 0.5), y: face.y + n.y * (mouth.reach + 0.5) },
      heading: toWall - mouth.angle,
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
      m.nearSince = null;
    }
    const pose = this.pullPose(r, i);
    const d = Math.hypot(pose.pos.x - r.pos.x, pose.pos.y - r.pos.y);
    const aligned = d < 2.5 && Math.abs(wrapAngle(pose.heading - r.heading)) < 0.2;
    if (!aligned) {
      m.pullSince = null;
      this.progress(world, d, 0);
      if (d < 8) {
        // nearly there — the same close-is-not-progress clock as placing
        m.nearSince ??= t;
        this.holding = true;
        if (t - m.nearSince > 2.5) {
          m.blacklist.set(key, t + BLACKLIST_S);
          m.target = null;
        }
      } else m.nearSince = null;
      const cmd = this.drive(r, pose.pos, pose.heading, 0.4, 0.08);
      cmd.intake = d < 14;
      return cmd;
    }
    // on the foot: lean in gently with the rollers running until the stack stops giving
    if (m.pullSince === null || r.hopper.length > m.pullHopper) {
      m.pullSince = t;
      m.pullHopper = r.hopper.length;
    }
    m.lastProgressAt = t;
    if (t - m.pullSince > 1.2 || r.hopper.length >= bbCaps(r).cap) {
      m.blacklist.set(key, t + 3);
      m.target = null;
    }
    this.pressing = true;
    this.holding = true;
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
    const mouths = mouthsOf(this.game, r);
    // AGAINST A WALL: square up first, then drive straight in. Come at it on an angle and the
    // chassis corner reaches it before the sweeper does and just shoves it along the wall —
    // which is exactly where a human player's NECTAR and a GARDEN's POLLEN sit.
    const n = wallNormal(target.pos);
    if (n) {
      const toWall = Math.atan2(-n.y, -n.x);
      const mouth = pickMouth(mouths, toWall, r.heading);
      const face = toWall - mouth.angle;
      const reach = mouth.reach;
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
    // lead with whichever MOUTH needs the least turning (a front+back or side intake has two)
    const dir = Math.atan2(target.pos.y - r.pos.y, target.pos.x - r.pos.x);
    const face = dir - pickMouth(mouths, dir, r.heading).angle;
    const cmd = this.drive(r, target.pos, face, 0);
    cmd.intake = intake;
    return cmd;
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
  private pickElement(
    world: World,
    r: RobotState,
    wanted: (b: Artifact) => boolean,
    /** where the bot will have to take what it picks up (BIOBUZZ): nearer that is cheaper */
    zone?: BbZone | null,
  ): Target | null {
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
      if (this.game === 'biobuzz' && bbTuckedByFoot(b.pos, r)) continue;
      if (this.keepOut.some((z) => Math.hypot(b.pos.x - z.pos.x, b.pos.y - z.pos.y) < z.r + halfDiag(r))) continue;
      // the OPPONENT'S LOADING ZONE is where their human player feeds them: going in there
      // while one of them is nearby is contact in a protected zone (G426) waiting to happen
      if (inOpponentLoading(this.game, r.alliance, b.pos) && this.others.some((o) =>
        o.alliance !== r.alliance && Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y) < 40)) continue;
      let d = Math.hypot(b.pos.x - r.pos.x, b.pos.y - r.pos.y);
      if (zone) {
        // the trip AFTER the pickup counts too, and so do the neighbours it brings in reach
        if (!zone.contains(b.pos)) {
          const z = zone.spot(b.pos, this.slot);
          d += this.knobs.zoneTrip * Math.hypot(z.x - b.pos.x, z.y - b.pos.y);
        }
        let near = 0;
        for (const q of world.balls) {
          if (q !== b && wanted(q) && Math.abs(q.pos.x - b.pos.x) < 12 && Math.abs(q.pos.y - b.pos.y) < 12) near++;
        }
        d -= this.knobs.cluster * Math.min(near, 3);
        if (this.knobs.roleSplit && this.team.bots.length >= 2) {
          // slot 0 farms round our HIVE, slot 1 fetches what lies further out
          const hx = r.alliance === 'red' ? -BB_HIVE_X : BB_HIVE_X;
          const dHive = Math.hypot(b.pos.x - hx, b.pos.y);
          if (this.slot === 0 && dHive > 45) d += 25;
          if (this.slot === 1 && dHive < 35) d += 25;
        }
        if ((this.knobs.starve ?? this.tune.starve)) d -= this.denial(r, b.pos, d);
        if (this.tune.sharp) {
          // NECTAR IS WORTH NEARLY THREE POLLEN to a build that can shoot it: 4 NECTAR + 1 POLLEN
          // tip the HIVE where 8 POLLEN are needed without it, and each TIP spills it back out to
          // be used again. A sharp bot hoards and recycles it.
          if ((b.color === 'red' || b.color === 'blue') && bbCaps(r).nectarShot) d -= this.knobs.nectarBonus;
          // a TURRET fires while it collects, so an element already in its zone is half-scored
          if (bbCaps(r).turreted && zone.contains(b.pos)) d -= this.knobs.zoneBonus;
        }
      }
      // stick with the current target unless something is clearly closer (no dithering)
      if (key === m.target) d -= this.knobs.sticky;
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

  /**
   * STARVE — how much taking the element at `p` hurts the OPPONENT, as inches of drive it is
   * worth. An element an opponent is about to reach is theirs next unless we get there first; one
   * in their GARDEN is a point for them at the buzzer. Only ever a tie-breaker between elements
   * of similar cost, never a reason to cross the field for one.
   */
  private denial(r: RobotState, p: Vec2, ourCost: number): number {
    let v = 0;
    for (const o of this.others) {
      if (o.alliance === r.alliance) continue;
      const dO = Math.hypot(o.pos.x - p.x, o.pos.y - p.y);
      // ours if we are nearly as close as they are; theirs is the one to take
      if (dO < 50 && ourCost < dO * 1.3) v = Math.max(v, 18 * (1 - dO / 50) + 6);
    }
    const g = BB_GARDEN[r.alliance === 'red' ? 'blue' : 'red'];
    if (p.x > g.x0 - 3 && p.x < g.x1 + 3 && p.y > g.y0 - 3 && p.y < g.y1 + 3) v += 10;
    return v;
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
    // THE AUTO LINE (BIOBUZZ G402): a robot fully across the centre line and touching an
    // opponent is a MAJOR. The centre may lean over only by less than the chassis' shorter
    // half-side, so some corner always stays home — an escape toward the field centre, a zone
    // spot or a ball on the line are all clamped here rather than at every caller.
    const side = this.autoSide;
    const lim = side ? -Math.max(0, Math.min(r.spec.length, r.spec.width) / 2 - 5) : 0;
    if (side && to.x * side < lim) to = { x: lim * side, y: to.y };
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
    // KEEP-OUT ZONES PUSH. Removing the approach is not enough for them: a bot shoved in, or
    // whose target spot happens to lie inside one, would otherwise sit there. So inside one it
    // is driven back OUT, harder the deeper it is.
    // ...and in the DECODE endgame an OPPONENT is one too: a robot parking in its BASE may
    // drive into us, and the MAJOR (G427) is ours whoever moved, so we get out of its way.
    const endgame = this.keepOut.length > 1;
    const pushers = endgame
      ? [...this.keepOut, ...this.others.filter((o) => o.alliance !== r.alliance).map((o) => ({ pos: o.pos, r: halfDiag(o) + 8 }))]
      : this.keepOut;
    for (const z of pushers) {
      const R = halfDiag(r) + z.r;
      const ox = r.pos.x - z.pos.x;
      const oy = r.pos.y - z.pos.y;
      const od = Math.hypot(ox, oy) || 1;
      if (od >= R) continue;
      const k = vmax * Math.min(1, (R - od) / 6);
      fx += (ox / od) * k;
      fy += (oy / od) * k;
    }
    // a wider berth for OPPONENTS in the DECODE endgame, when touching one near its BASE is a
    // MAJOR (G427) whichever robot moved
    const wide = endgame ? 14 : 6;
    const obstacles = [
      ...this.others.map((o) => ({ pos: o.pos, r: halfDiag(o) + (o.alliance === r.alliance ? 6 : wide) })),
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

    // ...and the line is applied LAST, after the robot-avoidance swerve, which is what used to
    // carry a bot sideways over it while it steered round its own partner
    if (side) {
      const u = r.pos.x * side;
      if (u < lim + 10 && fx * side < 0) fx *= clamp((u - lim) / 10, 0, 1);
      if (u < lim) fx += side * vmax * Math.min(1, (lim - u) / 4);
    }
    const tank = r.spec.drivetrain === 'tank' || (r.spec.drivetrain === 'butterfly' && r.butterflyTank);
    if (tank) {
      // NO STRAFE: turn onto the line of travel and drive along it — FORWARDS or BACKWARDS,
      // whichever the plan's facing asks for (a rear mouth, a Box Tube backed onto a FLOWER) or,
      // failing that, whichever is the smaller turn. A tank that always drove nose-first spent
      // half its match pirouetting.
      const sp = Math.hypot(fx, fy);
      let err: number;
      let fwd = 0;
      if (d > arrive && sp > 1e-6) {
        const travel = Math.atan2(fy, fx);
        // with HYSTERESIS: near 90° the choice flips every tick and the tank just shivers
        const off = Math.abs(wrapAngle(face - travel));
        const rev = off > Math.PI / 2 + (this.tankRev ? -0.35 : 0.35);
        this.tankRev = rev;
        err = wrapAngle((rev ? travel + Math.PI : travel) - r.heading);
        fwd = sp * Math.max(0, Math.cos(err)) * (rev ? -1 : 1);
      } else {
        err = wrapAngle(face - r.heading);
      }
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
// WHAT THE ROBOT CAN DO — bots drive the PLAYER'S build, so nothing here is assumed
// ─────────────────────────────────────────────────────────────────────────────

/** an intake mouth: which way it faces (robot frame) and how far out its roller is */
interface Mouth {
  angle: number;
  reach: number;
}

function mouthsFromRects(rects: readonly { edge: string; x0: number; x1: number; y0: number; y1: number }[]): Mouth[] {
  return rects.map((m) =>
    m.edge === 'back'
      ? { angle: Math.PI, reach: -m.x0 }
      : m.edge === 'left'
        ? { angle: Math.PI / 2, reach: m.y1 }
        : m.edge === 'right'
          ? { angle: -Math.PI / 2, reach: -m.y0 }
          : { angle: 0, reach: m.x1 },
  );
}

/** every intake mouth this robot has, per game (DECODE's is always the front funnel) */
function mouthsOf(game: string, r: RobotState): Mouth[] {
  const mouths =
    game === 'biobuzz'
      ? bbCaps(r).mouths
      : game === 'chain'
        ? mouthsFromRects(chainIntakeMouths(r.spec))
        : [{ angle: 0, reach: r.spec.length / 2 + C.INTAKE_PRESETS[r.spec.intake].reach }];
  return mouths.length ? mouths : [{ angle: 0, reach: r.spec.length / 2 }];
}

/** the mouth that can face field direction `dir` with the least turning from `heading` */
function pickMouth(mouths: readonly Mouth[], dir: number, heading: number): Mouth {
  let best = mouths[0];
  let bestErr = Infinity;
  for (const m of mouths) {
    const err = Math.abs(wrapAngle(dir - m.angle - heading));
    if (err < bestErr) {
      bestErr = err;
      best = m;
    }
  }
  return best;
}

interface BbCaps {
  /** a turret (or two) aims itself — it can shoot from anywhere on the right side, on the move */
  turreted: boolean;
  /** can hold and launch our own NECTAR (the Sniper's single turret cannot) */
  nectarShot: boolean;
  /** the Box Tube's placement point, robot frame, or null without one */
  place: Vec2 | null;
  /** which way a TURRETLESS launcher throws, robot frame (0 = over the front). The chassis has
   * to face the cell by this much; turning after arrival is the slowest part of a dump. */
  launchAngle: number;
  mouths: Mouth[];
  cap: number;
}

const capsCache = new WeakMap<RobotSpec, BbCaps>();
/** what this BIOBUZZ build can do — read once per spec */
function bbCaps(r: RobotState): BbCaps {
  let c = capsCache.get(r.spec);
  if (!c) {
    const launcher = bbLauncherOf(r.spec, 0);
    const kind = launcher.kind;
    const m = launcher.mount;
    c = {
      turreted: kind === 'turret' || kind === 'twinturret',
      launchAngle: m === 'back' ? Math.PI : m === 'left' ? Math.PI / 2 : m === 'right' ? -Math.PI / 2 : 0,
      nectarShot: bbIntakeAccepts(r.spec, r.alliance, r.alliance),
      place: bbPlacePointLocal(r.spec),
      mouths: mouthsFromRects(bbMouths(r.spec)),
      cap: bbHopperCap(r.spec),
    };
    capsCache.set(r.spec, c);
  }
  return c;
}

/**
 * WHERE A SHOT LANDS FROM, for `a`'s HIVE with `up` raised — measured, not assumed: a robot
 * parked on a 6-in grid with four POLLEN and fire held, counting what went in.
 *  - TURRET: the whole up-cell side of the field from ~20 in out, bar a pocket right under the
 *    cell (it cannot see the opening from below it).
 *  - DUMPER: a ring about 14–38 in from the cell, outboard of it (the dump has a range).
 */
interface BbZone {
  contains(p: Vec2): boolean;
  /** the nearest good place to shoot from, given where the bot is */
  spot(p: Vec2, slot: number, shift?: number): Vec2;
  /** y of the up cell (its x is the HIVE's) */
  cellY: number;
}

function bbZone(a: Alliance, up: 'north' | 'south', caps: BbCaps): BbZone {
  const s = up === 'south' ? -1 : 1;
  const hx = a === 'red' ? -BB_HIVE_X : BB_HIVE_X;
  const cy = s * BB_HIVE_CELL_DY;
  const lim = C.FIELD_HALF - 10;
  if (caps.turreted) {
    const under = (p: Vec2): boolean => Math.abs(p.x - hx) < 14 && s * p.y < 34;
    return {
      cellY: cy,
      contains: (p) => s * p.y >= 20 && Math.abs(p.x) <= lim + 4 && Math.abs(p.y) <= lim + 4 && !under(p),
      spot: (p, slot, shift = 0) => {
        if (shift > 0) {
          // the fallbacks, in turn: straight out from the cell, then out to either side of it
          // spread wide: the centre is where BOTH alliances' robots gather (the HIVES are 25 in
          // apart), so the likeliest reason a spot did not work is somebody standing on it
          const alt = [
            { x: hx - 30, y: cy + s * 26 },
            { x: hx + 30, y: cy + s * 26 },
            { x: hx, y: cy + s * 40 },
          ][(shift - 1 + slot) % 3];
          return { x: clamp(alt.x, -lim, lim), y: clamp(alt.y, -lim, lim) };
        }
        let y = s * Math.max(s * p.y, 28 + slot * 6);
        let x = clamp(p.x, -lim, lim);
        // NOT BESIDE A FRAME BAR: a spot a chassis-width from one is reached by scraping along
        // it (measured: 2 s at 4 in/s, full stick, on every trip round that side of the hive)
        for (const bx of [-BAR_X, BAR_X]) {
          if (Math.abs(x - bx) < BAR_CLEAR && Math.abs(y) < BB_FRAME_Y + BAR_KEEP) x = bx + (x < bx ? -BAR_CLEAR : BAR_CLEAR);
        }
        if (under({ x, y })) y = s * 38;
        return { x, y: clamp(y, -lim, lim) };
      },
    };
  }
  return {
    cellY: cy,
    contains: (p) => {
      const d = Math.hypot(p.x - hx, p.y - cy);
      return d >= 16 && d <= 36 && s * (p.y - cy) >= 10;
    },
    spot: (p, slot, shift = 0) => {
      // on the ring at the bearing the bot already has, kept outboard (and nudged per attempt)
      // clamped AFTER the nudge: a fallback spot that has swung round past the ring's outboard
      // limit is not a shooting spot at all, and a bot sent there stands in it not firing
      const phi = clamp(
        clamp(Math.atan2(p.x - hx, s * (p.y - cy)), -0.8, 0.8) + (shift === 1 ? 0.5 : shift === 2 ? -0.5 : 0),
        -0.95,
        0.95,
      );
      const R = 25 + slot * 4;
      return { x: hx + R * Math.sin(phi), y: cy + s * R * Math.cos(phi) };
    },
  };
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
    zones.push({ pos: { x: driverSide(opp) * C.BASE_CENTER.x, y: C.BASE_CENTER.y }, r: 22 });
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
  if (game === 'biobuzz') {
    // PARK is "at least partially in the LOADING ZONE", so a corner over the tape is enough:
    // stop just inside it, and far enough apart that two chassis never block each other (the
    // old spots were 8 in apart for a 17-in robot, and the second bot sat outside at the buzzer)
    const sx = a === 'red' ? -1 : 1;
    return { x: sx * (61 + 3 - Math.min(r.spec.length, r.spec.width) / 2), y: sx * -(slot === 0 ? 44 : 28) };
  }
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

/** would everything the whole TEAM is carrying, fired in, tip the up cell? */
function bbTeamWouldTip(world: World, contents: readonly number[], team: BotTeam, caps: BbCaps): boolean {
  let pollen = 0;
  let nectar = 0;
  for (const b of team.bots) {
    const r = world.robots.find((x) => x.id === b.robotId);
    if (!r) continue;
    for (const c of r.hopper) {
      if (c === 'red' || c === 'blue') {
        if (caps.nectarShot && c === r.alliance) nectar++;
      } else pollen++;
    }
  }
  return pollen + nectar > 0 && bbWouldTip(world, contents, pollen, nectar);
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
/** a frame bar's centreline, and how far off it a chassis centre must be not to touch it */
const BAR_X = (BB_FRAME_BAR_IN + BB_FRAME_BAR_OUT) / 2;
const BAR_CLEAR = 12.5;
const BAR_BOXES = [-1, 1].map((sx) => {
  const a = sx * (BB_FRAME_BAR_IN - BAR_KEEP);
  const b = sx * (BB_FRAME_BAR_OUT + BAR_KEEP);
  return { x0: Math.min(a, b), x1: Math.max(a, b), y0: -BB_FRAME_Y - BAR_KEEP, y1: BB_FRAME_Y + BAR_KEEP };
});
type Box = (typeof BAR_BOXES)[number];

function inBox(p: Vec2, b: Box, inset = 0): boolean {
  return p.x > b.x0 + inset && p.x < b.x1 - inset && p.y > b.y0 + inset && p.y < b.y1 - inset;
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

/**
 * A target INSIDE a keep-out box — a POLLEN lying against a bar, usually on its hive side,
 * where the tips spill — cannot use the box, so it is routed round the BAR ITSELF: a thin wall
 * at x = ±24.5 from y = −19.4 to +19.4. If the straight line crosses it, go round the nearer
 * end: first to a point past that end on our own side, then across to the same point on the
 * target's side. (It used to go straight, and a bot nosed into the bar and rocked there for
 * twenty seconds — the reported "stuck just below the hive".)
 */
function bbRoundBar(p: Vec2, to: Vec2): Vec2 | null {
  const endY = BB_FRAME_Y;
  const clear = 13;
  for (const sx of [-1, 1]) {
    const bx = sx * (BB_FRAME_BAR_IN + BB_FRAME_BAR_OUT) / 2;
    const sp = Math.sign(p.x - bx) || 1;
    const st = Math.sign(to.x - bx) || 1;
    if (sp === st) continue;
    // where the straight line meets the bar's line
    const k = (bx - p.x) / (to.x - p.x);
    const yCross = p.y + k * (to.y - p.y);
    if (Math.abs(yCross) > endY + 8) continue;
    const ey = (Math.sign(yCross) || Math.sign(to.y) || 1) * (endY + clear);
    // past the end already? then over to the target's side; otherwise out to the end first
    if (Math.abs(p.y) >= endY + clear - 3) return { x: bx + st * 10, y: ey };
    return { x: bx + sp * 10, y: ey };
  }
  return null;
}

function bbRoute(p: Vec2, to: Vec2): Vec2 {
  // ALONG A BAR, not across it: a straight run past a bar's END with the chassis within a
  // half-width of it drags the whole flank down the bar. Step out sideways first, still making
  // progress along y. (Crossing the bar line is `bbRoundBar`'s; a target beside the bar, not
  // past its end, is a pickup and is let through.)
  for (const bx of [-BAR_X, BAR_X]) {
    const sp = Math.sign(p.x - bx) || 1;
    if (Math.sign(to.x - bx) !== sp || Math.abs(p.x - bx) >= BAR_CLEAR - 1) continue;
    const past = Math.max(Math.abs(p.y), Math.abs(to.y)) > BB_FRAME_Y + 3;
    const spans = Math.min(p.y, to.y) < BB_FRAME_Y && Math.max(p.y, to.y) > -BB_FRAME_Y;
    if (past && spans && Math.abs(to.y - p.y) > 6) return { x: bx + sp * BAR_CLEAR, y: p.y + Math.sign(to.y - p.y) * 6 };
  }
  for (const b of BAR_BOXES) {
    if (inBox(to, b)) {
      const via = bbRoundBar(p, to);
      if (via) return via;
      continue;
    }
    // DEEP inside only (a dead band): a robot sitting ON the box edge flipped between this and
    // the corner route below every tick, and a tank shivered there for ten seconds
    if (inBox(p, b, 2)) {
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

/** the four FLOWER feet as field rectangles — built exactly as `colliders.ts` builds them */
const FOOT_BOXES: (Box & { nx: number; ny: number })[] = BB_FLOWERS.map((f) => {
  const n = f.wall === 'left' ? { x: 1, y: 0 } : f.wall === 'right' ? { x: -1, y: 0 } : f.wall === 'rear' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  const wx = f.x - n.x * BB_FLOWER_D;
  const wy = f.y - n.y * BB_FLOWER_D;
  const cx = wx + (n.x * BB_FLOWER_FOOT.deep) / 2;
  const cy = wy + (n.y * BB_FLOWER_FOOT.deep) / 2;
  const hx = n.x === 0 ? BB_FLOWER_FOOT.along / 2 : BB_FLOWER_FOOT.deep / 2;
  const hy = n.y === 0 ? BB_FLOWER_FOOT.along / 2 : BB_FLOWER_FOOT.deep / 2;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, nx: n.x, ny: n.y };
});

/**
 * An element tucked against the wall BESIDE a FLOWER foot, closer to it than half a chassis:
 * a sweeper square to the wall cannot centre on it without its flank meeting the foot, so the
 * bot drives into the foot at full stick and 0 in/s (measured: the hottest grind spots on the
 * field were all four feet), gives up, and comes back when the blacklist expires.
 */
function bbTuckedByFoot(p: Vec2, r: RobotState): boolean {
  const half = Math.min(r.spec.length, r.spec.width) / 2 - 0.5;
  for (const f of FOOT_BOXES) {
    // near the wall the foot stands on (within a pollen or two of it)
    const wallDist = f.nx !== 0 ? Math.abs(p.x - (f.nx > 0 ? f.x0 : f.x1)) : Math.abs(p.y - (f.ny > 0 ? f.y0 : f.y1));
    if (wallDist > 7) continue;
    const dx = Math.max(f.x0 - p.x, 0, p.x - f.x1);
    const dy = Math.max(f.y0 - p.y, 0, p.y - f.y1);
    if (Math.hypot(dx, dy) < half) return true;
  }
  return false;
}

function isTank(r: RobotState): boolean {
  return r.spec.drivetrain === 'tank' || (r.spec.drivetrain === 'butterfly' && r.butterflyTank);
}

function halfDiag(r: RobotState): number {
  return Math.hypot(r.spec.length, r.spec.width) / 2;
}

function clampField(p: Vec2): Vec2 {
  const m = C.FIELD_HALF - 12;
  return { x: clamp(p.x, -m, m), y: clamp(p.y, -m, m) };
}

/**
 * Build bots for a set of robot ids on ONE alliance, as one coordinated team. `firstSlot`
 * spreads their spots: the player's TEAMMATE bot takes slot 1, leaving slot 0's spots — the
 * obvious ones — to the human it is playing beside.
 */
/**
 * THE LADDER'S HABITS (BIOBUZZ). The defaults are NIGHTMARE's, the measured best; the lower
 * levels play without the habits that separate a strong driver from an ordinary one. Easy and
 * Normal wait for the HIVE to settle before they shoot, fill their own hopper instead of
 * reading the team's, and never plan around a swing. Hard has all of that but does not steal
 * the opponent's spill: it plays defence instead. Measured as a same-level 2v2 on Sniper, the
 * pair scores roughly Easy 125, Normal 300, Hard 450, Nightmare 520; head to head a Nightmare
 * pair beats a Hard pair by ~40 a match (11 of 16) and Hard beats Normal by ~160.
 */
const LEVEL_KNOBS: Record<BotLevel, Partial<BotKnobs>> = {
  easy: { preFire: -1, preFireDump: -1, teamTip: false, swingPlan: false, spillWait: false, spillSteal: false },
  normal: { preFire: -1, preFireDump: -1, teamTip: false, swingPlan: false, spillWait: false, spillSteal: false },
  hard: { spillSteal: false },
  nightmare: {},
};

export function makeBots(ids: number[], level: BotLevel, firstSlot = 0, knobs: BotKnobs = DEFAULT_KNOBS): OpponentBot[] {
  const team = new BotTeam();
  // a caller racing its own knobs (the tuning arena) gets exactly those; everyone else gets the level's
  const k = knobs === DEFAULT_KNOBS ? { ...DEFAULT_KNOBS, ...LEVEL_KNOBS[level] } : knobs;
  const bots = ids.map((id, i) => new OpponentBot(id, level, firstSlot + i, team, k));
  team.bots.push(...bots);
  return bots;
}
