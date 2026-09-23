/**
 * OPPONENT BOT verification — `npm run test:bots`.
 *
 * Runs whole solo matches headless with the player idle and bots on the other alliance, the
 * same way `GameController.stepSolo` drives them (a command per tick, localized), and asserts
 * the bots actually PLAY: they move, a scorer scores, a defender closes on the player, nobody
 * leaves the field, and a recorded run re-simulates to the same result.
 *
 * Kept out of `npm test` for the same reason as `test:mm`: a red `npm test` must keep meaning
 * "physics broke", and these are controller checks.
 */
import * as C from '../src/config';
import { initPhysics } from '../src/sim/physicsEngine';
import { createWorld, DEFAULT_ASSISTS, DEFAULT_SPEC, type RobotSetup } from '../src/sim/spawn';
import { step } from '../src/sim/world';
import { localizeCommand } from '../src/net/protocol';
import { makeBots } from '../src/bots/opponentBot';
import type { BotLevel, BotStyle } from '../src/bots/botConfig';
import { ReplayRecorder, ReplayPlayer } from '../src/sim/replay';
import type { RobotCommand, World } from '../src/types';

await initPhysics();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const IDLE: RobotCommand = { driveX: 0, driveY: 0, rotate: 0, leftDrive: 0, rightDrive: 0, intake: false, fire: false };

function setups(n: number): RobotSetup[] {
  const s: RobotSetup[] = [
    { id: 0, alliance: 'blue', spec: DEFAULT_SPEC, assists: DEFAULT_ASSISTS, startIndex: 0 },
  ];
  for (let i = 0; i < n; i++) {
    s.push({
      id: 2 + i,
      alliance: 'red',
      spec: { ...DEFAULT_SPEC, name: `Bot ${i + 1}` },
      assists: { ...DEFAULT_ASSISTS, autoIntake: true, autoFire: true },
      startIndex: i,
    });
  }
  return s;
}

interface Run {
  world: World;
  travelled: Map<number, number>;
  minGap: number;
  outOfField: boolean;
  recorder: ReplayRecorder;
}

function runMatch(n: number, style: BotStyle, level: BotLevel, seed: number, maxTicks = Infinity): Run {
  const su = setups(n);
  const w = createWorld('match', seed, su);
  w.match.preCountdown = C.PRE_COUNTDOWN; // exactly what GameController.startMatch does
  const rec = new ReplayRecorder(seed, su, 'match', 'decode');
  const bots = makeBots(su.filter((s) => s.id !== 0).map((s) => s.id), style, level);
  const travelled = new Map<number, number>();
  let minGap = Infinity;
  let outOfField = false;
  let ticks = 0;
  while (w.match.phase !== 'post' && ticks < maxTicks) {
    const cmds = new Map<number, RobotCommand>([[0, localizeCommand(IDLE)]]);
    for (const b of bots) cmds.set(b.robotId, localizeCommand(b.command(w, 0)));
    const before = new Map(w.robots.map((r) => [r.id, { ...r.pos }]));
    step(w, C.SIM_DT, cmds);
    rec.record(w.tick, cmds);
    ticks++;
    const player = w.robots.find((r) => r.id === 0)!;
    for (const r of w.robots) {
      const p = before.get(r.id)!;
      travelled.set(r.id, (travelled.get(r.id) ?? 0) + Math.hypot(r.pos.x - p.x, r.pos.y - p.y));
      if (Math.abs(r.pos.x) > C.FIELD_HALF + 1 || Math.abs(r.pos.y) > C.FIELD_HALF + 1) outOfField = true;
      if (r.id !== 0 && w.match.phase === 'teleop') {
        minGap = Math.min(minGap, Math.hypot(r.pos.x - player.pos.x, r.pos.y - player.pos.y));
      }
    }
  }
  return { world: w, travelled, minGap, outOfField, recorder: rec };
}

// 1. one scorer bot actually scores
{
  const r = runMatch(1, 'scorer', 'hard', 7);
  const red = r.world.match.scores.red;
  check('scorer bot drives around', (r.travelled.get(2) ?? 0) > 300, `${(r.travelled.get(2) ?? 0).toFixed(0)}in`);
  check('scorer bot scores artifacts', red.total > 10, `red total ${red.total}`);
  check('scorer bot never leaves the field', !r.outOfField);
  check('idle player is left alone by a scorer', (r.travelled.get(0) ?? 0) < 200, `${(r.travelled.get(0) ?? 0).toFixed(0)}in`);
}

// 2. every level scores something
for (const level of ['easy', 'normal'] as BotLevel[]) {
  const r = runMatch(1, 'scorer', level, 11);
  check(`${level} scorer scores`, r.world.match.scores.red.total > 0, `red total ${r.world.match.scores.red.total}`);
}

// 3. a defender closes on the player in teleop
{
  const r = runMatch(1, 'defender', 'normal', 3);
  check('defender bot closes on the player', r.minGap < 30, `closest ${r.minGap.toFixed(1)}in`);
  check('defender bot never leaves the field', !r.outOfField);
}

// 4. mixed pair: both move, and the pair outscores an idle player
{
  const r = runMatch(2, 'mixed', 'normal', 5);
  check('mixed bot 1 moves', (r.travelled.get(2) ?? 0) > 200);
  check('mixed bot 2 moves', (r.travelled.get(3) ?? 0) > 200);
  check('mixed pair scores', r.world.match.scores.red.total > 0, `red ${r.world.match.scores.red.total}`);
}

// 5. a run with bots re-simulates from its replay (their commands are in the log)
{
  const r = runMatch(2, 'mixed', 'hard', 9, 60 * 45);
  const replay = JSON.parse(JSON.stringify(r.recorder.finish()));
  const p = new ReplayPlayer(replay);
  while (p.world.tick < r.world.tick) p.stepOnce();
  const a = r.world.robots.map((x) => `${x.pos.x.toFixed(4)},${x.pos.y.toFixed(4)}`).join('|');
  const b = p.world.robots.map((x) => `${x.pos.x.toFixed(4)},${x.pos.y.toFixed(4)}`).join('|');
  check('bot run replays identically', a === b);
  check('bot run replay score matches', p.world.match.scores.red.total === r.world.match.scores.red.total);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
