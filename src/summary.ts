import { z } from 'zod';
import type { StoredItem } from './items';
import { IS_RELEVANT_SQL, IS_WASTE_OPERATOR_SQL } from './rank';
import { SOURCES } from './sources';

// Workers AI free plan: 10,000 neurons/day. About 6 per summary.
const SUMMARY_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';

// Increase on prompt or check change. Daily run makes new summaries.
export const SUMMARY_VERSION = 1;

const SUMMARY_SOURCES = SOURCES.filter((source) => source.prose).map((source) => source.id);

const MIN_BODY = 400;

// "+kind" stops SQLite from using the kind index for the OR. Else 10 IDs read about 9,500 rows.
export const NEEDS_SUMMARY_SQL = `(source_id IN (${SUMMARY_SOURCES.map((id) => `'${id}'`).join(', ')}) AND length(body) >= ${MIN_BODY}
  AND ((+kind = 'regulatory' AND ${IS_RELEVANT_SQL}) OR (+kind = 'enforcement' AND ${IS_WASTE_OPERATOR_SQL})))`;

export const Summary = z.object({ what: z.string().min(1), points: z.array(z.string()) });
export type Summary = z.infer<typeof Summary>;

const SYSTEM = `You write notes for the in-house lawyer of an Australian waste management company.
Read the item and give JSON with two fields:
- "what": what changes or happened, in 15 words or fewer. Start with a verb. Do not name the item or repeat its title. Use plain words.
- "points": 0 to 3 short facts from this item's text: a start date, a deadline, an amount, a penalty, or who must act. Each 12 words or fewer. Leave out a fact the text does not state. Do not write "not stated" or "no penalty". Do not list which laws it amends or which section it is made under.
Use only facts in the text of this item. Do not guess.`;

// Small model follows an example better than a rule. `clean` drops points copied from it.
const EXAMPLE_ITEM =
  'Title: Court proceeding: Example Tyres Pty Ltd\n\nText:\nExample Tyres Pty Ltd pleaded guilty to storing 40,000 waste tyres above its permitted limit at its Bendigo site. ' +
  'On 3 March 2025 the Magistrates Court fined the company $60,000 and ordered it to remove the excess tyres within 90 days.';
const EXAMPLE_ANSWER: Summary = { what: 'Fined a tyre recycler for storing too many waste tyres.', points: ['Fine of $60,000 on 3 March 2025.', 'Must remove excess tyres within 90 days.'] };

const JSON_SCHEMA = {
  type: 'object',
  properties: { what: { type: 'string' }, points: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
  required: ['what', 'points'],
};

// Model reads "Updated <date>" as a deadline.
export const modelText = (body: string) => body.replace(/\s*Updated \d{1,2} \w+ \d{4}\s*$/, '');

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', fourteen: '14', fifteen: '15', twenty: '20', thirty: '30', sixty: '60', ninety: '90',
};
const digits = (text: string) => text.match(/\d[\d,.]*/g)?.map((n) => n.replace(/[,.]+$/, '').replace(/,/g, '')) ?? [];
const textNumbers = (text: string) => new Set([...digits(text), ...(text.toLowerCase().match(/[a-z]+/g) ?? []).flatMap((w) => NUMBER_WORDS[w] ?? [])]);

const FILLER = /,?\s*(on|by)?\s*(an\s+)?(unspecified|unknown)\s+date/gi;

// Checks by code: small model breaks prompt rules.
export const clean = ({ answer, item }: { answer: Summary; item: Pick<StoredItem, 'title' | 'body'> }): Summary => {
  const have = textNumbers(item.body);
  const what = (answer.what.startsWith(item.title) ? answer.what.slice(item.title.length).replace(/^[\s,:.-]+/, '') : answer.what).trim();
  const points = [...new Set(answer.points.map((p) => p.replace(FILLER, '').trim()))].filter(
    (p) => p !== '' && p !== what && !p.includes(item.title) && !EXAMPLE_ANSWER.points.includes(p) && digits(p).every((n) => have.has(n)),
  );
  return { what, points: points.slice(0, 3) };
};

// JSON mode: some models give the object as a string.
const parseAnswer = (response: unknown) => {
  if (typeof response !== 'string') return Summary.safeParse(response);
  try {
    return Summary.safeParse(JSON.parse(response));
  } catch {
    return Summary.safeParse(null);
  }
};

export const summarise = async ({ ai, item }: { ai: Ai; item: StoredItem }): Promise<{ summary: Summary | null; neurons: number }> => {
  const res = (await ai.run(SUMMARY_MODEL, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: EXAMPLE_ITEM },
      { role: 'assistant', content: JSON.stringify(EXAMPLE_ANSWER) },
      { role: 'user', content: `Title: ${item.title}\n\nText:\n${modelText(item.body)}` },
    ],
    max_tokens: 160,
    response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
  })) as { response?: unknown; usage?: { neurons?: number } };
  const parsed = parseAnswer(res.response);
  const summary = parsed.success ? clean({ answer: parsed.data, item }) : null;
  return { summary: summary === null || summary.what === '' ? null : summary, neurons: res.usage?.neurons ?? 0 };
};
