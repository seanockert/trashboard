import { z } from 'zod';
import { changed, paged, parseError, text } from './common';
import { daysBefore, newestOf } from './dates';
import { BROWSER_USER_AGENT, postJson } from './http';
import type { Source } from './types';

// Undocumented Salesforce Apex call. Class ID can change; schema check then fails.
const API = 'https://legal.epa.nsw.gov.au/prpoeo/webruntime/api/apex/execute?language=en-US&asGuest=true&htmlEncode=false';
const REGISTER = 'https://legal.epa.nsw.gov.au/prpoeo/';
const CLASS_ID = '@udd/01p7F00000WT3G8';

// Search is substring match. One company word per page: full register is 1.9 MB, over CPU limit.
const NAME_WORDS = ['pty', 'ltd', 'limited', 'council', 'corporation', 'authority'] as const;

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
const SearchResponse = z.object({ returnValue: z.array(Matter) });

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
    // Fine 0 can mean another order (e.g. trust payment). Jev reads text.
    penaltyAud: fines > 0 ? fines : null,
  };
};

const CHUNK = 300;
// Register adds matters after sentence: reread from before newest date.
const REREAD_DAYS = 365;

const PageState = z.object({ index: z.number().int().min(0), offset: z.number().int().min(0), newest: z.string().nullable() });
type PageState = z.infer<typeof PageState>;

const fetchPage = ({ state, cursor }: { state: PageState; cursor: string | null }) => {
  const word = NAME_WORDS[state.index];
  if (word === undefined) return parseError(API, `No search word for page ${state.index}.`);
  const body = { namespace: '', classname: CLASS_ID, method: 'searchRecords', isContinuation: false, params: { matterType: 'Prosecution', defendant: word }, cacheable: false };
  return postJson({ url: API, body, headers: { 'user-agent': BROWSER_USER_AGENT } }).andThen(({ json }) => {
    const parsed = SearchResponse.safeParse(json);
    if (!parsed.success) return parseError(API, parsed.error.message);
    const from = cursor === null ? null : daysBefore(cursor, REREAD_DAYS);
    const matters = parsed.data.returnValue
      .filter((m) => from === null || m.dateOfCourtSentence == null || m.dateOfCourtSentence >= from)
      .toSorted((a, b) => a.matterId.localeCompare(b.matterId));
    const chunk = matters.slice(state.offset, state.offset + CHUNK);
    const newest = newestOf([state.newest, ...chunk.map((m) => m.dateOfCourtSentence?.slice(0, 10))]);
    const moreInWord = state.offset + CHUNK < matters.length;
    const next = moreInWord
      ? { ...state, offset: state.offset + CHUNK, newest }
      : state.index + 1 < NAME_WORDS.length
        ? { index: state.index + 1, offset: 0, newest }
        : null;
    return changed({ records: chunk.map(toRecord), cursor: newestOf([cursor, newest]), next });
  });
};

export const nswProsecutions: Source = {
  id: 'nsw-prosecutions',
  name: 'NSW EPA prosecutions register',
  kind: 'enforcement',
  homepage: REGISTER,
  run: paged({
    url: API,
    state: PageState,
    first: ({ cursor }) => fetchPage({ state: { index: 0, offset: 0, newest: null }, cursor }),
    next: (state, { cursor }) => fetchPage({ state, cursor }),
  }),
};
