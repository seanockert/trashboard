import { dcceewConsultations, dwerConsultations, engageVic, nswEpaYourSay } from './consultations';
import { federalRegister } from './frl';
import { qldLicences, saLicences, vicLicences } from './licences';
import { nswEpaNews } from './nsw-epa-news';
import { nswProsecutions } from './nsw-prosecutions';
import { nswLegislation, qldLegislation, tasLegislation } from './pco-feeds';
import { qldEnforcement } from './qld-enforcement';
import { safeworkNsw } from './safework-nsw';
import { saProsecutions } from './sa-prosecutions';
import type { Source } from './types';
import { vicCourt } from './vic-court';
import { epaVicNews, vicLegislation } from './vic-search';
import { waEnforcement } from './wa-enforcement';
import { worksafeVic } from './worksafe-vic';

export const SOURCES: readonly Source[] = [
  federalRegister,
  qldLegislation,
  nswLegislation,
  vicLegislation,
  tasLegislation,
  nswEpaNews,
  epaVicNews,
  nswEpaYourSay,
  engageVic,
  dcceewConsultations,
  dwerConsultations,
  qldLicences,
  vicLicences,
  saLicences,
  qldEnforcement,
  vicCourt,
  waEnforcement,
  saProsecutions,
  nswProsecutions,
  safeworkNsw,
  worksafeVic,
];

export const sourceById = (id: string) => SOURCES.find((source) => source.id === id);
