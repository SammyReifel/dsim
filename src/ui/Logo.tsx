/**
 * DSIM mark — a top-down robot with a raised barrel on a flat HONEY badge (the Parts
 * Catalog's one committed colour), graphite linework, no gradient. Self-contained literal
 * colours so the same artwork doubles as `public/favicon.svg` — a favicon file can't read
 * the `--ds-*` vars, so these hexes are deliberate. Keep the two files in sync.
 * `aria-hidden` — the wordmark beside it carries the name.
 */
export function Logo({ size = 24, radius = 4 }: { size?: number; radius?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx={radius} fill="#f5b400" />
      <g stroke="#14171a" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
        {/* chassis */}
        <rect x="7" y="10.5" width="18" height="14.5" rx="1.5" fill="none" />
        {/* barrel */}
        <line x1="16" y1="14.6" x2="16" y2="5.5" />
      </g>
      {/* turret */}
      <circle cx="16" cy="17.7" r="3.1" fill="#14171a" />
    </svg>
  );
}
