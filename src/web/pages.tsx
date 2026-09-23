import { Jurisdiction, type StoredItem } from '../items';
import { LINES_OF_BUSINESS, OFFENCES, TOPICS } from '../jev/answers';
import { PARTY_GROUPS } from '../parties';
import type { SearchResult } from '../search';
import { Bar, Layout } from './layout';
import {
  LOB_LABELS,
  OFFENCE_LABELS,
  PAGE_SIZE,
  TOPIC_LABELS,
  type ChangeRow,
  type ChangesFilters,
  type EnforcementFilters,
  type EnforcementRow,
  type groupTable,
  type offenceChips,
} from './models';

const ITEM_TYPE_LABELS: Record<string, string> = {
  law: 'Law',
  bill: 'Bill',
  consultation: 'Consultation',
  guidance: 'Guidance',
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
  <label>
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
    <div class="pager">
      {current > 1 ? <a href={href(current - 1)}>Previous</a> : <div />}
      <div class="note">
        Page {current} of {pages}
      </div>
      {current < pages ? <a href={href(current + 1)}>Next</a> : <div />}
    </div>
  );
};

export const LoginPage = ({ next, failed }: { next: string; failed: boolean }) => (
  <Layout title="Log in" path={null}>
    <form class="login" method="post" action="/login">
      <h1>Trashboard</h1>
      <div class="note">Enter the password to continue.</div>
      {failed && <div class="error">The password is not correct.</div>}
      <input type="hidden" name="next" value={next} />
      <input type="password" name="password" autocomplete="current-password" required autofocus />
      <button type="submit">Log in</button>
    </form>
  </Layout>
);

const ChangeCard = ({ row }: { row: ChangeRow }) => (
  <div class="card">
    <div class="meta">
      <div>{row.item.jurisdiction}</div>
      <div>{date(row.item.publishedAt)}</div>
      <div>{ITEM_TYPE_LABELS[row.answers.itemType.choice] ?? row.answers.itemType.choice}</div>
      <Bar value={row.priority} />
    </div>
    <Title item={row.item} text={row.item.title} />
    {row.item.body !== '' && <div class="body">{row.item.body}</div>}
    <div class="tags">
      {row.answers.actionRequired.noul >= 0.6 && <div class="tag warn">Action may be needed</div>}
      {row.answers.submissionsOpen.noul >= 0.6 && <div class="tag warn">Submissions invited</div>}
      {row.lines.map((line) => (
        <div class="tag">{line}</div>
      ))}
      {row.topics.map((topic) => (
        <div class="tag">{topic}</div>
      ))}
    </div>
  </div>
);

export const ChangesPage = ({ rows, matched, filters }: { rows: ChangeRow[]; matched: number; filters: ChangesFilters }) => {
  const toggleAll = query({ ...filters, page: undefined, all: filters.all === '1' ? undefined : '1' });
  return (
    <Layout title="Regulatory changes" path="/changes">
      <h1>Regulatory changes</h1>
      <p class="sub">New laws, consultations and regulator news that can affect the business. The most important are first.</p>
      <form class="filters" method="get">
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
        {filters.all === '1' && <input type="hidden" name="all" value="1" />}
        <NoScriptApply />
      </form>
      <p class="count">{matched === 1 ? '1 item' : `${matched} items`}</p>
      {rows.length === 0 ? <div class="empty">No items match these filters.</div> : rows.map((row) => <ChangeCard row={row} />)}
      <Pager filters={filters} matched={matched} />
      <p class="note">
        <a href={toggleAll}>{filters.all === '1' ? 'Hide items that are probably not relevant' : 'Also show items that are probably not relevant'}</a>
      </p>
    </Layout>
  );
};

const EnforcementCard = ({ row }: { row: EnforcementRow }) => (
  <div class="card">
    <div class="meta">
      <div>{row.item.jurisdiction}</div>
      <div>{date(row.item.publishedAt)}</div>
      <div>{row.item.action}</div>
      {row.item.penaltyAud !== null && <div>{aud(row.item.penaltyAud)}</div>}
    </div>
    <Title item={row.item} text={row.item.party ?? row.item.title} />
    {row.item.body !== '' && <div class="body">{row.item.body}</div>}
    <div class="tags">
      <div class="tag">{OFFENCE_LABELS[row.answers.offence.choice] ?? row.answers.offence.choice}</div>
      {row.answers.severity.score >= 2 && <div class="tag warn">Harm or serious conduct</div>}
      {row.answers.similarRisk.noul >= 0.6 && <div class="tag">Similar risk in own operations</div>}
      {row.item.location !== null && <div class="tag">{row.item.location.slice(0, 60)}</div>}
    </div>
  </div>
);

export type EnforcementModel = { groups: ReturnType<typeof groupTable>; offences: ReturnType<typeof offenceChips>; list: EnforcementRow[]; matched: number };

export const EnforcementPage = ({ model, filters }: { model: EnforcementModel; filters: EnforcementFilters }) => (
  <Layout title="Enforcement" path="/enforcement">
    <h1>Enforcement</h1>
    <p class="sub">Fines, orders and prosecutions against companies, from the public registers.</p>
    <form class="filters" method="get">
      <Select name="days" label="Period" value={filters.days} options={ENFORCEMENT_PERIODS} blank={null} />
      <Select name="jurisdiction" label="Jurisdiction" value={filters.jurisdiction} options={JURISDICTIONS} />
      <Select
        name="group"
        label="Company"
        value={filters.group}
        options={[...PARTY_GROUPS.map((g) => [g.id, g.label] as const), ['other', 'Other companies'] as const]}
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
          {model.groups.map((g) => (
            <tr class={g.id === 'jjr' ? 'self' : ''}>
              <td>
                <a href={`?${new URLSearchParams({ ...(filters.jurisdiction ? { jurisdiction: filters.jurisdiction } : {}), days: String(filters.days), group: g.id })}`}>{g.label}</a>
              </td>
              <td class="num">{g.count}</td>
              <td class="num">{g.serious}</td>
              <td class="num">{g.penaltyTotal > 0 ? aud(g.penaltyTotal) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p class="note">Counts depend on which registers publish data. Compare groups in one jurisdiction. Records that name a person are not stored.</p>
    <p class="count">{model.matched === 1 ? '1 record' : `${model.matched} records`}</p>
    {model.list.length === 0 ? <div class="empty">No records match these filters.</div> : model.list.map((row) => <EnforcementCard row={row} />)}
    <Pager filters={filters} matched={model.matched} />
  </Layout>
);

export const SearchPage = ({ query, result }: { query: string; result: SearchResult | null }) => (
  <Layout title="Search" path="/search">
    <h1>Search</h1>
    <p class="sub">Ask a question or type some words.</p>
    <form class="filters" method="get">
      <label style="flex:1;min-width:240px">
        Search
        <input type="search" name="q" value={query} placeholder="for example: stormwater fines at transfer stations" style="width:100%" />
      </label>
      <button type="submit">Search</button>
    </form>
    {result !== null && (
      <>
        <p class="count">{result.hits.length === 1 ? '1 result' : `${result.hits.length} results`}</p>
        {result.hits.length === 0 ? (
          <div class="empty">No stored item answers this. Try other words.</div>
        ) : (
          result.hits.map((hit) => (
            <div class="card">
              <div class="meta">
                <div>{hit.item.jurisdiction}</div>
                <div>{date(hit.item.publishedAt)}</div>
                <div>{hit.item.kind === 'enforcement' ? 'Enforcement' : 'Regulatory'}</div>
                <Bar value={hit.score} />
              </div>
              <Title item={hit.item} text={hit.item.party ?? hit.item.title} />
              <div class="body">{hit.item.body}</div>
            </div>
          ))
        )}
      </>
    )}
  </Layout>
);

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
    <div class="tags" style="margin-bottom:16px">
      <form method="post" action="/sources/run">
        <button type="submit">Run all sources now</button>
      </form>
      <form method="post" action="/sources/retag">
        <button type="submit">Tag waiting items</button>
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
              <td>{row.lastRun?.slice(0, 16).replace('T', ' ') ?? 'Never'}</td>
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
