// Code matches names, thus a group is never a model guess.
export const PARTY_GROUPS = [
  { id: 'jjr', label: 'JJ Richards', pattern: /\bj\.?\s?j\.?\s?richards\b|\bjj'?s waste\b|\bsouthern oil collections\b|\bcreatenergy\b|\bhandybin\b/i },
  { id: 'cleanaway', label: 'Cleanaway', pattern: /\bcleanaway\b|\btoxfree\b|\btransPacific\b|\bcitywide waste\b|\bcontract resources\b/i },
  { id: 'veolia', label: 'Veolia', pattern: /\bveolia\b/i },
  { id: 'remondis', label: 'Remondis', pattern: /\bremondis\b|\brethink\b/i },
  { id: 'suez', label: 'Suez', pattern: /\bsuez\b|\bsita\b/i },
  { id: 'bingo', label: 'Bingo', pattern: /\bbingo (industries|recycling|waste)\b|\bdial a dump\b/i },
  { id: 'solo', label: 'Solo Resource Recovery', pattern: /\bsolo (resource recovery|waste)\b/i },
  { id: 'regroup', label: 'Re.Group', pattern: /\bre\.?group\b/i },
  { id: 'sulo', label: 'SULO', pattern: /\bsulo\b/i },
  { id: 'visy', label: 'Visy', pattern: /\bvisy\b/i },
  { id: 'sims', label: 'Sims', pattern: /\bsims (metal|limited|group|lifecycle)\b/i },
  { id: 'enviropacific', label: 'Enviropacific', pattern: /\benviropacific\b/i },
] as const;

type PartyGroupId = (typeof PARTY_GROUPS)[number]['id'];

export const findPartyGroup = (name: string): PartyGroupId | null =>
  PARTY_GROUPS.find((group) => group.pattern.test(name))?.id ?? null;

// Privacy: no entity word means maybe a person, thus drop before storage.
// "Services" and ABN not on list: sole traders use them.
const COMPANY_MARKER =
  /\b(pty|proprietary|ltd|limited|inc|incorporated|corporation|co-?operative|council|shire|authority|department|university|gmbh|plc|llc|nl)\b|\bACN\s*\d/i;

// Brackets do not count ("John Smith (Director, X Pty Ltd)"), except brackets with an ACN.
const withoutBrackets = (name: string) => name.replace(/\((?!\s*ACN)[^)]*\)/gi, ' ');

const NAMES_A_PERSON = /\b(director|officer|manager|trustee for)\b/i;

const wordsBeforeMarker = (part: string) => {
  const at = part.search(COMPANY_MARKER);
  return at < 0 ? 0 : part.slice(0, at).trim().split(/\s+/).filter((w) => w !== '').length;
};

const wordCount = (text: string) => text.trim().split(/\s+/).filter((w) => w !== '').length;

// Rule of thumb for "&". When wrong, it drops a company, never keeps a person.
const TRADE_WORD = /\b(auto|car|removal|wreckers?|demolition|asbestos|steel|metal|recycling|waste|salvage|hides|transport|investments|holdings|educational|centre|services|industries)\b/i;
const INITIALS_ONLY = /^([A-Z]{1,2}\.?[\s,]*)+$/;
const canBePerson = (text: string) => wordCount(text) >= 2 && !TRADE_WORD.test(text) && !INITIALS_ONLY.test(text.trim());

const splitAmpersand = (part: string): string[] => {
  const [before, ...rest] = part.split(/\s+&\s+/);
  const after = rest.join(' & ');
  if (before === undefined || after === '') return [part];
  const twoParties = !COMPANY_MARKER.test(after) || (wordsBeforeMarker(after) >= 2 && canBePerson(before));
  return twoParties ? [before, ...splitAmpersand(after)] : [part];
};

// Increase when isCompanyName is stricter. Sources then purge failing records one time.
export const COMPANY_RULE_VERSION = 1;

// Each named party must be a company.
export const isCompanyName = (name: string): boolean =>
  !NAMES_A_PERSON.test(name) &&
  withoutBrackets(name)
    .split(/\s+and\s+|;/i)
    .flatMap(splitAmpersand)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .every((part) => COMPANY_MARKER.test(part));

// Increase on pattern change. Older items get their group again.
export const PARTIES_VERSION = 1;

export const JJR = PARTY_GROUPS[0];

const COMMON_WORD_ALIASES = /\brethink\b/gi;

// Competitors match title only (passing mentions, common-word aliases). JJ Richards matches body too, first.
export const mentionedGroup = ({ title, body }: { title: string; body: string }): PartyGroupId | null =>
  JJR.pattern.test(`${title}\n${body}`) ? JJR.id : findPartyGroup(title.replace(COMMON_WORD_ALIASES, ' '));

export const groupOf = (item: { kind: 'regulatory' | 'enforcement'; party: string | null; title: string; body: string }): PartyGroupId | null =>
  item.kind === 'enforcement' ? (item.party === null ? null : findPartyGroup(item.party)) : mentionedGroup(item);
