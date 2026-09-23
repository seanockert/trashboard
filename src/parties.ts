// Known company groups and the names that their entities use in public
// registers. Code matches names, thus a group is never a model guess.
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

export type PartyGroupId = (typeof PARTY_GROUPS)[number]['id'];

export const findPartyGroup = (name: string): PartyGroupId | null =>
  PARTY_GROUPS.find((group) => group.pattern.test(name))?.id ?? null;

// Words that show a legal entity that is not a natural person. A record
// without one of these can name a person, thus code drops it before storage.
// Trading words such as "Services" are not on the list, because a sole trader
// can use them. An ABN is not on the list for the same reason. An ACN is.
const COMPANY_MARKER =
  /\b(pty|proprietary|ltd|limited|inc|incorporated|corporation|co-?operative|council|shire|authority|department|university|gmbh|plc|llc|nl)\b|\bACN\s*\d/i;

// Text in brackets does not count, because "John Smith (Director, Example
// Pty Ltd)" names a person. Brackets that hold an ACN do count.
const withoutBrackets = (name: string) => name.replace(/\((?!\s*ACN)[^)]*\)/gi, ' ');

const NAMES_A_PERSON = /\b(director|officer|manager|trustee for)\b/i;

// Words before the company marker, for example 2 in "Port Adelaide Pty Ltd".
const wordsBeforeMarker = (part: string) => {
  const at = part.search(COMPANY_MARKER);
  return at < 0 ? 0 : part.slice(0, at).trim().split(/\s+/).filter((w) => w !== '').length;
};

const wordCount = (text: string) => text.trim().split(/\s+/).filter((w) => w !== '').length;

// "&" joins two parties when the text after it is not a company ("Example Pty
// Ltd & John Smith"), or when a name of two or more words comes before a full
// company name ("John Smith & Example Salvage Pty Ltd"). Otherwise it is part
// of one name: "J.J. Richards & Sons Pty Ltd", "Fuller & Gordon Metal Recycling
// Pty Ltd". This is a rule of thumb. When it is wrong, it drops a company, not
// keeps a person.
// Text before "&" that cannot be the name of a person: trade words, or initials only ("R W", "MJ, SE").
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

// A record can name a company and a person together, for example
// "Example Pty Ltd and John Smith". Each named party must be a company.
export const isCompanyName = (name: string): boolean =>
  !NAMES_A_PERSON.test(name) &&
  withoutBrackets(name)
    .split(/\s+and\s+|;/i)
    .flatMap(splitAmpersand)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .every((part) => COMPANY_MARKER.test(part));
