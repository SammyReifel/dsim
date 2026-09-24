import { useEffect, useState } from 'react';
import type { GameSettings } from '../game';
import type { DrivetrainType, GameId } from '../types';
import { APP_BLURB, APP_NAME, LINKS, fullNameOf, seasonFor } from '../seasons';
import { fetchGlobalStats, type GlobalStats } from '../net/api';
import { RAIL_ITEMS } from './NavRail';
import { QueueCounts } from './QueueCounts';
import { SponsorPresents } from './Sponsor';
import { FieldPlate } from './FieldPlate';
import type { ShellNav } from './AppShell';

const DRIVETRAIN_LABELS: Record<DrivetrainType, string> = {
  mecanum: 'Mecanum',
  tank: 'Tank',
  swerve: 'Swerve',
  xdrive: 'X-Drive',
  butterfly: 'Butterfly',
};

/**
 * The main menu, as the COVER of the Parts Catalog: the wordmark and one gold order button
 * (Play) on the left, the field drawn as a catalog plate on the right, the other three
 * destinations as an index beneath the button. On every other screen the same four live in
 * the left rail (`NavRail`); both read `RAIL_ITEMS` so they can never drift apart.
 *
 * It is also the site's landing page, so it states what DSIM is exactly once
 * (`APP_BLURB`) — a first-time visitor and a crawler both arrive here with no
 * other context. One sentence, no pitch. The static fallback in `index.html`
 * says the same sentence for clients that never run the bundle.
 */
export function HomeMenu({
  settings,
  multiplayer,
  onNav,
  onGame: _onGame,
}: {
  settings: GameSettings;
  /** the game server is configured — gates the live player counters */
  multiplayer: boolean;
  onNav: (n: ShellNav) => void;
  /** switch the selected game. Unused while BIOBUZZ is the only visible season; kept so the
   * picker can come back without re-plumbing App. */
  onGame: (g: GameId) => void;
}) {
  const spec = settings.spec;

  // site-wide counters (players + games played), when the server is configured
  const [stats, setStats] = useState<GlobalStats | null>(null);
  useEffect(() => {
    if (!multiplayer) return;
    let alive = true;
    fetchGlobalStats()
      .then((s) => alive && setStats(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [multiplayer]);

  const season = seasonFor(settings.game);
  const [play, ...rest] = RAIL_ITEMS;
  const played = stats ? (stats.byGame?.[settings.game] ?? stats.games) : null;

  return (
    <div className="cat-cover">
      <div className="cat-cover-copy">
        <h1 className="cat-wordmark">{APP_NAME}</h1>
        <p className="cat-edition">
          {fullNameOf(season)} · {season.program} {season.years}
        </p>
        {/* the app's presenting sponsor: the home placement, contracted (docs/sponsor.md) */}
        <SponsorPresents />
        <p className="cat-lead">{APP_BLURB}</p>

        <button className="cat-order" onClick={() => onNav(play.id)}>
          <span className="cat-order-l">
            {play.label}
            <QueueCounts className="menu" />
          </span>
          <span className="cat-order-h">Solo practice, bots, ranked and custom rooms</span>
          <svg className="cat-order-arrow" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </button>

        <nav className="cat-index" aria-label="Main">
          {rest.map((it) => (
            <button key={it.id} className="cat-index-row" onClick={() => onNav(it.id)}>
              <span className="ci-l">{it.label}</span>
              <span className="ci-h">{it.hint}</span>
              <svg className="ci-arrow" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </button>
          ))}
        </nav>

        <dl className="cat-spec">
          <div>
            <dt>Robot</dt>
            <dd>{spec.name}</dd>
          </div>
          <div>
            <dt>Drivetrain</dt>
            <dd>{DRIVETRAIN_LABELS[spec.drivetrain]}</dd>
          </div>
          <div>
            <dt>Team</dt>
            <dd>{spec.teamNumber ? `#${spec.teamNumber}` : 'None'}</dd>
          </div>
          {stats && (
            <div>
              <dt>Players</dt>
              <dd>{stats.users.toLocaleString()}</dd>
            </div>
          )}
          {played !== null && (
            <div>
              <dt>Matches played</dt>
              <dd>{played.toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>

      <figure className="cat-plate">
        <FieldPlate />
        <figcaption>The {season.name} field, drawn from the same geometry the robots drive on.</figcaption>
      </figure>

      <div className="cat-cover-foot">
        <div className="ds-home-links">
        <a className="ds-home-link" href={LINKS.discord} target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
          Discord
        </a>
        <a className="ds-home-link" href={LINKS.instagram} target="_blank" rel="noreferrer">
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
            <circle cx="12" cy="12" r="4.25" />
            <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
          </svg>
          Instagram
        </a>
        <a className="ds-home-link" href={LINKS.repo} target="_blank" rel="noreferrer">
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub
        </a>
      </div>

      </div>
    </div>
  );
}
