/**
 * The opponent-bot settings vocabulary. A LEAF module (no imports) so `settings.ts` can
 * validate against it without pulling the bot brain — and through it the sim — into the
 * settings load path.
 *
 * There is no "style" setting: the LEVEL decides how bots play. Easy and Normal just play the
 * game; Hard coordinates, and one of a pair drops back to defend whenever the player is
 * carrying something worth stopping; Nightmare drives a faster robot flat out and plays to
 * WIN — it defends only once it is ahead, so it can never lose by not scoring.
 */
export type BotLevel = 'easy' | 'normal' | 'hard' | 'nightmare';

export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'nightmare'];
/** at most two opponents: ids 2 and 3, the only opposing slots a solo world has */
export const MAX_OPPONENT_BOTS = 2;
