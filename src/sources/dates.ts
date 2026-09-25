export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const iso = ({ day, month, year }: { day: number; month: number; year: number }) => {
  const full = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(full, month - 1, day));
  const valid = date.getUTCFullYear() === full && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
};

export const dateMatches = (text: string): { date: string; index: number; length: number }[] => {
  const numeric = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)].map((m) => ({
    m,
    date: iso({ day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) }),
  }));
  const named = [...text.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/g)].map((m) => {
    const month = MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1;
    return { m, date: month === 0 ? null : iso({ day: Number(m[1]), month, year: Number(m[3]) }) };
  });
  return [...numeric, ...named].flatMap(({ m, date }) => (date === null ? [] : [{ date, index: m.index, length: m[0].length }]));
};

export const datesIn = (text: string): string[] => dateMatches(text).map((match) => match.date);

export const firstDate = (text: string) => dateMatches(text).toSorted((a, b) => a.index - b.index)[0]?.date ?? null;

export const daysBefore = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

export const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

export const newestOf = (dates: (string | null | undefined)[]) => dates.filter((d): d is string => typeof d === 'string' && d !== '').sort().at(-1) ?? null;

const YEARLESS_BACK_DAYS = 7;

// No year: pick first match on or after a few days before `reference`.
export const yearlessDateMatches = (text: string, reference: string): { date: string; index: number; length: number }[] => {
  const earliest = daysBefore(reference, YEARLESS_BACK_DAYS);
  const year = Number(reference.slice(0, 4));
  return [...text.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\b(?!\s+\d{4})/g)].flatMap((m) => {
    const month = MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1;
    if (month === 0) return [];
    const same = iso({ day: Number(m[1]), month, year });
    const date = same !== null && same < earliest ? iso({ day: Number(m[1]), month, year: year + 1 }) : same;
    return date === null ? [] : [{ date, index: m.index, length: m[0].length }];
  });
};

export const latestDate = (text: string) => datesIn(text).sort().at(-1) ?? null;
