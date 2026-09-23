import { federalRegister } from './frl';
import { nswEpaNews } from './nsw-epa-news';
import { nswLegislation, qldLegislation, tasLegislation } from './pco-feeds';
import { qldEnforcement } from './qld-enforcement';
import { saProsecutions } from './sa-prosecutions';
import type { Source } from './types';
import { vicCourt } from './vic-court';
import { epaVicNews, vicLegislation } from './vic-search';
import { waEnforcement } from './wa-enforcement';

export const SOURCES: readonly Source[] = [
  federalRegister,
  qldLegislation,
  nswLegislation,
  vicLegislation,
  tasLegislation,
  nswEpaNews,
  epaVicNews,
  qldEnforcement,
  vicCourt,
  waEnforcement,
  saProsecutions,
];

export const sourceById = (id: string) => SOURCES.find((source) => source.id === id);
