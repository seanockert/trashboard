import { addJevTokens, jevTokensOn } from '../db';
import { USD_PER_MILLION_INPUT_TOKENS } from './tag';

// Tagging and search together. A full retag of about 4,500 items costs about US$0.75.
export const DAILY_CAP_USD = 1;
const CAP_TOKENS = (DAILY_CAP_USD * 1e6) / USD_PER_MILLION_INPUT_TOKENS;

// Brisbane day, same as the daily run.
const dayOf = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });

// Parallel requests can go a little over the cap.
export const capReached = (db: D1Database) => async (now = new Date()) => (await jevTokensOn(db)(dayOf(now))) >= CAP_TOKENS;

// A failed write only logs: the Jev answers are already paid for.
export const recordSpend = (db: D1Database) => async ({ inputTokens, now = new Date() }: { inputTokens: number; now?: Date }) => {
  if (inputTokens <= 0) return;
  await addJevTokens(db)({ day: dayOf(now), inputTokens }).catch((error: unknown) => console.error(JSON.stringify({ event: 'spend_save_failed', inputTokens, error: String(error) })));
};
