import { errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';
import { postJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// The NSW EPA register of prosecutions. The site is a Salesforce page, and
// this is the Apex call that its search form makes. It is not a documented
// API. The class ID can change when the EPA changes the site, and then the
// schema check fails loudly.
const API = 'https://legal.epa.nsw.gov.au/prpoeo/webruntime/api/apex/execute?language=en-US&asGuest=true&htmlEncode=false';
const REGISTER = 'https://legal.epa.nsw.gov.au/prpoeo/';
const CLASS_ID = '@udd/01p7F00000WT3G8';

// The search finds a party name that contains the text. Code keeps only
// companies, thus each page searches for one word of a company name. The full
// register in one response is 1.9 MB, too large for the CPU limit.
// A matter can be on more than one page. It has the same ID on each.
export const NAME_WORDS = ['pty', 'ltd', 'limited', 'council', 'corporation', 'authority'] as const;

// The CloudFront and Salesforce front end refuses requests without a browser user agent.
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; Trashboard/0.1)' };

const text = z.string().nullish().transform((value) => (value ?? '').trim());
const Charge = z.object({
  Charge_Description__c: text,
  Act_Regulation__c: text,
  Charge_Section__c: text,
  Court__c: text,
  Case_Number__c: text,
  Result__c: text,
  Fine__c: z.number().nullish(),
  Other_Penalty__c: text,
});
const Matter = z.object({ matterId: z.string().min(1), defendent: z.string(), dateOfCourtSentence: z.string().nullish(), matterRecs: z.array(Charge) });
type Matter = z.infer<typeof Matter>;
const Response = z.object({ returnValue: z.array(Matter) });

const aud = (n: number) => `$${n.toLocaleString('en-AU')}`;

const chargeLine = (c: z.infer<typeof Charge>) =>
  [
    `Charge: ${c.Charge_Description__c}`,
    c.Act_Regulation__c !== '' && `(${c.Act_Regulation__c}${c.Charge_Section__c !== '' ? ` s ${c.Charge_Section__c}` : ''})`,
    c.Court__c !== '' && `Court: ${c.Court__c}.`,
    c.Result__c !== '' && `Result: ${c.Result__c}.`,
    (c.Fine__c ?? 0) > 0 && `Fine: ${aud(c.Fine__c ?? 0)}.`,
    c.Other_Penalty__c !== '' && `Other penalty: ${c.Other_Penalty__c}`,
  ]
    .filter((part) => part !== false)
    .join(' ');

export const toRecord = (m: Matter) => {
  const fines = m.matterRecs.reduce((sum, c) => sum + (c.Fine__c ?? 0), 0);
  const party = m.defendent.trim();
  return {
    kind: 'enforcement',
    externalId: m.matterId,
    jurisdiction: 'NSW',
    title: `Prosecution: ${party}`,
    url: `${REGISTER}#${encodeURIComponent(m.matterId)}`,
    publishedAt: m.dateOfCourtSentence?.slice(0, 10) || null,
    body: m.matterRecs.map(chargeLine).join('\n'),
    party,
    action: 'Prosecution',
    location: null,
    // A fine of 0 can mean another order, for example a payment to a trust. Jev then reads the text.
    penaltyAud: fines > 0 ? fines : null,
  };
};

// The pipeline stores each record, thus one invocation takes at most this many matters.
const CHUNK = 300;
// The register adds a matter after the sentence. A run after the first reads again the matters
// from this many days before the newest date seen, and the upsert ignores the ones that did not change.
const REREAD_DAYS = 365;

// `newest` is the newest sentence date that the run has seen so far.
const PageState = z.object({ index: z.number().int().min(0), offset: z.number().int().min(0), newest: z.string().nullable() });
type PageState = z.infer<typeof PageState>;

const daysBefore = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const newestOf = (dates: (string | null | undefined)[]) => dates.filter((d): d is string => typeof d === 'string' && d !== '').sort().at(-1) ?? null;

const fetchPage = ({ state, cursor }: { state: PageState; cursor: string | null }) => {
  const word = NAME_WORDS[state.index];
  if (word === undefined) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url: API, message: `No search word for page ${state.index}.` });
  const body = { namespace: '', classname: CLASS_ID, method: 'searchRecords', isContinuation: false, params: { matterType: 'Prosecution', defendant: word }, cacheable: false };
  return postJson({ url: API, body, headers: HEADERS }).andThen(({ json, text: raw }) => {
    const parsed = Response.safeParse(json);
    if (!parsed.success) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url: API, message: parsed.error.message.slice(0, 500) });
    const from = cursor === null ? null : daysBefore(cursor, REREAD_DAYS);
    const matters = parsed.data.returnValue
      .filter((m) => from === null || (m.dateOfCourtSentence ?? '') >= from)
      .toSorted((a, b) => a.matterId.localeCompare(b.matterId));
    const chunk = matters.slice(state.offset, state.offset + CHUNK);
    const newest = newestOf([state.newest, ...chunk.map((m) => m.dateOfCourtSentence?.slice(0, 10))]);
    const moreInWord = state.offset + CHUNK < matters.length;
    const next = moreInWord
      ? { ...state, offset: state.offset + CHUNK, newest }
      : state.index + 1 < NAME_WORDS.length
        ? { index: state.index + 1, offset: 0, newest }
        : null;
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records: chunk.map(toRecord),
      cursor: newestOf([cursor, newest]),
      // The same response serves each chunk of a word. Keep it one time.
      raw: state.offset === 0 ? [{ name: `${word}.json`, body: raw }] : [],
      next,
    });
  });
};

export const nswProsecutions: Source = {
  id: 'nsw-prosecutions',
  name: 'NSW EPA prosecutions register',
  kind: 'enforcement',
  jurisdiction: 'NSW',
  homepage: REGISTER,
  run: ({ cursor, page }) => {
    if (page === null) return fetchPage({ state: { index: 0, offset: 0, newest: null }, cursor });
    const parsed = PageState.safeParse(page);
    return parsed.success ? fetchPage({ state: parsed.data, cursor }) : errAsync({ type: 'parse', url: API, message: 'The page state is not valid.' });
  },
};
