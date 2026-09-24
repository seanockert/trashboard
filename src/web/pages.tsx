import type { Child } from 'hono/jsx';
import { Jurisdiction, type StoredItem, type Tracking, type TrackStatus } from '../items';
import { LINES_OF_BUSINESS, OFFENCES, TOPICS } from '../jev/answers';
import { PARTY_GROUPS } from '../parties';
import type { SearchResult } from '../search';
import { Layout } from './layout';
import {
  LOB_LABELS,
  OFFENCE_LABELS,
  PAGE_SIZE,
  brisbaneDay,
  snippet,
  TOPIC_LABELS,
  type ChangeRow,
  type ChangesFilters,
  type EnforcementFilters,
  type EnforcementRow,
  type groupTable,
  type offenceChips,
  type PriorityLevel,
  type BandStat,
  type DateEntry,
  type PenaltyBenchmark,
} from './models';
import { FLAG_MIN } from '../rank';

// Search results below this Jev score show as "Possible match".
const STRONG_MATCH = 0.7;

const ITEM_TYPE_LABELS: Record<string, string> = {
  law: 'Law',
  bill: 'Bill',
  consultation: 'Consultation',
  guidance: 'Guidance',
  licence: 'Licence',
  enforcement: 'Enforcement',
  news: 'News',
};

const aud = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

// A change sends the form at once, thus the filters need no Apply button.
// `blank` is the text of the option that removes the filter. Null gives no such option.
const Select = <T extends string | number>({
  name,
  label,
  value,
  options,
  blank = 'All',
}: {
  name: string;
  label: string;
  value: T | undefined;
  options: readonly (readonly [T, string])[];
  blank?: string | null;
}) => (
  <label class="stack-quarter">
    {label}
    <select name={name} onchange="this.form.submit()">
      {blank !== null && <option value="">{blank}</option>}
      {options.map(([key, text]) => (
        <option value={String(key)} selected={key === value}>
          {text}
        </option>
      ))}
    </select>
  </label>
);

const NoScriptApply = () => (
  <noscript>
    <button type="submit">Apply</button>
  </noscript>
);

const JURISDICTIONS = Jurisdiction.options.map((j) => [j, j] as const);

const CHANGES_PERIODS = [
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [365, 'Last 12 months'],
] as const;

const ENFORCEMENT_PERIODS = [
  [365, 'Last 12 months'],
  [730, 'Last 2 years'],
  [1825, 'Last 5 years'],
  [3650, 'Last 10 years'],
] as const;

const date = (iso: string | null) =>
  iso === null ? 'No date' : new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// The card title is the link to the source page.
const Title = ({ item, text }: { item: StoredItem; text: string }) => (
  <a class="title" href={item.url} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
);

const PRIORITY_LABELS: Record<PriorityLevel, string> = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

const PRIORITY_HELP = 'Priority combines how much the item is about waste with its effect on operations, and whether it needs action or invites submissions.';

// The badge and the reasons tell the user why the item is in its place in the list.
const Priority = ({ row }: { row: ChangeRow }) => (
  <>
    <div class={`prio ${row.level}`} title={`${PRIORITY_HELP} Score: ${Math.round(row.priority * 100)} of 100.`}>
      {PRIORITY_LABELS[row.level]}
    </div>
    <div>{row.reasons.join(' · ')}</div>
  </>
);

// A tag is a link that applies its filter. The tag of the current filter removes it.
const TagLink = ({ href, on, warn = false, text }: { href: string; on: boolean; warn?: boolean; text: string }) => (
  <a class={`tag${warn ? ' warn' : ''}${on ? ' on' : ''}`} href={href} title={on ? 'Remove this filter' : 'Show only items with this tag'}>
    {text}
  </a>
);

export type TrackingMap = ReadonlyMap<string, Tracking>;

const TRACK_LABELS: Record<TrackStatus, string> = { watching: 'Watching', acting: 'Acting' };

// The anchor of a card, so that a save returns to the same place on the page.
const anchor = (item: StoredItem) => `item-${item.id.replace(/[^\w-]/g, '_')}`;

const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

// Bookmark an item: a status and a short note. A plain form, thus no script.
// The icon is in the top right corner of the card. The form opens below it.
const Bookmark = ({ item, tracking, back }: { item: StoredItem; tracking: Tracking | undefined; back: string }) => (
  <details class={`bookmark${tracking === undefined ? '' : ` ${tracking.status}`}`}>
    <summary title={tracking === undefined ? 'Bookmark' : 'Edit bookmark'} aria-label={tracking === undefined ? 'Bookmark' : 'Edit bookmark'}>
      <BookmarkIcon filled={tracking !== undefined} />
    </summary>
    <form class="stack-half" method="post" action="/track">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="back" value={`${back}#${anchor(item)}`} />
      <div class="inline-2x">
        {(['watching', 'acting'] as const).map((status) => (
          <label>
            <input type="radio" name="status" value={status} checked={(tracking?.status ?? 'watching') === status} /> {TRACK_LABELS[status]}
          </label>
        ))}
      </div>
      <textarea name="note" aria-label="Note" rows={2} maxlength={500} placeholder="Note, for example: raised with ops, due 1 July">
        {tracking?.note ?? ''}
      </textarea>
      <div class="inline-half">
        <button type="submit">Save</button>
        {tracking !== undefined && (
          <button type="submit" name="stop" value="1" class="secondary">
            Remove bookmark
          </button>
        )}
      </div>
    </form>
  </details>
);

// The AI summary if there is one, else the start of the source text.
const ItemText = ({ item }: { item: StoredItem }) => {
  if (item.summary !== null)
    return (
      <div class="summary stack-quarter" title="AI summary of the source text. Check the source before you act.">
        <p>{item.summary.what}</p>
        {item.summary.points.length > 0 && (
          <ul>
            {item.summary.points.map((point) => (
              <li>{point}</li>
            ))}
          </ul>
        )}
      </div>
    );
  const text = snippet(item);
  return text === '' ? null : <div class="body">{text}</div>;
};

// The status and note of a bookmarked item, at the bottom of the card.
const TrackInfo = ({ tracking }: { tracking: Tracking | undefined }) =>
  tracking === undefined ? null : (
    <div class="track inline">
      <div class={`pill ${tracking.status}`}>{TRACK_LABELS[tracking.status]}</div>
      {tracking.note !== '' && <div class="track-note">{tracking.note}</div>}
    </div>
  );

// A query string with the values that are set.
const query = (params: Record<string, string | number | undefined>) =>
  `?${new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])))}`;

// Links to the pages before and after, with the same filters.
const Pager = ({ filters, matched }: { filters: Record<string, string | number | undefined>; matched: number }) => {
  const current = Number(filters['page'] ?? 1);
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  if (pages === 1) return null;
  const href = (page: number) => query({ ...filters, page });
  return (
    <div class="pager inline-between">
      {current > 1 ? <a href={href(current - 1)}>Previous</a> : <div />}
      <div class="note">
        Page {current} of {pages}
      </div>
      {current < pages ? <a href={href(current + 1)}>Next</a> : <div />}
    </div>
  );
};

export const LoginPage = ({ next, error }: { next: string; error: string | null }) => (
  <Layout title="Log in" path={null}>
    <form class="login stack" method="post" action="/login">
      <h1 class="inline"><img src="/assets/trashboard-icon-sm.png" height="48" width="48" alt="" /> Trashboard</h1>
      <div class="note">Enter the password to continue.</div>
      {error !== null && <div class="error">{error}</div>}
      <input type="hidden" name="next" value={next} />
      <label class="stack-quarter">
        Password <input type="password" name="password" autocomplete="current-password" required autofocus />
      </label>
      <button type="submit">Log in</button>
    </form>
  </Layout>
);

export type LabelMap = ReadonlyMap<string, boolean>;

const GROUP_LABELS: Record<string, string> = Object.fromEntries(PARTY_GROUPS.map((g) => [g.id, g.label]));
const GROUP_OPTIONS = PARTY_GROUPS.map((g) => [g.id, g.label] as const);

const KIND_LABELS: Record<StoredItem['kind'], string> = { regulatory: 'Regulatory', enforcement: 'Enforcement' };

// "1 item", "2 items".
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

type GroupRow = ReturnType<typeof groupTable>[number];

// Enforcement counts for each company group. `name` gives the first cell.
const GroupTable = ({ rows, name }: { rows: GroupRow[]; name: (group: GroupRow) => Child }) => (
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Company group</th>
          <th class="num">Records</th>
          <th class="num">Harm or serious</th>
          <th class="num">Known penalties</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr class={g.id === 'jjr' ? 'self' : ''}>
            <td>{name(g)}</td>
            <td class="num">{g.count}</td>
            <td class="num">{g.serious}</td>
            <td class="num">{g.penaltyTotal > 0 ? aud(g.penaltyTotal) : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const today = () => brisbaneDay(new Date());

// The dates that the source states. A date in the past has a past-tense label.
const DateTags = ({ item }: { item: StoredItem }) => {
  const now = today();
  return (
    <>
      {item.closesOn !== null && (
        <div class={`tag${item.closesOn >= now ? ' warn' : ''}`}>
          {item.closesOn >= now ? 'Submissions close' : 'Submissions closed'} {date(item.closesOn)}
        </div>
      )}
      {item.startsOn !== null && (
        <div class={`tag${item.startsOn >= now ? ' warn' : ''}`}>
          {item.startsOn >= now ? 'Starts' : 'Started'} {date(item.startsOn)}
        </div>
      )}
    </>
  );
};

// The user's rating, to measure the priority. A click on the current rating removes it.
const LabelForm = ({ item, label, back }: { item: StoredItem; label: boolean | undefined; back: string }) => (
  <form class="label inline-half" method="post" action="/label" title="Your rating measures how well the priority works. See Priority check in the settings menu.">
    <input type="hidden" name="itemId" value={item.id} />
    <input type="hidden" name="back" value={`${back}#${anchor(item)}`} />
    <div class="note">Useful to you?</div>
    <button type="submit" name="useful" value={label === true ? 'clear' : '1'} class={`secondary${label === true ? ' on' : ''}`} aria-pressed={label === true}>
      Yes
    </button>
    <button type="submit" name="useful" value={label === false ? 'clear' : '0'} class={`secondary${label === false ? ' on' : ''}`} aria-pressed={label === false}>
      No
    </button>
  </form>
);

const ChangeCard = ({ row, filters, tracking, label }: { row: ChangeRow; filters: ChangesFilters; tracking: TrackingMap; label: boolean | undefined }) => {
  const href = (key: 'lob' | 'topic' | 'need' | 'company', value: string) => query({ ...filters, page: undefined, [key]: filters[key] === value ? undefined : value });
  const group = row.item.partyGroup;
  return (
    <div class="card stack-half" id={anchor(row.item)}>
      <Bookmark item={row.item} tracking={tracking.get(row.item.id)} back={`/changes${query(filters)}`} />
      <div class="meta inline-wrap">
        <Priority row={row} />
        <div>{row.item.jurisdiction}</div>
        <div>{date(row.item.publishedAt)}</div>
        <div>{ITEM_TYPE_LABELS[row.answers.itemType.choice] ?? row.answers.itemType.choice}</div>
      </div>
      <Title item={row.item} text={row.item.title} />
      <ItemText item={row.item} />
      <div class="tags inline-wrap">
        {group !== null && <TagLink href={href('company', group)} on={filters.company === group} warn={group === 'jjr'} text={`Names ${GROUP_LABELS[group] ?? group}`} />}
        <DateTags item={row.item} />
        {row.answers.actionRequired.noul >= FLAG_MIN && <TagLink href={href('need', 'action')} on={filters.need === 'action'} warn text="Action may be needed" />}
        {row.answers.submissionsOpen.noul >= FLAG_MIN && <TagLink href={href('need', 'submissions')} on={filters.need === 'submissions'} warn text="Submissions invited" />}
        {row.lines.map((line) => (
          <TagLink href={href('lob', line.key)} on={filters.lob === line.key} text={line.label} />
        ))}
        {row.topics.map((topic) => (
          <TagLink href={href('topic', topic.key)} on={filters.topic === topic.key} text={topic.label} />
        ))}
      </div>
      <TrackInfo tracking={tracking.get(row.item.id)} />
      <LabelForm item={row.item} label={label} back={`/changes${query(filters)}`} />
    </div>
  );
};

export const ChangesPage = ({
  rows,
  matched,
  filters,
  tracking,
  labels,
}: {
  rows: ChangeRow[];
  matched: number;
  filters: ChangesFilters;
  tracking: TrackingMap;
  labels: LabelMap;
}) => {
  const toggleAll = query({ ...filters, page: undefined, all: filters.all === '1' ? undefined : '1' });
  return (
    <Layout title="Regulatory changes" path="/changes">
      <h1>Regulatory changes</h1>
      <p class="sub">
        New laws, consultations and regulator news that can affect the business. Items that name JJ Richards are first, then the most important. <a href="/about#priority">How priority works</a>
      </p>
      <form class="filters inline-wrap" method="get">
        <Select name="days" label="Period" value={filters.days} options={CHANGES_PERIODS} blank={null} />
        <Select name="jurisdiction" label="Jurisdiction" value={filters.jurisdiction} options={JURISDICTIONS} />
        <Select name="lob" label="Part of business" value={filters.lob} options={LINES_OF_BUSINESS.map((key) => [key, LOB_LABELS[key]] as const)} />
        <Select name="topic" label="Topic" value={filters.topic} options={TOPICS.map((key) => [key, TOPIC_LABELS[key]] as const)} />
        <Select
          name="need"
          label="Show"
          value={filters.need}
          options={[['action', 'Action may be needed'] as const, ['submissions', 'Submissions invited'] as const]}
          blank="All items"
        />
        <Select name="company" label="Company" value={filters.company} options={[...GROUP_OPTIONS, ['any', 'Any listed company'] as const]} />
        {filters.all === '1' && <input type="hidden" name="all" value="1" />}
        <NoScriptApply />
      </form>
      <p class="count">{plural(matched, 'item')}</p>
      {rows.length === 0 ? <div class="empty">No items match these filters.</div> : rows.map((row) => <ChangeCard row={row} filters={filters} tracking={tracking} label={labels.get(row.item.id)} />)}
      <Pager filters={filters} matched={matched} />
      <p class="note">
        <a href={toggleAll}>{filters.all === '1' ? 'Hide items that are probably not relevant' : 'Also show items that are probably not relevant'}</a>
      </p>
    </Layout>
  );
};

const EnforcementCard = ({ row, filters, tracking }: { row: EnforcementRow; filters: EnforcementFilters; tracking: TrackingMap }) => (
  <div class="card stack-half" id={anchor(row.item)}>
    <Bookmark item={row.item} tracking={tracking.get(row.item.id)} back={`/enforcement${query(filters)}`} />
    <div class="meta inline-wrap">
      <div>{row.item.jurisdiction}</div>
      <div>{date(row.item.publishedAt)}</div>
      <div>{row.item.action}</div>
      {row.item.penaltyAud !== null && <div>{aud(row.item.penaltyAud)}</div>}
    </div>
    <Title item={row.item} text={row.item.party ?? row.item.title} />
    <ItemText item={row.item} />
    <div class="tags inline-wrap">
      <TagLink
        href={query({ ...filters, page: undefined, offence: filters.offence === row.answers.offence.choice ? undefined : row.answers.offence.choice })}
        on={filters.offence === row.answers.offence.choice}
        text={OFFENCE_LABELS[row.answers.offence.choice] ?? row.answers.offence.choice}
      />
      {row.answers.severity.score >= 2 && <div class="tag warn">Harm or serious conduct</div>}
      {row.answers.similarRisk.noul >= FLAG_MIN && <div class="tag">Similar risk in own operations</div>}
      {row.item.location !== null && <div class="tag">{row.item.location.slice(0, 60)}</div>}
    </div>
    <TrackInfo tracking={tracking.get(row.item.id)} />
  </div>
);

export type EnforcementModel = {
  groups: ReturnType<typeof groupTable>;
  offences: ReturnType<typeof offenceChips>;
  penalties: PenaltyBenchmark[];
  list: EnforcementRow[];
  matched: number;
};

// A median of fewer penalties than this is not a useful benchmark.
const BENCHMARK_MIN = 3;

const PenaltyTable = ({ rows, filters }: { rows: PenaltyBenchmark[]; filters: EnforcementFilters }) =>
  rows.length === 0 ? null : (
    <>
      <h2>Penalties by conduct</h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Conduct</th>
              <th class="num">Known penalties</th>
              <th class="num">Median</th>
              <th class="num">Highest</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <td>
                  <a href={query({ ...filters, page: undefined, offence: row.id })}>{row.label}</a>
                </td>
                <td class="num">{row.count}</td>
                <td class="num">{row.count >= BENCHMARK_MIN ? aud(row.median) : '-'}</td>
                <td class="num">{aud(row.highest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="note">
        Amounts that the sources state, for the period, jurisdiction and industry above. The QLD register states no amounts. A median of fewer than {BENCHMARK_MIN} penalties is not shown.
      </p>
    </>
  );

export const EnforcementPage = ({ model, filters, tracking }: { model: EnforcementModel; filters: EnforcementFilters; tracking: TrackingMap }) => (
  <Layout title="Enforcement" path="/enforcement">
    <h1>Enforcement</h1>
    <p class="sub">Fines, orders and prosecutions against companies, from the public registers.</p>
    <form class="filters inline-wrap" method="get">
      <Select name="days" label="Period" value={filters.days} options={ENFORCEMENT_PERIODS} blank={null} />
      <Select name="jurisdiction" label="Jurisdiction" value={filters.jurisdiction} options={JURISDICTIONS} />
      <Select
        name="group"
        label="Company"
        value={filters.group}
        options={[...GROUP_OPTIONS, ['other', 'Other companies'] as const]}
      />
      <Select
        name="offence"
        label="Conduct"
        value={filters.offence}
        options={OFFENCES.map((k) => [k, `${OFFENCE_LABELS[k] ?? k} (${model.offences.find((o) => o.id === k)?.count ?? 0})`] as const)}
      />
      <Select
        name="industry"
        label="Industry"
        value={filters.industry}
        options={[['waste', 'Waste operators only'] as const, ['all', 'All companies'] as const]}
        blank={null}
      />
      <NoScriptApply />
    </form>

    <GroupTable
      rows={model.groups}
      name={(g) => <a href={query({ ...filters, page: undefined, offence: undefined, group: g.id })}>{g.id === 'other' && filters.industry === 'all' ? 'Other companies' : g.label}</a>}
    />
    <p class="note">Counts depend on which registers publish data. Compare groups in one jurisdiction. Records that name a person are not stored.</p>
    <PenaltyTable rows={model.penalties} filters={filters} />
    <p class="count">{plural(model.matched, 'record')}</p>
    {model.list.length === 0 ? <div class="empty">No records match these filters.</div> : model.list.map((row) => <EnforcementCard row={row} filters={filters} tracking={tracking} />)}
    <Pager filters={filters} matched={model.matched} />
  </Layout>
);

const EXAMPLES = ['stormwater fines at transfer stations', 'changes to the QLD waste levy', 'PFAS rules for landfills'];

// Search has no nav link. The search box is in the top bar on every page.
export const SearchPage = ({ query, result, tracking }: { query: string; result: SearchResult | null; tracking: TrackingMap }) => (
  <Layout title={query === '' ? 'Search' : `Search: ${query}`} path="/search" query={query}>
    {result === null ? (
      <>
        <h1>Search</h1>
        <p class="sub">Type some words or a question in the search box at the top. Press / to go to it from any page.</p>
        <p class="note">
          For example:{' '}
          {EXAMPLES.map((text, i) => (
            <>
              {i > 0 && ' · '}
              <a href={`/search?${new URLSearchParams({ q: text })}`}>{text}</a>
            </>
          ))}
        </p>
      </>
    ) : (
      <>
        <h1>Results for “{query}”</h1>
        <p class="sub">The AI model checks each match and shows only the items that help answer the search. The best are first.</p>
        <p class="count">{plural(result.hits.length, 'result')}</p>
        {result.hits.length === 0 ? (
          <div class="empty">No stored item answers this. Try other words.</div>
        ) : (
          result.hits.map((hit) => (
            <div class="card stack-half" id={anchor(hit.item)}>
              <Bookmark item={hit.item} tracking={tracking.get(hit.item.id)} back={`/search?${new URLSearchParams({ q: query })}`} />
              <div class="meta inline-wrap">
                <div class={`prio ${hit.score >= STRONG_MATCH ? 'high' : 'medium'}`} title="How sure the AI model is that this item helps answer the search.">
                  {hit.score >= STRONG_MATCH ? 'Strong match' : 'Possible match'}
                </div>
                <div>{hit.item.jurisdiction}</div>
                <div>{date(hit.item.publishedAt)}</div>
                <div>{KIND_LABELS[hit.item.kind]}</div>
              </div>
              <Title item={hit.item} text={hit.item.party ?? hit.item.title} />
              <ItemText item={hit.item} />
              <TrackInfo tracking={tracking.get(hit.item.id)} />
            </div>
          ))
        )}
      </>
    )}
  </Layout>
);

const TrackedList = ({ rows }: { rows: { item: StoredItem; tracking: Tracking }[] }) =>
  rows.map(({ item, tracking }) => (
    <div class="card stack-half" id={anchor(item)}>
      <Bookmark item={item} tracking={tracking} back="/tracked" />
      <div class="meta inline-wrap">
        <div>{item.jurisdiction}</div>
        <div>{date(item.publishedAt)}</div>
        <div>{KIND_LABELS[item.kind]}</div>
      </div>
      <Title item={item} text={item.party ?? item.title} />
      <TrackInfo tracking={tracking} />
    </div>
  ));

export const TrackedPage = ({ rows }: { rows: { item: StoredItem; tracking: Tracking }[] }) => {
  const acting = rows.filter((r) => r.tracking.status === 'acting');
  const watching = rows.filter((r) => r.tracking.status === 'watching');
  return (
    <Layout title="Bookmarks" path="/tracked">
      <h1>Bookmarks</h1>
      <p class="sub">Your bookmarked items, with your notes.</p>
      {rows.length === 0 ? (
        <div class="empty">Nothing bookmarked yet. Click the bookmark icon on any item.</div>
      ) : (
        <>
          {acting.length > 0 && <h2>Acting ({acting.length})</h2>}
          <TrackedList rows={acting} />
          {watching.length > 0 && <h2>Watching ({watching.length})</h2>}
          <TrackedList rows={watching} />
        </>
      )}
    </Layout>
  );
};

export type SourceRow = {
  id: string;
  name: string;
  homepage: string;
  kind: string;
  lastRun: string | null;
  status: string | null;
  pages: number;
  seen: number;
  added: number;
  dropped: number;
  error: string | null;
};

export const SourcesPage = ({ rows, pending }: { rows: SourceRow[]; pending: number }) => (
  <Layout title="Sources" path="/sources">
    <h1>Sources</h1>
    <p class="sub">Each source runs one time each day at 05:00 Brisbane time. {pending} items wait for tags.</p>
    <div class="inline-half inline-wrap">
      <form method="post" action="/sources/run">
        <button type="submit">Run all sources now</button>
      </form>
      <form method="post" action="/sources/backfill">
        <button type="submit">Load past 12 months</button>
      </form>
      <form method="post" action="/sources/retag">
        <button type="submit">Tag and summarise waiting items</button>
      </form>
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Type</th>
            <th>Last run</th>
            <th>Result</th>
            <th class="num">Pages</th>
            <th class="num">Seen</th>
            <th class="num">New or changed</th>
            <th class="num">Dropped (persons)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr>
              <td>
                <a href={row.homepage} target="_blank" rel="noopener noreferrer">
                  {row.name}
                </a>
              </td>
              <td>{row.kind}</td>
              <td>{row.lastRun === null ? 'Never' : new Date(row.lastRun).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td class={row.status === 'error' ? 'error' : ''} title={row.error ?? ''}>
                {row.status ?? '-'}
                {row.error !== null && <div class="note">{row.error.slice(0, 160)}</div>}
              </td>
              <td class="num">{row.pages}</td>
              <td class="num">{row.seen}</td>
              <td class="num">{row.added}</td>
              <td class="num">{row.dropped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Layout>
);

export const AboutPage = ({ sources }: { sources: number }) => (
  <Layout title="About" path="/about">
    <div class="about stack">
      <h1>About Trashboard</h1>
      <p class="sub">Waste industry law and enforcement news, filtered and ranked for you.</p>

      <h2>What you get</h2>
      <ul>
        <li>
          <b>One place.</b> {sources} government sources, checked each morning.
        </li>
        <li>
          <b>Only what matters.</b> Items not about waste are hidden.
        </li>
        <li>
          <b>Most important first.</b> Ranked by effect on your operations.
        </li>
        <li>
          <b>Deadlines flagged.</b> See what needs action or invites submissions. <a href="/deadlines">Deadlines</a> lists the close dates and start dates.
        </li>
        <li>
          <b>JJ Richards first.</b> Items that name JJ Richards are always shown, at the top.
        </li>
        <li>
          <b>Competitor watch.</b> Fines and prosecutions, grouped by company. Changes that name a competitor have a tag.
        </li>
        <li>
          <b>Penalty benchmarks.</b> The median and highest known penalty for each type of conduct, on the Enforcement page.
        </li>
        <li>
          <b>Quarterly report.</b> A one-page summary to print or save as PDF, on the <a href="/report">Report</a> page.
        </li>
        <li>
          <b>Ask questions.</b> Search in plain words.
        </li>
        <li>
          <b>Bookmark and note.</b> Mark items Watching or Acting. Add a note.
        </li>
      </ul>

      <h2 id="priority">Priority</h2>
      <p>An AI model reads each item and asks two things:</p>
      <ul>
        <li>How much is it about waste, or about a rule for your trucks and drivers?</li>
        <li>How much does it change your operations?</li>
      </ul>
      <p>Items that need action or invite submissions rank higher. Each card shows why, for example "High priority · About waste · Compliance change".</p>
      <p>
        Click "Useful to you?" on a card to rate it. <a href="/labels">Priority check</a> shows how many items in each priority band you rated useful.
      </p>

      <h2 id="summaries">Summaries</h2>
      <p>An AI model writes the short summary on most cards: what changed, then key dates, amounts and who must act. Other cards show the start of the source text.</p>

      <h2 id="tags">Tags</h2>
      <ul>
        <li>
          <span class="tag warn">Orange</span> Needs your attention.
        </li>
        <li>
          <span class="tag">Green</span> Part of the business or topic.
        </li>
      </ul>
      <p>Click a tag to filter. Click again to clear.</p>

      <h2>Limits</h2>
      <ul>
        <li>The AI can make mistakes. Check the source before you act.</li>
        <li>
          To see hidden items, use the link at the bottom of <a href="/changes">Regulatory changes</a>.
        </li>
      </ul>
    </div>
  </Layout>
);

const DATE_TYPE_LABELS: Record<DateEntry['type'], string> = { closes: 'Submissions close', starts: 'Starts to apply' };

export const DEADLINE_PERIODS = [
  [30, 'Next 30 days'],
  [90, 'Next 90 days'],
  [365, 'Next 12 months'],
] as const;

const DateTable = ({ entries }: { entries: DateEntry[] }) => (
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>What</th>
          <th>Item</th>
          <th>Where</th>
          <th>Priority</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr>
            <td class="nowrap">{date(entry.date)}</td>
            <td class="nowrap">{DATE_TYPE_LABELS[entry.type]}</td>
            <td>
              <Title item={entry.row.item} text={entry.row.item.title} />
            </td>
            <td>{entry.row.item.jurisdiction}</td>
            <td>
              <div class={`prio ${entry.row.level}`}>{PRIORITY_LABELS[entry.row.level].replace(' priority', '')}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const DeadlinesPage = ({ entries, days }: { entries: DateEntry[]; days: number }) => (
  <Layout title="Deadlines" path="/deadlines">
    <h1>Deadlines</h1>
    <p class="sub">Submission close dates and start dates, from the text of relevant regulatory items. Soonest first.</p>
    <form class="filters inline-wrap" method="get">
      <Select name="days" label="Period" value={days} options={DEADLINE_PERIODS} blank={null} />
      <NoScriptApply />
    </form>
    <p class="count">{plural(entries.length, 'date')}</p>
    {entries.length === 0 ? <div class="empty">No dates in this period.</div> : <DateTable entries={entries} />}
    <p class="note">An AI model selects each date from the dates in the source text. Check the source before you act. A date that the source does not state is not shown.</p>
  </Layout>
);

const BAND_LABELS: Record<BandStat['band'], string> = { high: 'High', medium: 'Medium', low: 'Low', hidden: 'Hidden (probably not relevant)' };

const percent = (part: number, whole: number) => (whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`);

// Fewer labels than this give a percentage that can change much with one more label.
const LABELS_MIN = 20;

export const LabelsPage = ({ stats }: { stats: BandStat[] }) => (
  <Layout title="Priority check" path="/labels">
    <div class="about stack">
      <h1>Priority check</h1>
      <p class="sub">How well the priority matches your judgment. Click "Useful to you?" on the cards in Regulatory changes.</p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th class="num">Labelled</th>
              <th class="num">Useful</th>
              <th class="num">Useful share</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((band) => (
              <tr>
                <td>{BAND_LABELS[band.band]}</td>
                <td class="num">{band.count}</td>
                <td class="num">{band.useful}</td>
                <td class="num">{percent(band.useful, band.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>How to read this</h2>
      <ul>
        <li>High should be almost all useful. If it is not, the types below show which kinds of item to move down.</li>
        <li>Hidden should be almost all not useful. A useful hidden item is one the dashboard does not show you.</li>
        <li>
          Label at least {LABELS_MIN} items in each row. To label hidden items, use "Also show items that are probably not relevant" at the bottom of{' '}
          <a href="/changes">Regulatory changes</a>.
        </li>
      </ul>
      {stats
        .filter((band) => band.count > 0)
        .map((band) => (
          <>
            <h2>{BAND_LABELS[band.band]}: by type</h2>
            <div class="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th class="num">Labelled</th>
                    <th class="num">Useful share</th>
                  </tr>
                </thead>
                <tbody>
                  {band.types.map((t) => (
                    <tr>
                      <td>{ITEM_TYPE_LABELS[t.type] ?? t.type}</td>
                      <td class="num">{t.count}</td>
                      <td class="num">{percent(t.useful, t.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
    </div>
  </Layout>
);

export type ReportModel = {
  quarter: string;
  quarters: string[];
  label: string;
  counts: { high: number; action: number; submissions: number };
  changes: ChangeRow[];
  dates: DateEntry[];
  named: StoredItem[];
  groups: ReturnType<typeof groupTable>;
  acting: { item: StoredItem; tracking: Tracking }[];
};

const Stat = ({ value, text }: { value: number; text: string }) => (
  <div class="stat">
    <div class="value">{value}</div>
    <div class="note">{text}</div>
  </div>
);

export const ReportPage = ({ model }: { model: ReportModel }) => {
  const jjr = model.groups.find((g) => g.id === 'jjr');
  const competitors = model.groups.filter((g) => g.id !== 'jjr' && g.id !== 'other');
  const groupRows = [...(jjr !== undefined && jjr.count > 0 ? [jjr] : []), ...competitors];
  const others = model.groups.find((g) => g.id === 'other')?.count ?? 0;
  return (
    <Layout title={`Report ${model.label}`} path="/report">
      <form class="filters inline-wrap no-print" method="get">
        <Select name="quarter" label="Quarter" value={model.quarter} options={model.quarters.map((q) => [q, q] as const)} blank={null} />
        <NoScriptApply />
        <button type="button" onclick="window.print()">
          Print or save as PDF
        </button>
      </form>
      <h1>Regulatory and enforcement summary</h1>
      <p class="sub">{model.label}. From public Australian sources. Check each source before you act.</p>

      <div class="stats">
        <Stat value={model.counts.high} text="High priority changes" />
        <Stat value={model.counts.action} text="May need action" />
        <Stat value={model.counts.submissions} text="Invite submissions" />
        <Stat value={jjr?.count ?? 0} text="Enforcement records against JJ Richards" />
      </div>

      <h2>Important changes</h2>
      {model.changes.length === 0 ? (
        <div class="empty">No high priority changes in this quarter.</div>
      ) : (
        <ul class="stack">
          {model.changes.map((row) => (
            <li>
              <Title item={row.item} text={row.item.title} />
              <div class="note">
                {row.item.jurisdiction} · {date(row.item.publishedAt)} · {ITEM_TYPE_LABELS[row.answers.itemType.choice] ?? row.answers.itemType.choice}
                {row.item.partyGroup !== null && ` · Names ${GROUP_LABELS[row.item.partyGroup] ?? row.item.partyGroup}`}
              </div>
              {row.item.summary !== null && <div>{row.item.summary.what}</div>}
            </li>
          ))}
        </ul>
      )}

      <h2>Coming dates (next 90 days)</h2>
      {model.dates.length === 0 ? <div class="empty">No dates in the next 90 days.</div> : <DateTable entries={model.dates} />}

      <h2>Enforcement against JJ Richards and competitors</h2>
      {jjr === undefined || jjr.count === 0 ? <p>No enforcement records against JJ Richards in the sources for this quarter.</p> : null}
      {competitors.length === 0 && <p>No enforcement records against the listed competitors in this quarter.</p>}
      {groupRows.length > 0 && <GroupTable rows={groupRows} name={(g) => g.label} />}
      {model.named.length > 0 && (
        <ul class="stack">
          {model.named.map((item) => (
            <li>
              <Title item={item} text={item.party ?? item.title} />
              <div class="note">
                {item.jurisdiction} · {date(item.publishedAt)} · {item.action}
                {item.penaltyAud !== null && ` · ${aud(item.penaltyAud)}`}
              </div>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && <p class="note">Other waste operators had {others} enforcement records in this quarter.</p>}

      <h2>Open actions</h2>
      {model.acting.length === 0 ? (
        <p>No bookmarked items with the status Acting.</p>
      ) : (
        <ul class="stack">
          {model.acting.map(({ item, tracking }) => (
            <li>
              <Title item={item} text={item.party ?? item.title} />
              {tracking.note !== '' && <div>{tracking.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
};
