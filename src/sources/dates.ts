// Australian dates in free text: 7/8/2026, 07/08/26, 7 August 2026.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const iso = ({ day, month, year }: { day: number; month: number; year: number }) => {
  const full = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(full, month - 1, day));
  const valid = date.getUTCFullYear() === full && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
};

export const datesIn = (text: string): string[] => {
  const numeric = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)].map((m) =>
    iso({ day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) }),
  );
  const named = [...text.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/g)].map((m) => {
    const month = MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1;
    return month === 0 ? null : iso({ day: Number(m[1]), month, year: Number(m[3]) });
  });
  return [...numeric, ...named].filter((date): date is string => date !== null);
};

export const latestDate = (text: string) => datesIn(text).sort().at(-1) ?? null;

// The sum of the dollar amounts in a cell, for example "$3750 $11,250".
export const dollarTotal = (text: string) => {
  const amounts = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) => Number((m[1] ?? '').replace(/,/g, '')));
  return amounts.length === 0 ? null : amounts.reduce((sum, n) => sum + n, 0);
};
