import type { LINES_OF_BUSINESS, TOPICS } from './jev/answers';

// Ranking runs in SQL over stored answers, thus weight changes need no new Jev requests.

const RELEVANT_MIN = 0.5;
export const FLAG_MIN = 0.6;
const WASTE_OPERATOR_MIN = 0.6;
const SERIOUS_MIN = 2;

const PRIORITY_MIN = 0.15;

export const PRIORITY_HIGH = 0.45;
export const PRIORITY_MEDIUM = 0.25;

export const PRIORITY_LEVELS = ['high', 'medium', 'low'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

const WEIGHTS = { impact: 1, action: 0.5, submissions: 0.3 };

const answer = (path: string) => `COALESCE(json_extract(answers, '$.${path}'), 0)`;

const P_WASTE = answer('wasteFocus.probabilities."3"');
const P_ENVIRONMENT = answer('wasteFocus.probabilities."2"');

const P_FLEET = answer('fleetRule.noul');

const RELEVANCE_SQL = `MAX(${P_WASTE} + 0.5 * ${P_ENVIRONMENT}, ${P_FLEET})`;

// Relevance gates impact: high impact cannot lift an irrelevant item.
export const PRIORITY_SQL = `(${RELEVANCE_SQL} * (${WEIGHTS.impact} * ${answer('impact.score')} / 4.0 + ${WEIGHTS.action} * ${answer('actionRequired.noul')} + ${WEIGHTS.submissions} * ${answer('submissionsOpen.noul')}) / ${WEIGHTS.impact + WEIGHTS.action + WEIGHTS.submissions})`;

export const IS_RELEVANT_SQL = `(((${P_WASTE} + ${P_ENVIRONMENT} >= ${RELEVANT_MIN} OR ${P_FLEET} >= ${FLAG_MIN}) AND ${PRIORITY_SQL} >= ${PRIORITY_MIN}) OR party_group IS 'jjr')`;

// Only known answer keys go into the SQL.
export type FlagKey = (typeof LINES_OF_BUSINESS)[number] | (typeof TOPICS)[number] | 'actionRequired' | 'submissionsOpen';
export const flagSql = (key: FlagKey) => `(${answer(`${key}.noul`)} >= ${FLAG_MIN})`;

export const IS_WASTE_OPERATOR_SQL = `(party_group IS NOT NULL OR waste_activity = 1 OR ${answer('wasteOperator.noul')} >= ${WASTE_OPERATOR_MIN})`;

export const IS_SERIOUS_SQL = `(${answer('severity.score')} >= ${SERIOUS_MIN})`;

const ENFORCEMENT_PRIORITY_SQL = `(${answer('severity.score')} / 3.0 * (0.5 + 0.5 * ${answer('similarRisk.noul')}))`;

export const ITEM_PRIORITY_SQL = `(CASE kind WHEN 'regulatory' THEN ${PRIORITY_SQL} ELSE ${ENFORCEMENT_PRIORITY_SQL} END)`;

export const priorityLevelSql = (level: PriorityLevel) =>
  ({
    high: `(${ITEM_PRIORITY_SQL} >= ${PRIORITY_HIGH})`,
    medium: `(${ITEM_PRIORITY_SQL} >= ${PRIORITY_MEDIUM} AND ${ITEM_PRIORITY_SQL} < ${PRIORITY_HIGH})`,
    low: `(${ITEM_PRIORITY_SQL} < ${PRIORITY_MEDIUM})`,
  })[level];

const IN_INBOX_ENFORCEMENT_SQL = `(${IS_WASTE_OPERATOR_SQL} AND (party_group IS NOT NULL OR ${IS_SERIOUS_SQL}))`;

export const IN_INBOX_SQL = `(CASE kind WHEN 'regulatory' THEN ${IS_RELEVANT_SQL} ELSE ${IN_INBOX_ENFORCEMENT_SQL} END)`;
