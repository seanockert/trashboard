import { changed, tryParse } from './common';
import { firstDate } from './dates';
import { BROWSER_USER_AGENT, getText } from './http';
import { slug, withUniqueIds } from './ids';
import { readTables } from './table';
import type { Source } from './types';

const PAGE = 'https://www.epa.sa.gov.au/public_register/completed_prosecutions_and_civil_penalties';

const toRecord = ([offender = '', incident = '', outcome = '']: string[]) => {
  const civil = /civil penalty/i.test(outcome);
  return {
    kind: 'enforcement',
    externalId: slug(`${offender} ${incident.slice(0, 40)}`),
    jurisdiction: 'SA',
    title: `${civil ? 'Civil penalty' : 'Prosecution'}: ${offender}`,
    url: PAGE,
    // The outcome text starts with the date of the court order or penalty.
    publishedAt: firstDate(outcome),
    body: `Incident: ${incident}\nOutcome: ${outcome}`,
    party: offender,
    action: civil ? 'Civil penalty' : 'Prosecution',
    location: null,
    penaltyAud: null,
  };
};

export const parseSaPage = (html: string) =>
  withUniqueIds(
    readTables(html)
      .filter((table) => table.headers.map((h) => h.toLowerCase()).join('|') === 'offender|incident|outcome')
      .flatMap((table) => table.rows.map(toRecord)),
  );

export const saProsecutions: Source = {
  id: 'sa-prosecutions',
  name: 'SA EPA completed prosecutions and civil penalties',
  kind: 'enforcement',
  jurisdiction: 'SA',
  homepage: PAGE,
  run: () =>
    getText({ url: PAGE, headers: { 'user-agent': BROWSER_USER_AGENT } })
      .andThen(({ text }) => tryParse(PAGE, () => parseSaPage(text)))
      .andThen((records) => changed({ records })),
};
