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

export const PRIORITY_LEVELS = ['high', 'medium', 'low'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

const WEIGHTS = { impact: 1, action: 0.5, submissions: 0.3 };

const answer = (path: string) => `COALESCE(json_extract(answers, '$.${path}'), 0)`;

// Probability that the item is about waste (level 3) or is environmental
// regulation (level 2) on the `wasteFocus` Score.
const P_WASTE = answer('wasteFocus.probabilities."3"');
const P_ENVIRONMENT = answer('wasteFocus.probabilities."2"');

// Probability that the item changes a rule for the trucks or drivers of the company.
const P_FLEET = answer('fleetRule.noul');

// Level 3 counts in full and level 2 counts half. A rule for the fleet counts as much as its probability.
export const RELEVANCE_SQL = `MAX(${P_WASTE} + 0.5 * ${P_ENVIRONMENT}, ${P_FLEET})`;

// Relevance is a gate and a multiplier. An item that is probably not relevant
// cannot rise because of a high impact score. The impact Score has 5 levels, 0 to 4.
export const PRIORITY_SQL = `(${RELEVANCE_SQL} * (${WEIGHTS.impact} * ${answer('impact.score')} / 4.0 + ${WEIGHTS.action} * ${answer('actionRequired.noul')} + ${WEIGHTS.submissions} * ${answer('submissionsOpen.noul')}) / ${WEIGHTS.impact + WEIGHTS.action + WEIGHTS.submissions})`;

// An item that names JJ Richards is always relevant.
export const IS_RELEVANT_SQL = `(((${P_WASTE} + ${P_ENVIRONMENT} >= ${RELEVANT_MIN} OR ${P_FLEET} >= ${FLAG_MIN}) AND ${PRIORITY_SQL} >= ${PRIORITY_MIN}) OR party_group IS 'jjr')`;

// Only known answer keys can go into the SQL.
export type FlagKey = (typeof LINES_OF_BUSINESS)[number] | (typeof TOPICS)[number] | 'actionRequired' | 'submissionsOpen';
export const flagSql = (key: FlagKey) => `(${answer(`${key}.noul`)} >= ${FLAG_MIN})`;

// A company is a waste operator when code knows its group, when the source
// states a waste activity, or when Jev finds evidence in the record.
export const IS_WASTE_OPERATOR_SQL = `(party_group IS NOT NULL OR waste_activity = 1 OR ${answer('wasteOperator.noul')} >= ${WASTE_OPERATOR_MIN})`;

export const IS_SERIOUS_SQL = `(${answer('severity.score')} >= ${SERIOUS_MIN})`;

// Enforcement priority: serious conduct that can also happen in own operations ranks highest.
// The severity Score has 4 levels, 0 to 3. Calibrate on real data.
const ENFORCEMENT_PRIORITY_SQL = `(${answer('severity.score')} / 3.0 * (0.5 + 0.5 * ${answer('similarRisk.noul')}))`;

// One priority for both kinds, thus the inbox can sort them in one list.
export const ITEM_PRIORITY_SQL = `(CASE kind WHEN 'regulatory' THEN ${PRIORITY_SQL} ELSE ${ENFORCEMENT_PRIORITY_SQL} END)`;

// The items in one priority band. The bands are the same as the badges.
export const priorityLevelSql = (level: PriorityLevel) =>
  ({
    high: `(${ITEM_PRIORITY_SQL} >= ${PRIORITY_HIGH})`,
    medium: `(${ITEM_PRIORITY_SQL} >= ${PRIORITY_MEDIUM} AND ${ITEM_PRIORITY_SQL} < ${PRIORITY_HIGH})`,
    low: `(${ITEM_PRIORITY_SQL} < ${PRIORITY_MEDIUM})`,
  })[level];

// An enforcement record is in the inbox when it is about a waste operator, and it names a known group or the conduct is serious.
const IN_INBOX_ENFORCEMENT_SQL = `(${IS_WASTE_OPERATOR_SQL} AND (party_group IS NOT NULL OR ${IS_SERIOUS_SQL}))`;

export const IN_INBOX_SQL = `(CASE kind WHEN 'regulatory' THEN ${IS_RELEVANT_SQL} ELSE ${IN_INBOX_ENFORCEMENT_SQL} END)`;
