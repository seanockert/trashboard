import { ResultAsync } from 'neverthrow';
import { dollarTotal, latestDate } from './dates';
import { getText } from './http';
import { slug, withUniqueIds } from './ids';
import { readTables, type HtmlTable } from './table';
import type { Source, SourceError } from './types';

const PAGE = 'https://www.wa.gov.au/service/environment/business-and-community-assistance/environmental-enforcement';


type Columns = Record<string, string>;
const byHeader = (table: HtmlTable) => table.rows.map((row): Columns => Object.fromEntries(table.headers.map((h, i) => [h.toLowerCase(), row[i] ?? ''])));
const col = (row: Columns, prefix: string) => Object.entries(row).find(([header]) => header.startsWith(prefix))?.[1] ?? '';

const notices = (rows: Columns[]) =>
  rows.map((row) => {
    const type = col(row, 'notice type');
    const party = col(row, 'person to whom');
    return {
      kind: 'enforcement',
      externalId: `notice-${slug(col(row, 'notice number'))}`,
      jurisdiction: 'WA',
      title: `${type === 'EPN' ? 'Environmental protection notice' : type || 'Notice'}: ${party}`,
      url: PAGE,
      publishedAt: latestDate(col(row, 'date of issue')),
      body: [`Notice type: ${type}`, `Premises: ${col(row, 'premise')}`, `Status: ${col(row, 'status')}`, `Amendments: ${col(row, 'notice amendments')}`]
        .filter((line) => !line.endsWith(': '))
        .join('\n'),
      party,
      action: type === 'EPN' ? 'Environmental protection notice' : type || 'Notice',
      location: col(row, 'suburb') || null,
      penaltyAud: null,
    };
  });

const penaltyNotices = (rows: Columns[]) =>
  rows.map((row) => {
    const party = col(row, 'person to whom');
    return {
      kind: 'enforcement',
      externalId: `mpn-${slug(`${party} ${col(row, 'date of offence')}`)}`,
      jurisdiction: 'WA',
      title: `Modified penalty notice: ${party}`,
      url: PAGE,
      publishedAt: latestDate(col(row, 'date paid')) ?? latestDate(col(row, 'date of offence')),
      body: [`Offence: ${col(row, 'offence under')}`, `Summary: ${col(row, 'summary')}`, `Date of offence: ${col(row, 'date of offence')}`, `Penalty: ${col(row, 'penalty')}`].join('\n'),
      party,
      action: 'Modified penalty notice',
      location: null,
      penaltyAud: dollarTotal(col(row, 'penalty')),
    };
  });

const prosecutions = (rows: Columns[]) =>
  rows.map((row) => {
    const party = col(row, 'offender');
    return {
      kind: 'enforcement',
      externalId: `prosecution-${slug(`${party} ${col(row, 'date of offence')} ${col(row, 'date of conviction')}`)}`,
      jurisdiction: 'WA',
      title: `Prosecution: ${party}`,
      url: PAGE,
      publishedAt: latestDate(col(row, 'date of conviction')),
      body: [
        `Charges: ${col(row, 'charges')}`,
        `Summary: ${col(row, 'summary')}`,
        `Date of offence: ${col(row, 'date of offence')}`,
        `Conviction: ${col(row, 'date of conviction')}`,
        `Penalty: ${col(row, 'penalty')}`,
        `Other orders: ${col(row, 'other costs')}`,
      ].join('\n'),
      party,
      action: 'Prosecution',
      location: col(row, 'address') || null,
      penaltyAud: dollarTotal(col(row, 'penalty')),
    };
  });

export const parseWaPage = (html: string) =>
  withUniqueIds(readTables(html).flatMap((table) => {
    const headers = table.headers.map((h) => h.toLowerCase());
    const rows = byHeader(table);
    if (headers.includes('offender')) return prosecutions(rows);
    if (headers.some((h) => h.startsWith('person to whom mpn'))) return penaltyNotices(rows);
    if (headers.includes('notice number')) return notices(rows);
    // Vegetation conservation notices are about land clearing, not waste.
    return [];
  }));

export const waEnforcement: Source = {
  id: 'wa-enforcement',
  name: 'WA DWER environmental enforcement',
  kind: 'enforcement',
  jurisdiction: 'WA',
  homepage: PAGE,
  run: () =>
    getText({ url: PAGE }).andThen(({ text }) =>
      ResultAsync.fromPromise(
        Promise.resolve().then(() => parseWaPage(text)),
        (cause): SourceError => ({ type: 'parse', url: PAGE, message: String(cause) }),
      ).map((records) => ({ type: 'changed' as const, records, cursor: null, next: null, raw: [{ name: 'environmental-enforcement.html', body: text }] })),
    ),
};
