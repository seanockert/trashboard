import type { LINES_OF_BUSINESS, TOPICS } from './jev/answers';

// All ranking policy lives here. D1 applies it in SQL over the stored Jev
// answers, thus a change to a weight or a threshold needs no new Jev requests,
// and the Worker does not parse every stored item on each page view.

export const RELEVANT_MIN = 0.5;
export const FLAG_MIN = 0.6;
export const WASTE_OPERATOR_MIN = 0.6;
export const SERIOUS_MIN = 2;

// Below this priority, an item is about the environment but has almost no
// effect on waste operations, for example river health reports or mine licences.
export const PRIORITY_MIN = 0.15;

// Priority bands for the badge on each card. Calibrate on real data.
export const PRIORITY_HIGH = 0.45;
export const PRIORITY_MEDIUM = 0.25;

const WEIGHTS ={ impact: 1, action: 0.5, submissions: 0.3 };

const answer = (path: string) => `COALESCE(json_extract(answers, '$.${path}'), 0)`;

// Probability that the item is about waste (level 3) or is environmental
// regulation (level 2) on the `wasteFocus` Score.
const P_WASTE = answer('wasteFocus.probabilities."3"');
const P_ENVIRONMENT = answer('wasteFocus.probabilities."2"');

// Level 3 counts in full and level 2 counts half.
export const RELEVANCE_SQL = `(${P_WASTE} + 0.5 * ${P_ENVIRONMENT})`;

// Relevance is a gate and a multiplier. An item that is probably not relevant
// cannot rise because of a high impact score. The impact Score has 5 levels, 0 to 4.
export const PRIORITY_SQL = `(${RELEVANCE_SQL} * (${WEIGHTS.impact} * ${answer('impact.score')} / 4.0 + ${WEIGHTS.action} * ${answer('actionRequired.noul')} + ${WEIGHTS.submissions} * ${answer('submissionsOpen.noul')}) / ${WEIGHTS.impact + WEIGHTS.action + WEIGHTS.submissions})`;

export const IS_RELEVANT_SQL = `(${P_WASTE} + ${P_ENVIRONMENT} >= ${RELEVANT_MIN} AND ${PRIORITY_SQL} >= ${PRIORITY_MIN})`;

// Only known answer keys can go into the SQL.
export type FlagKey = (typeof LINES_OF_BUSINESS)[number] | (typeof TOPICS)[number] | 'actionRequired' | 'submissionsOpen';
export const flagSql = (key: FlagKey) => `(${answer(`${key}.noul`)} >= ${FLAG_MIN})`;

// A company is a waste operator when code knows its group, when the source
// states a waste activity, or when Jev finds evidence in the record.
export const IS_WASTE_OPERATOR_SQL = `(party_group IS NOT NULL OR waste_activity = 1 OR ${answer('wasteOperator.noul')} >= ${WASTE_OPERATOR_MIN})`;

export const IS_SERIOUS_SQL = `(${answer('severity.score')} >= ${SERIOUS_MIN})`;
export const OFFENCE_SQL = `json_extract(answers, '$.offence.choice')`;
