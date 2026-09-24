import {
  BB_FLOWER_D,
  BB_FLOWER_FOOT,
  BB_FLOWERS,
  BB_FRAME_BAR_IN,
  BB_FRAME_BAR_OUT,
  BB_FRAME_Y,
  BB_GARDEN,
  BB_HALF_X,
  BB_HALF_Y,
  BB_HIVE_CELL_DY,
  BB_HIVE_CELL_LEN,
  BB_HIVE_LEN,
  BB_HIVE_W,
  BB_HIVE_X,
  BB_LZ,
} from '../games/biobuzz/config';

/**
 * THE FIELD PLATE — the BIOBUZZ field as a catalog line drawing, built from the SAME
 * constants the sim collides against (`src/games/biobuzz/config.ts`), so the cover of the app
 * is the real field and not an illustration of one. Field frame: +x audience-right, +y away
 * from the audience; SVG y points down, so every y is negated.
 *
 * Callouts sit OUTSIDE the field on leader lines, the way a parts catalog labels a drawing.
 * Colour is spent the catalog's way: graphite hairlines on the plate, honey on the HIVES (the
 * thing the whole game turns on), alliance red/blue only as a tint on the zones they own.
 */
const HX = BB_HALF_X;
const HY = BB_HALF_Y;
/** callout room either side: the long labels (LOADING ZONE) sit on the left */
const PAD_L = 62;
const PAD_R = 40;

type Rect = { x0: number; x1: number; y0: number; y1: number };
const svgRect = (r: Rect) => ({ x: r.x0, y: -r.y1, width: r.x1 - r.x0, height: r.y1 - r.y0 });

const NORMAL: Record<(typeof BB_FLOWERS)[number]['wall'], { x: number; y: number }> = {
  left: { x: 1, y: 0 },
  rear: { x: 0, y: -1 },
  right: { x: -1, y: 0 },
  audience: { x: 0, y: 1 },
};

function footOf(f: (typeof BB_FLOWERS)[number]): Rect {
  const n = NORMAL[f.wall];
  const wx = f.x - n.x * BB_FLOWER_D;
  const wy = f.y - n.y * BB_FLOWER_D;
  const half = BB_FLOWER_FOOT.along / 2;
  const deep = BB_FLOWER_FOOT.deep / 2;
  const cx = wx + n.x * deep;
  const cy = wy + n.y * deep;
  const hx = n.x === 0 ? half : deep;
  const hy = n.y === 0 ? half : deep;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

/** one labelled leader: from a point on the drawing out to a label beyond the field edge */
function Callout({ from, to, label, anchor }: { from: [number, number]; to: [number, number]; label: string; anchor: 'start' | 'end' }) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const run = anchor === 'start' ? 6 : -6;
  return (
    <g className="fp-callout">
      <circle cx={fx} cy={-fy} r={1.1} />
      <polyline points={`${fx},${-fy} ${tx},${-ty} ${tx + run},${-ty}`} />
      <text x={tx + run + (anchor === 'start' ? 1.6 : -1.6)} y={-ty} textAnchor={anchor} dominantBaseline="middle">
        {label}
      </text>
    </g>
  );
}

export function FieldPlate({ className }: { className?: string }) {
  const hive = (sx: number) => {
    const x0 = sx * BB_HIVE_X - BB_HIVE_W / 2;
    const cells = [1, -1].map((s) => ({
      x0,
      x1: x0 + BB_HIVE_W,
      y0: s * BB_HIVE_CELL_DY - BB_HIVE_CELL_LEN / 2,
      y1: s * BB_HIVE_CELL_DY + BB_HIVE_CELL_LEN / 2,
    }));
    return (
      <g className="fp-hive">
        <rect className="fp-hive-body" {...svgRect({ x0, x1: x0 + BB_HIVE_W, y0: -BB_HIVE_LEN / 2, y1: BB_HIVE_LEN / 2 })} />
        {cells.map((c, i) => (
          <rect key={i} className={`fp-cell${i === 0 ? ' up' : ''}`} {...svgRect(c)} />
        ))}
        <line className="fp-pivot" x1={x0} x2={x0 + BB_HIVE_W} y1={0} y2={0} />
      </g>
    );
  };
  const bar = (sx: number) =>
    svgRect({
      x0: sx > 0 ? BB_FRAME_BAR_IN : -BB_FRAME_BAR_OUT,
      x1: sx > 0 ? BB_FRAME_BAR_OUT : -BB_FRAME_BAR_IN,
      y0: -BB_FRAME_Y,
      y1: BB_FRAME_Y,
    });
  const tiles = [];
  for (let i = -2; i <= 2; i++) tiles.push(i * 24);

  return (
    <svg
      className={`fp ${className ?? ''}`}
      viewBox={`${-HX - PAD_L} ${-HY - 14} ${2 * HX + PAD_L + PAD_R} ${2 * HY + 28}`}
      role="img"
      aria-label="The BIOBUZZ field from above: two hives in the middle, a flower on each wall, the gardens and the loading zones"
    >
      {/* tile seams: the 24-in foam tiles every FTC field is laid in */}
      <g className="fp-seams">
        {tiles.map((t) => (
          <line key={`v${t}`} x1={t} x2={t} y1={-HY} y2={HY} />
        ))}
        {tiles.map((t) => (
          <line key={`h${t}`} y1={t} y2={t} x1={-HX} x2={HX} />
        ))}
      </g>
      <rect className="fp-lz red" {...svgRect(BB_LZ.red)} />
      <rect className="fp-lz blue" {...svgRect(BB_LZ.blue)} />
      <rect className="fp-garden red" {...svgRect(BB_GARDEN.red)} />
      <rect className="fp-garden blue" {...svgRect(BB_GARDEN.blue)} />
      <rect className="fp-wall" x={-HX} y={-HY} width={2 * HX} height={2 * HY} />
      <rect className="fp-bar" {...bar(1)} />
      <rect className="fp-bar" {...bar(-1)} />
      {hive(-1)}
      {hive(1)}
      {BB_FLOWERS.map((f) => (
        <g key={f.id} className={`fp-flower ${f.nearest}`}>
          <rect {...svgRect(footOf(f))} />
          <circle cx={f.x} cy={-f.y} r={2.2} />
        </g>
      ))}
      <Callout from={[-BB_HIVE_X, BB_HIVE_CELL_DY]} to={[-HX - 8, 52]} label="HIVE" anchor="end" />
      <Callout from={[BB_FLOWERS[1].x, BB_FLOWERS[1].y]} to={[-HX - 8, 66]} label="FLOWER" anchor="end" />
      <Callout from={[-60, -71]} to={[-HX - 8, -60]} label="GARDEN" anchor="end" />
      <Callout from={[-66, 36]} to={[-HX - 8, 30]} label="LOADING ZONE" anchor="end" />
      <Callout from={[BB_FRAME_BAR_OUT, -BB_FRAME_Y + 4]} to={[HX + 8, -40]} label="FRAME" anchor="start" />
      <Callout from={[BB_HIVE_X, -BB_HIVE_CELL_DY]} to={[HX + 8, -8]} label="CELL" anchor="start" />
      <text className="fp-dim" x={0} y={HY + 10} textAnchor="middle">
        12 FT × 12 FT · AUDIENCE
      </text>
    </svg>
  );
}
