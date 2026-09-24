import { choice, noul, score } from '@typesafe-ai/sdk';

// Increase this when a question or the state changes. Items with an older
// version get new tags, thus two meanings of one answer never mix.
export const TAG_VERSION = 4;

const READER =
  'The reader is the in-house legal counsel of a large Australian waste management company. ' +
  'The company collects, transports, sorts, recycles and disposes of general, recyclable, organic, ' +
  'liquid, clinical and hazardous waste for councils and businesses in all states and territories. ' +
  'It operates trucks, depots, transfer stations, material recovery facilities, liquid waste plants and landfills.';

const lineOfBusiness = (area: string) =>
  noul({
    context: READER,
    question: `Does \`item\` apply to this part of the business: ${area}?`,
  });

const topic = (name: string) =>
  noul({
    context: READER,
    question: `Is \`item\` about ${name}?`,
  });

// State: { item: { source, jurisdiction, title, date, text } }
export const REGULATORY_QUESTIONS = {
  // A Score, not a Noul: a general law that applies to every business is a
  // different case from a law about waste, and code gives them different weight.
  wasteFocus: score(
    {
      context: READER,
      question: 'How directly is `item` about the waste and resource recovery industry?',
    },
    [
      'Not about waste, pollution or environment protection, for example health, tax, aviation, biosecurity or a single named person or place.',
      'A general rule for all businesses, all vehicles or all land, with no specific content about waste, for example road network notices, local planning schemes or tax rules.',
      'Environment protection or pollution regulation that can apply to a waste facility, for example emission limits, noise, water quality or contaminated land.',
      'Specifically about waste, recycling, landfill, a waste levy, product stewardship, container deposits, or regulator action against a waste operator.',
    ],
  ),
  impact: score(
    {
      context: READER,
      question: 'If `item` applies to this company, how large is the effect on its waste operations?',
    },
    [
      'No effect on waste operations.',
      'Background information only, for example a report, a grant program or a general announcement.',
      'A small administrative change, for example a new form, a fee update or a changed reporting date.',
      'A change to routine compliance at some sites, for example new monitoring, record keeping or licence conditions.',
      'A large change in cost or operations, for example a waste levy change, a new mandate, a ban or a large penalty increase.',
    ],
  ),
  itemType: choice(
    { context: READER, question: 'What type of item is `item`?' },
    {
      law: 'A new or amended Act or regulation, or a statutory instrument that is made or commenced.',
      bill: 'A bill in parliament that is not law yet.',
      consultation: 'A draft, discussion paper or request for public submissions.',
      guidance: 'Guidance, a policy, a standard or a position statement from a regulator.',
      licence: 'A licence, permit or environmental authority for one company or site that is issued, amended, varied, transferred, suspended or surrendered.',
      enforcement: 'A report of a prosecution, fine, penalty notice, order or other enforcement action.',
      news: 'A general announcement, grant, program, report or event.',
    },
  ),
  actionRequired: noul({
    context: READER,
    question: 'Does `item` create a new or changed obligation that a waste operator must act on?',
  }),
  submissionsOpen: noul({
    context: READER,
    question: 'Does `item` invite the public or industry to make a submission or comment?',
  }),
  // `wasteFocus` rates a rule for all vehicles as general, thus this question
  // finds the vehicle rules that apply to the fleet of the company.
  fleetRule: noul(
    {
      context: READER,
      question: "Does `item` change a rule for the company's own trucks or drivers?",
    },
    {
      true: 'A rule for rigid trucks or truck and trailer combinations on general access roads, for example waste compactors, skip, hook-lift and tanker trucks: driver fatigue, work diaries, driver licences, chain of responsibility, road user charges, registration fees, vehicle standards, truck bans on a road, or mass limits for these trucks.',
      false: 'Not a vehicle rule, or a permit, route map or exemption only for other vehicles, for example road trains, B-doubles, cranes, livestock or vehicle carriers, or for one named operator.',
    },
  ),

  lobCollection: lineOfBusiness('collection and transport of household and commercial waste'),
  lobRecycling: lineOfBusiness('recycling, material recovery facilities, organics and FOGO'),
  lobLiquidHazardous: lineOfBusiness('liquid, clinical, chemical or hazardous waste'),
  lobLandfill: lineOfBusiness('landfills, transfer stations and waste disposal'),
  lobFleet: lineOfBusiness('trucks, drivers and heavy vehicle rules, including chain of responsibility'),

  topicLevy: topic('a waste levy, a landfill levy or waste levy reporting'),
  topicLicensing: topic('environmental licences, authorities, permits or approvals'),
  topicPollution: topic('pollution incidents, pollution offences or the powers of an environmental regulator'),
  topicContaminants: topic('PFAS, asbestos or other contaminants, or contaminated land'),
  topicStewardship: topic('batteries, product stewardship or extended producer responsibility'),
  topicPackaging: topic('packaging, plastics, container deposit schemes or the circular economy'),
  topicEmissions: topic('greenhouse gas emissions, energy or climate reporting'),
  topicPlanning: topic('land use planning or development approval'),
  topicSafety: topic('workplace health and safety, or fire risk'),
} as const;

// State: { record: { regulator, jurisdiction, party, action, date, description, location } }
// The party is always a company. Code drops records for persons before this step.
export const ENFORCEMENT_QUESTIONS = {
  wasteOperator: noul(
    { question: 'Does `record` show that `record.party` collects, transports, sorts, recycles, treats or disposes of waste as a business?' },
    {
      true: 'The party name, the activities, the location or the description shows a waste business that accepts waste from others, for example a waste company, a landfill, a transfer station, a recycler or a liquid waste treatment plant.',
      false:
        'The party is in another industry, for example a sewage or water treatment plant, a mine, a factory or a farm that manages only its own waste, or the record does not show what the party does.',
    },
  ),
  offence: choice(
    { question: 'What conduct is `record` mainly about?' },
    {
      water: 'Pollution of water, including stormwater, leachate or wastewater discharge.',
      air: 'Air pollution, odour or dust.',
      noise: 'Noise.',
      dumping: 'Illegal dumping, or waste taken to a place that cannot lawfully accept it.',
      storage: 'Stockpiles or storage of waste above limits or in the wrong way.',
      licence: 'A breach of a licence, permit or authority condition not covered by another option.',
      reporting: 'Records, returns, monitoring, reports or information that were late, false or missing.',
      notification: 'A failure to notify the regulator of an incident, or a late notification.',
      fire: 'A fire, or a failure to manage fire risk.',
      contamination: 'Contaminated land, PFAS, asbestos or chemicals.',
      transport: 'Transport of waste, or waste tracking.',
      levy: 'The waste levy.',
      safety: 'Work health and safety, for example a worker who was injured or killed, or a failure to control a risk to workers.',
      other: 'Other conduct.',
      unknown: 'The record gives only the type of notice and does not say what the conduct was.',
    },
  ),
  severity: score(
    { question: 'How serious is the conduct in `record`?' },
    [
      'An administrative matter with no harm to the environment or to people.',
      'A small or short breach with little or no harm.',
      'A breach that caused, or could cause, harm to the environment, to workers or to people nearby.',
      'Serious or widespread harm, a death or a serious injury, or conduct that was deliberate or repeated.',
    ],
  ),
  similarRisk: noul({
    question:
      'Could the conduct in `record` also happen during the normal work of a waste collection, recycling, liquid waste or landfill business?',
  }),
} as const;
