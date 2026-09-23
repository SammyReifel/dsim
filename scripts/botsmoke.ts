/**
 * OPPONENT BOT verification — `npm run test:bots`.
 *
 * Runs whole solo matches headless, the same way `GameController.stepSolo` drives bots (a
 * command per tick, localized, recorded), in all three games, and asserts the bots actually
 * PLAY: they move, they score, they use the parts of the game their level allows (the DECODE
 * gate, BIOBUZZ flowers, the CR ring stand), HARD defends and EASY/NORMAL never do, nobody
 * leaves the field, nobody gets a bot a MAJOR, and a recorded run re-simulates exactly.
 *
 * The "player" is either idle or a NORMAL bot on the other alliance — the second is what gives
 * a HARD team somebody carrying something worth defending against.
 *
 * Kept out of `npm test` for the same reason as `test:mm`: a red `npm test` must keep meaning
 * "physics broke", and these are controller checks.
 */
import * as C from '../src/config';
import { initPhysics } from '../src/sim/physicsEngine';
import { simModuleFor } from '../src/games/sim';
import { localizeCommand } from '../src/net/protocol';
import { makeBots, type OpponentBot } from '../src/bots/opponentBot';
import { botSetup } from '../src/bots/botSetup';
import type { BotLevel } from '../src/bots/botConfig';
import { ReplayRecorder, ReplayPlayer } from '../src/sim/replay';
import { flowerScore } from '../src/games/biobuzz/flower';
import type { GameId, RobotCommand, World } from '../src/types';

await initPhysics();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const IDLE: RobotCommand = { driveX: 0, driveY: 0, rotate: 0, leftDrive: 0, rightDrive: 0, intake: false, fire: false };

interface Run {
  world: World;
  bots: OpponentBot[];
  travelled: Map<number, number>;
  outOfField: boolean;
  defendTicks: number;
  /** ticks a bot spent within contact range of the player during teleop */
  nearPlayer: number;
  maxRamp: number;
  rampDrained: boolean;
  recorder: ReplayRecorder;
}

function runMatch(
  game: GameId,
  n: number,
  level: BotLevel,
  seed: number,
  opts: { player?: 'idle' | 'bot'; maxTicks?: number } = {},
): Run {
  const mod = simModuleFor(game);
  const su = [botSetup(game, 0, 'blue', 0)];
  for (let i = 0; i < n; i++) su.push(botSetup(game, 2 + i, 'red', i));
  const w = mod.createWorld('match', seed, su);
  w.match.preCountdown = C.PRE_COUNTDOWN; // exactly what GameController.startMatch does
  const rec = new ReplayRecorder(seed, su, 'match', game);
  const bots = makeBots(su.filter((s) => s.id !== 0).map((s) => s.id), level);
  const player = opts.player === 'bot' ? makeBots([0], 'normal')[0] : null;
  const travelled = new Map<number, number>();
  let outOfField = false;
  let defendTicks = 0;
  let nearPlayer = 0;
  let maxRamp = 0;
  let rampDrained = false;
  let ticks = 0;
  const maxTicks = opts.maxTicks ?? Infinity;
  while (w.match.phase !== 'post' && ticks < maxTicks) {
    const cmds = new Map<number, RobotCommand>([[0, localizeCommand(player ? player.command(w, 2) : IDLE)]]);
    for (const b of bots) cmds.set(b.robotId, localizeCommand(b.command(w, 0)));
    const before = new Map(w.robots.map((r) => [r.id, { ...r.pos }]));
    mod.step(w, C.SIM_DT, cmds);
    rec.record(w.tick, cmds);
    ticks++;
    if (bots[0]?.team.defenderId != null) defendTicks++;
    const p = w.robots.find((r) => r.id === 0)!;
    for (const r of w.robots) {
      const q = before.get(r.id)!;
      travelled.set(r.id, (travelled.get(r.id) ?? 0) + Math.hypot(r.pos.x - q.x, r.pos.y - q.y));
      if (Math.abs(r.pos.x) > C.FIELD_HALF + 1 || Math.abs(r.pos.y) > C.FIELD_HALF + 1) outOfField = true;
      if (r.id !== 0 && w.match.phase === 'teleop' && Math.hypot(r.pos.x - p.pos.x, r.pos.y - p.pos.y) < 30) nearPlayer++;
    }
    if (game === 'decode') {
      const ramp = w.balls.filter((b) => b.state.kind === 'rail' && b.state.goal === 'red' && !b.state.overflow).length;
      if (ramp >= 9) maxRamp = 9;
      if (maxRamp >= 9 && ramp <= 4) rampDrained = true;
    }
  }
  return { world: w, bots, travelled, outOfField, defendTicks, nearPlayer, maxRamp, rampDrained, recorder: rec };
}

const majors = (w: World): number => w.match.fouls.red.major;
const redTotal = (w: World): number => w.match.scores.red.total;

function replays(name: string, r: Run): void {
  const replay = JSON.parse(JSON.stringify(r.recorder.finish()));
  const p = new ReplayPlayer(replay);
  while (p.world.tick < r.world.tick) p.stepOnce();
  const pose = (w: World): string => w.robots.map((x) => `${x.pos.x.toFixed(4)},${x.pos.y.toFixed(4)}`).join('|');
  check(`${name}: replays identically`, pose(p.world) === pose(r.world));
  check(`${name}: replay score matches`, redTotal(p.world) === redTotal(r.world), `${redTotal(p.world)} vs ${redTotal(r.world)}`);
}

// ── DECODE ──────────────────────────────────────────────────────────────────
{
  const r = runMatch('decode', 1, 'normal', 7);
  check('decode normal: drives around', (r.travelled.get(2) ?? 0) > 300, `${(r.travelled.get(2) ?? 0).toFixed(0)}in`);
  check('decode normal: scores', redTotal(r.world) > 60, `red ${redTotal(r.world)}`);
  check('decode normal: parks in its base', r.world.match.scores.red.base > 0, `base ${r.world.match.scores.red.base}`);
  check('decode normal: never leaves the field', !r.outOfField);
  check('decode normal: never defends', r.defendTicks === 0);
  check('decode normal: leaves an idle player alone', (r.travelled.get(0) ?? 0) < 40, `${(r.travelled.get(0) ?? 0).toFixed(0)}in`);
  if (r.maxRamp >= 9) check('decode normal: drains its own full ramp', r.rampDrained);
}
{
  const r = runMatch('decode', 1, 'easy', 11);
  check('decode easy: scores', redTotal(r.world) > 0, `red ${redTotal(r.world)}`);
  check('decode easy: never defends', r.defendTicks === 0);
}
{
  const r = runMatch('decode', 2, 'hard', 5, { player: 'bot' });
  check('decode hard pair: scores', redTotal(r.world) > 60, `red ${redTotal(r.world)}`);
  check('decode hard pair: defends while the player carries', r.defendTicks > 300, `${r.defendTicks} ticks`);
  check('decode hard pair: both bots move', (r.travelled.get(2) ?? 0) > 200 && (r.travelled.get(3) ?? 0) > 200);
  check('decode hard pair: never leaves the field', !r.outOfField);
  check('decode hard pair: no majors (gate, base and zone manners)', majors(r.world) === 0, JSON.stringify(r.world.match.fouls.red));
}
replays('decode hard pair (45s)', runMatch('decode', 2, 'hard', 9, { player: 'bot', maxTicks: 60 * 45 }));

// ── BIOBUZZ ─────────────────────────────────────────────────────────────────
{
  const r = runMatch('biobuzz', 1, 'normal', 7);
  const tips = r.world.biobuzz?.hives.red.tips ?? 0;
  const bb = r.world.biobuzz!;
  const kindOf = (id: number): 'pollen' | 'red' | 'blue' => {
    const c = r.world.balls.find((b) => b.id === id)?.color;
    return c === 'red' || c === 'blue' ? c : 'pollen';
  };
  const owned = bb.flowers.filter((f) => flowerScore(f.stack, kindOf).owner === 'red').length;
  check('biobuzz normal: tips its hive several times', tips >= 3, `${tips} tips`);
  check('biobuzz normal: owns a flower at the buzzer', owned >= 1, `${owned} flowers`);
  check('biobuzz normal: scores', redTotal(r.world) > 60, `red ${redTotal(r.world)}`);
  check('biobuzz normal: no fouls', majors(r.world) + r.world.match.fouls.red.minor === 0, JSON.stringify(r.world.match.fouls.red));
  check('biobuzz normal: never defends', r.defendTicks === 0);
  check('biobuzz normal: never leaves the field', !r.outOfField);
}
{
  const r = runMatch('biobuzz', 1, 'easy', 3);
  check('biobuzz easy: tips its hive', (r.world.biobuzz?.hives.red.tips ?? 0) >= 1);
  check('biobuzz easy: no majors', majors(r.world) === 0, JSON.stringify(r.world.match.fouls.red));
}
{
  const r = runMatch('biobuzz', 2, 'hard', 5, { player: 'bot' });
  check('biobuzz hard pair: tips its hive', (r.world.biobuzz?.hives.red.tips ?? 0) >= 2, `${r.world.biobuzz?.hives.red.tips} tips`);
  check('biobuzz hard pair: defends while the player carries', r.defendTicks > 300, `${r.defendTicks} ticks`);
  check('biobuzz hard pair: no majors', majors(r.world) === 0, JSON.stringify(r.world.match.fouls.red));
  replays('biobuzz hard pair', r);
}

// ── CHAIN REACTION ──────────────────────────────────────────────────────────
{
  const r = runMatch('chain', 1, 'normal', 7);
  check('chain normal: scores particles', r.world.match.scores.red.total > 20, `red ${r.world.match.scores.red.total}`);
  check('chain normal: ascends a ring stand', r.world.chain?.endgame[2] === 'ascended', `${r.world.chain?.endgame[2]}`);
  check('chain normal: never leaves the field', !r.outOfField);
  check('chain normal: no majors', majors(r.world) === 0, JSON.stringify(r.world.match.fouls.red));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
