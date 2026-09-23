import { Jurisdiction, type StoredItem, type Tracking, type TrackStatus } from '../items';
import { LINES_OF_BUSINESS, OFFENCES, TOPICS } from '../jev/answers';
import { PARTY_GROUPS } from '../parties';
import type { SearchResult } from '../search';
import { Layout } from './layout';
import {
  LOB_LABELS,
  OFFENCE_LABELS,
  PAGE_SIZE,
  snippet,
  TOPIC_LABELS,
  type ChangeRow,
  type ChangesFilters,
  type EnforcementFilters,
  type EnforcementRow,
  type groupTable,
  type offenceChips,
  type PriorityLevel,
} from './models';
import { FLAG_MIN } from '../rank';

// Search results below this Jev score show as "Possible match".
const STRONG_MATCH = 0.7;

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
    <form method="post" action="/track">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="back" value={`${back}#${anchor(item)}`} />
      <div class="track-status">
        {(['watching', 'acting'] as const).map((status) => (
          <label>
            <input type="radio" name="status" value={status} checked={(tracking?.status ?? 'watching') === status} /> {TRACK_LABELS[status]}
          </label>
        ))}
      </div>
      <textarea name="note" rows={2} maxlength={500} placeholder="Note, for example: raised with ops, due 1 July">
        {tracking?.note ?? ''}
      </textarea>
      <div class="track-actions">
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

// The status and note of a bookmarked item, at the bottom of the card.
// The AI summary if there is one, else the start of the source text.
const ItemText = ({ item }: { item: StoredItem }) => {
  if (item.summary !== null)
    return (
      <div class="summary" title="AI summary of the source text. Check the source before you act.">
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

const TrackInfo = ({ tracking }: { tracking: Tracking | undefined }) =>
  tracking === undefined ? null : (
    <div class="track">
      <span class={`pill ${tracking.status}`}>{TRACK_LABELS[tracking.status]}</span>
      {tracking.note !== '' && <span class="track-note">{tracking.note}</span>}
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
      <h1><img src="/assets/trashboard-icon-sm.png" height="48" width="48" /> Trashboard</h1>
      <div class="note">Enter the password to continue.</div>
      {failed && <div class="error">The password is not correct.</div>}
      <input type="hidden" name="next" value={next} />
      <input type="password" name="password" autocomplete="current-password" required autofocus />
      <button type="submit">Log in</button>
    </form>
  </Layout>
);

const ChangeCard = ({ row, filters, tracking }: { row: ChangeRow; filters: ChangesFilters; tracking: TrackingMap }) => {
  const href = (key: 'lob' | 'topic' | 'need', value: string) => query({ ...filters, page: undefined, [key]: filters[key] === value ? undefined : value });
  return (
    <div class="card" id={anchor(row.item)}>
      <Bookmark item={row.item} tracking={tracking.get(row.item.id)} back={`/changes${query(filters)}`} />
      <div class="meta">
        <Priority row={row} />
        <div>{row.item.jurisdiction}</div>
        <div>{date(row.item.publishedAt)}</div>
        <div>{ITEM_TYPE_LABELS[row.answers.itemType.choice] ?? row.answers.itemType.choice}</div>
      </div>
      <Title item={row.item} text={row.item.title} />
      <ItemText item={row.item} />
      <div class="tags">
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
    </div>
  );
};

export const ChangesPage = ({ rows, matched, filters, tracking }: { rows: ChangeRow[]; matched: number; filters: ChangesFilters; tracking: TrackingMap }) => {
  const toggleAll = query({ ...filters, page: undefined, all: filters.all === '1' ? undefined : '1' });
  return (
    <Layout title="Regulatory changes" path="/changes">
      <h1>Regulatory changes</h1>
      <p class="sub">
        New laws, consultations and regulator news that can affect the business. The most important are first. <a href="/about#priority">How priority works</a>
      </p>
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
      {rows.length === 0 ? <div class="empty">No items match these filters.</div> : rows.map((row) => <ChangeCard row={row} filters={filters} tracking={tracking} />)}
      <Pager filters={filters} matched={matched} />
      <p class="note">
        <a href={toggleAll}>{filters.all === '1' ? 'Hide items that are probably not relevant' : 'Also show items that are probably not relevant'}</a>
      </p>
    </Layout>
  );
};

const EnforcementCard = ({ row, filters, tracking }: { row: EnforcementRow; filters: EnforcementFilters; tracking: TrackingMap }) => (
  <div class="card" id={anchor(row.item)}>
    <Bookmark item={row.item} tracking={tracking.get(row.item.id)} back={`/enforcement${query(filters)}`} />
    <div class="meta">
      <div>{row.item.jurisdiction}</div>
      <div>{date(row.item.publishedAt)}</div>
      <div>{row.item.action}</div>
      {row.item.penaltyAud !== null && <div>{aud(row.item.penaltyAud)}</div>}
    </div>
    <Title item={row.item} text={row.item.party ?? row.item.title} />
    <ItemText item={row.item} />
    <div class="tags">
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

export type EnforcementModel = { groups: ReturnType<typeof groupTable>; offences: ReturnType<typeof offenceChips>; list: EnforcementRow[]; matched: number };

export const EnforcementPage = ({ model, filters, tracking }: { model: EnforcementModel; filters: EnforcementFilters; tracking: TrackingMap }) => (
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
        <p class="count">{result.hits.length === 1 ? '1 result' : `${result.hits.length} results`}</p>
        {result.hits.length === 0 ? (
          <div class="empty">No stored item answers this. Try other words.</div>
        ) : (
          result.hits.map((hit) => (
            <div class="card" id={anchor(hit.item)}>
              <Bookmark item={hit.item} tracking={tracking.get(hit.item.id)} back={`/search?${new URLSearchParams({ q: query })}`} />
              <div class="meta">
                <div class={`prio ${hit.score >= STRONG_MATCH ? 'high' : 'medium'}`} title="How sure the AI model is that this item helps answer the search.">
                  {hit.score >= STRONG_MATCH ? 'Strong match' : 'Possible match'}
                </div>
                <div>{hit.item.jurisdiction}</div>
                <div>{date(hit.item.publishedAt)}</div>
                <div>{hit.item.kind === 'enforcement' ? 'Enforcement' : 'Regulatory'}</div>
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
    <div class="card" id={anchor(item)}>
      <Bookmark item={item} tracking={tracking} back="/tracked" />
      <div class="meta">
        <div>{item.jurisdiction}</div>
        <div>{date(item.publishedAt)}</div>
        <div>{item.kind === 'enforcement' ? 'Enforcement' : 'Regulatory'}</div>
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
    <div class="tags" style="margin-bottom:16px">
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

export const AboutPage = ({ sources }: { sources: number }) => (
  <Layout title="About" path="/about">
    <div class="about">
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
          <b>Deadlines flagged.</b> See what needs action or invites submissions.
        </li>
        <li>
          <b>Competitor watch.</b> Fines and prosecutions, grouped by company.
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
        <li>How much is it about waste?</li>
        <li>How much does it change your operations?</li>
      </ul>
      <p>Items that need action or invite submissions rank higher. Each card shows why, for example "High priority · About waste · Compliance change".</p>

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
