/**
 * The opponent-bot settings vocabulary. A LEAF module (no imports) so `settings.ts` can
 * validate against it without pulling the bot brain — and through it the sim — into the
 * settings load path.
 */
export type BotStyle = 'scorer' | 'defender' | 'mixed';
export type BotLevel = 'easy' | 'normal' | 'hard';

export const BOT_STYLES: readonly BotStyle[] = ['scorer', 'defender', 'mixed'];
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard'];
/** at most two opponents: ids 2 and 3, the only opposing slots a solo world has */
export const MAX_OPPONENT_BOTS = 2;
