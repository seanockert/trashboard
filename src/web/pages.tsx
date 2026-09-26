import type { Child } from 'hono/jsx';
import type { StoredItem, Triage } from '../items';
import { SORTS, type Sort, type Tab } from '../db';
import { PARTY_GROUPS } from '../parties';
import { FLAG_MIN } from '../rank';
import type { SearchResult } from '../search';
import { Layout } from './layout';
import {
  inboxParams,
  ITEM_TYPE_LABELS,
  OFFENCE_LABELS,
  PAGE_SIZE,
  PRIORITY_LEVEL_LABELS,
  brisbaneDay,
  shownFilters,
  sortOf,
  snippet,
  type DateEntry,
  type groupTable,
  type InboxFields,
  type InboxFilters,
  type PenaltyBenchmark,
  type Row,
} from './models';
import { formatOmni, omniSpec } from './omnibar';

const STRONG_MATCH = 0.7;

const aud = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const date = (iso: string | null) =>
  iso === null ? 'No date' : new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const cardDate = (iso: string | null) => (iso !== null && iso.slice(0, 4) === today().slice(0, 4) ? date(iso).replace(/ \d{4}$/, '') : date(iso));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const query = (params: Record<string, string | number | undefined>) =>
  `?${new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]])))}`;

const GROUP_LABELS: Record<string, string> = Object.fromEntries(PARTY_GROUPS.map((g) => [g.id, g.label]));

const inboxHref = (filters: InboxFilters, fields: InboxFields) => `/${query(inboxParams({ ...filters, page: 1 }, fields))}`;

const hereHref = (filters: InboxFilters, fields: InboxFields) => `/${query(inboxParams(filters, fields))}`;

const SearchIcon = () => (
  <svg width="24" height="24" fill="none" class="icon-search" aria-hidden="true">
    <path fill="currentColor" fill-rule="evenodd" d="M14.4 15.4a6.8 6.8 0 1 1 1-1l5.2 5.1a.7.7 0 1 1-1 1.1zm-8-1.5a5.2 5.2 0 1 1 7.5 0c-2 2-5.4 2-7.4 0" clip-rule="evenodd"></path>
  </svg>
);

// Works without script: type tokens, press Enter.
// `hidden` keeps tab, view, sort on filter change.
// A default filter that the bar shows is not one to clear.
const OmniBar = ({
  fields,
  filters,
  hidden,
  children,
}: {
  fields: InboxFields;
  filters: InboxFilters;
  hidden: Record<string, string | undefined>;
  children?: Child;
}) => {
  const omni = formatOmni(fields, shownFilters(filters));
  const clearable = formatOmni(fields, filters) !== '';
  return (
    <form class="omni stack-half" method="get" action="/" role="search" data-spec={JSON.stringify(omniSpec(fields))}>
      <div class="omni-box field">
        <div class="omni-mirror" aria-hidden="true" />
        <input
          type="text"
          id="q"
          name="q"
          value={omni}
          placeholder="Rummage by topic, place or company, or just type"
          aria-label="Filter and search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="omni-list"
        />
        <div class="omni-pop" id="omni-list" role="listbox" aria-label="Suggestions" hidden />
        <SearchIcon />
      </div>
      {Object.entries(hidden).map(([name, value]) => value !== undefined && <input type="hidden" name={name} value={value} />)}
      {(children !== undefined || clearable) && (
        <div class="omni-toggles inline-2x inline-wrap">
          {children}
          {clearable && (
            <a class="note" href={`/${query(hidden)}`}>
              Clear all
            </a>
          )}
        </div>
      )}
      {filters.invalid.length > 0 && <div class="error note">Never heard of it, so we skipped it: {filters.invalid.join(', ')}</div>}
      <noscript>
        <button type="submit">Apply</button>
      </noscript>
    </form>
  );
};

const AskAi = ({ text }: { text: string }) =>
  text === '' ? null : (
    <>
      {' '}
      <a href={`/search?${new URLSearchParams({ q: text })}`}>Ask AI about “{text}”</a>
    </>
  );

const Title = ({ item }: { item: StoredItem }) => (
  <a class="title" href={item.url} target="_blank" rel="noopener noreferrer">
    {item.kind === 'enforcement' ? (item.party ?? item.title) : item.title}
  </a>
);

const PRIORITY_HELP = {
  regulatory: 'Priority combines how much the item is about waste with its effect on operations, and whether it needs action or invites submissions.',
  enforcement: 'Priority combines how serious the conduct is with the risk that it can also happen in your operations.',
};

const Priority = ({ row }: { row: Row }) => (
  <>
    <span class={`prio ${row.level}`} title={`${PRIORITY_HELP[row.kind]} Score: ${Math.round(row.priority * 100)} of 100.`}>
      {PRIORITY_LEVEL_LABELS[row.level]}
    </span>
    {row.level !== 'low' && row.reasons.length > 0 && <span>{row.reasons.join(' · ')}</span>}
  </>
);

const TagLink = ({ href, on, kind, text }: { href: string; on: boolean; kind: 'sticker' | 'sticker jjr' | 'topic'; text: string }) => (
  <a class={`${kind}${on ? ' on' : ''}`} href={href} title={on ? 'Remove this filter' : 'Show only items with this tag'}>
    {text}
  </a>
);

const anchor = (item: StoredItem) => `item-${item.id.replace(/[^\w-]/g, '_')}`;

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

const today = () => brisbaneDay(new Date());

const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const DATE_VERBS = { closes: ['Closes', 'Submissions closed'], starts: ['Starts', 'Started'] } as const;

// Near dates count down. Far dates show the date.
const dueText = (type: keyof typeof DATE_VERBS, iso: string, now: string) => {
  const verb = DATE_VERBS[type][0];
  const days = dayCount(now, iso);
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow`;
  return days <= DUE_DAYS ? `${verb} in ${days} days` : `${verb} ${date(iso)}`;
};

const itemDates = (item: StoredItem) =>
  [
    { type: 'closes' as const, iso: item.closesOn },
    { type: 'starts' as const, iso: item.startsOn },
  ].flatMap(({ type, iso }) => (iso === null ? [] : [{ type, iso }]));

// Coming dates: timer at top. Past dates: plain sticker.
const Timers = ({ item }: { item: StoredItem }) => {
  const now = today();
  return itemDates(item)
    .filter((d) => d.iso >= now)
    .map((d) => (
      <span class="timer" title={`${d.type === 'closes' ? 'Submissions close' : 'Starts to apply'} ${date(d.iso)}`}>
        {dueText(d.type, d.iso, now)}
      </span>
    ));
};

const PastDates = ({ item }: { item: StoredItem }) => {
  const now = today();
  return itemDates(item)
    .filter((d) => d.iso < now)
    .map((d) => (
      <span class="sticker past">
        {DATE_VERBS[d.type][1]} {date(d.iso)}
      </span>
    ));
};

// Live: script flies card out and saves in background. Else a plain post.
type TriageProps = { item: StoredItem; back: string; live: boolean };

const TriageShell = ({ item, back, live, status, className, children }: TriageProps & { status: string; className: string; children: Child }) => (
  <form class={className} method="post" action="/triage" data-status={status} data-triage={live ? '' : undefined} hx-boost={live ? 'false' : undefined}>
    <input type="hidden" name="itemId" value={item.id} />
    <input type="hidden" name="back" value={back} />
    {children}
  </form>
);

const out = (live: boolean, dir: 'act' | 'dismiss') => (live ? dir : undefined);

const QuickTriage = ({ item, back, live }: TriageProps) => (
  <TriageShell item={item} back={back} live={live} status="new" className="actions inline-half">
    <button type="submit" name="status" value="dismissed" class="secondary" data-out={out(live, 'dismiss')} aria-describedby={`${anchor(item)}-title`} title="Chuck it. Restore it from Dismissed any time.">
      Dismiss
    </button>
    <button type="submit" name="status" value="acting" class="act" data-out={out(live, 'act')} aria-describedby={`${anchor(item)}-title`} title="Act on it. Moves it to Acting.">
      Act
    </button>
  </TriageShell>
);

const TriageForm = ({ item, triage, back, live }: TriageProps & { triage: Triage }) => (
  <TriageShell item={item} back={back} live={live} status={triage.status} className="triage stack-half">
    {triage.status === 'acting' && (
      <textarea name="note" aria-label="Note" rows={2} maxlength={500} placeholder="Note, for example: raised with ops, due 1 July">
        {triage.note}
      </textarea>
    )}
    {(triage.status === 'done' || triage.status === 'dismissed') && triage.note !== '' && <div class="triage-note">{triage.note}</div>}
    <div class="inline-half inline-between inline-wrap">
      {triage.status === 'acting' && (
        <>
          <button type="submit" name="status" value="acting" class="secondary">
            Save note
          </button>
          <div class="inline-half">
            <button type="submit" name="status" value="new" class="secondary" data-out={out(live, 'act')} title="Back to New. Clears the note.">
              Move back to New
            </button>
            <button type="submit" name="status" value="done" data-out={out(live, 'dismiss')}>
              Dismiss
            </button>
          </div>
        </>
      )}
      {triage.status === 'done' && (
        <>
          <div class="pill done">Done</div>
          <button type="submit" name="status" value="acting" class="secondary" data-out={out(live, 'act')}>
            Reopen
          </button>
        </>
      )}
      {triage.status === 'dismissed' && (
        <button type="submit" name="status" value="new" class="secondary" data-out={out(live, 'act')}>
          Restore
        </button>
      )}
    </div>
  </TriageShell>
);

type CardProps = { row: Row; filters: InboxFilters; fields: InboxFields; back: string; index: number; live?: boolean; badge?: Child };

// Slot holds card and swipe layer. Slot closes when card leaves.
const ItemCard = ({ row, filters, fields, back, index, live = false, badge }: CardProps) => {
  const { item } = row;
  const { picked } = filters;
  const toggle = <K extends 'topic' | 'company' | 'type'>(key: K, value: NonNullable<InboxFilters['picked'][K]>) =>
    inboxHref({ ...filters, picked: { ...picked, [key]: picked[key] === value ? undefined : value } }, fields);
  const group = item.partyGroup;
  const companyValue = fields.company.options.find((o) => o.value === group)?.value;
  const facts = [row.kind === 'regulatory' ? ITEM_TYPE_LABELS[row.answers.itemType.choice] : item.action, cardDate(item.publishedAt)].filter((fact) => fact !== undefined && fact !== '');
  const closesLater = item.closesOn !== null && item.closesOn >= today();
  const swipe = live && row.triage === null;
  const here = `${back}#${anchor(item)}`;
  return (
    <div class="slot" style={`--i:${Math.min(index, 10)}`} data-swipe={swipe ? '' : undefined}>
      {swipe && (
        <div class="reveal" aria-hidden="true">
          <span class="out-act">Act</span>
          <span class="out-dismiss">Chuck it</span>
        </div>
      )}
      <article class="card stack-half" id={anchor(item)}>
        <div class="card-top inline-half inline-wrap">
          <div class="meta inline-half inline-wrap">
            {badge ?? <Priority row={row} />}
            <span class="state">{item.jurisdiction}</span>
            <span>{facts.join(' · ')}</span>
          </div>
          {row.kind === 'regulatory' ? <Timers item={item} /> : item.penaltyAud !== null && <span class="penalty" title="Penalty">{aud(item.penaltyAud)}</span>}
        </div>
        <h2 id={`${anchor(item)}-title`}>
          <Title item={item} />
        </h2>
        <ItemText item={item} />
        <div class="card-foot inline-wrap">
          <div class="stickers inline-wrap">
            {group !== null && companyValue !== undefined && (
              <TagLink
                href={toggle('company', companyValue)}
                on={picked.company === group}
                kind={group === 'jjr' ? 'sticker jjr' : 'sticker'}
                text={row.kind === 'regulatory' ? `Names ${GROUP_LABELS[group] ?? group}` : (GROUP_LABELS[group] ?? group)}
              />
            )}
            {row.kind === 'enforcement' && row.answers.similarRisk.noul >= FLAG_MIN && <span class="sticker warn">Check own risk</span>}
            {row.kind === 'regulatory' ? (
              <>
                {row.answers.actionRequired.noul >= FLAG_MIN && <span class="sticker warn">Action may be needed</span>}
                {row.answers.submissionsOpen.noul >= FLAG_MIN && !closesLater && <span class="sticker warn">Submissions invited</span>}
                <PastDates item={item} />
                {row.topics.map((topic) => (
                  <TagLink kind="topic" href={toggle('topic', topic.key)} on={picked.topic === topic.key} text={topic.label} />
                ))}
              </>
            ) : (
              <>
                <TagLink kind="topic" href={toggle('type', 'enforcement')} on={picked.type === 'enforcement'} text="Enforcement" />
                <span class="topic">{OFFENCE_LABELS[row.answers.offence.choice] ?? row.answers.offence.choice}</span>
                {item.location !== null && <span class="topic">{item.location.slice(0, 60)}</span>}
              </>
            )}
          </div>
          {row.triage === null && <QuickTriage item={item} back={here} live={live} />}
        </div>
        {row.triage !== null && <TriageForm item={item} triage={row.triage} back={here} live={live} />}
      </article>
    </div>
  );
};

const Pager = ({ filters, fields, matched }: { filters: InboxFilters; fields: InboxFields; matched: number }) => {
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  if (pages === 1) return null;
  const href = (page: number) => hereHref({ ...filters, page }, fields);
  return (
    <nav class="pager inline-between" aria-label="Pages">
      {filters.page > 1 ? <a href={href(filters.page - 1)}>Previous</a> : <div />}
      <div class="note">
        Page {filters.page} of {pages}
      </div>
      {filters.page < pages ? <a href={href(filters.page + 1)}>Next</a> : <div />}
    </nav>
  );
};

export const LoginPage = ({ next, error }: { next: string; error: string | null }) => (
  <Layout title="Log in" path={null}>
    <form class="login stack" method="post" action="/login">
      <h1 class="inline"><img src="/assets/trashboard-icon-sm.png" height="48" width="48" alt="" />Trashboard</h1>
      <div class="note">Tip pass, please.</div>
      {error !== null && (
        <div class="error" role="alert">
          {error}
        </div>
      )}
      <input type="hidden" name="next" value={next} />
      <label class="stack-quarter">
        Password <input type="password" name="password" autocomplete="current-password" required autofocus />
      </label>
      <button type="submit">Log in</button>
    </form>
  </Layout>
);

const DATE_TYPE_LABELS: Record<DateEntry['type'], string> = { closes: 'Submissions close', starts: 'Starts to apply' };

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
              <Title item={entry.row.item} />
              {entry.row.triage?.status === 'acting' && <div class="pill acting">Acting</div>}
            </td>
            <td>{entry.row.item.jurisdiction}</td>
            <td>
              <div class={`prio ${entry.row.level}`}>{PRIORITY_LEVEL_LABELS[entry.row.level]}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Most dates are close dates, so only a start date has a label.
const DueList = ({ entries }: { entries: DateEntry[] }) => {
  const now = today();
  return (
    <details class="due">
      <summary>
        <h2>Countdown</h2>
        <span class="note">
          Next {DUE_DAYS} days · {entries.length}
        </span>
      </summary>
      {entries.length === 0 ? (
        <p class="note">Nothing due. Clear road.</p>
      ) : (
        <ul class="stack">
          {entries.map((entry) => {
            const days = dayCount(now, entry.date);
            return (
              <li>
                <div class="due-date" title={date(entry.date)}>
                  <b class="days">{days}</b>
                  <span>{days === 1 ? 'day' : 'days'}</span>
                </div>
                <div class="stack-quarter">
                  <Title item={entry.row.item} />
                  <div class="due-meta inline-wrap">
                    <span class={`prio ${entry.row.level}`} title="Priority">
                      {PRIORITY_LEVEL_LABELS[entry.row.level]}
                    </span>
                    <span class="state">{entry.row.item.jurisdiction}</span>
                    <span>{shortDate(entry.date)}</span>
                    {entry.type === 'starts' && <span>Starts to apply</span>}
                    {entry.row.triage?.status === 'acting' && <span class="pill acting">Acting</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
};

const TAB_LABELS: Record<Tab, string> = { new: 'New', acting: 'Acting', done: 'Dismissed' };

const SORT_LABELS: Record<Sort, string> = { priority: 'Priority', newest: 'Newest', oldest: 'Oldest', triaged: 'Last touched' };

const SortSelect = ({ filters, fields }: { filters: InboxFilters; fields: InboxFields }) => {
  const { page: _, ...params } = inboxParams({ ...filters, sort: undefined }, fields);
  const sorts = SORTS.filter((s) => s !== 'triaged' || filters.tab !== 'new');
  return (
    <form class="sort" method="get" action="/">
      {Object.entries(params).map(([name, value]) => value !== undefined && value !== '' && <input type="hidden" name={name} value={String(value)} />)}
      <select name="sort" aria-label="Sort" onchange="this.form.requestSubmit()">
        {sorts.map((s) => (
          <option value={s} selected={sortOf(filters) === s}>
            {SORT_LABELS[s]}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Sort</button>
      </noscript>
    </form>
  );
};

const EMPTY_TEXT: Record<Tab, string> = {
  new: 'Nothing at the tip today. You’re all caught up.',
  acting: 'Nothing on the truck. Click Act on an item to load it up.',
  done: 'Nothing binned yet.',
};

export const DUE_DAYS = 30;

// Inbox zero on New gets a starburst.
const Empty = ({ filters }: { filters: InboxFilters }) => {
  const plain = filters.text === '' && filters.picked.topic === undefined;
  if (plain && filters.tab === 'new')
    return (
      <div class="empty clear">
        <div class="burst">
          <span>All clear!</span>
        </div>
        <p>{EMPTY_TEXT.new}</p>
      </div>
    );
  return (
    <div class="empty">
      {plain ? EMPTY_TEXT[filters.tab] : 'Nothing in this pile. Try other filters.'}
      <AskAi text={filters.text} />
    </div>
  );
};

type InboxModel = { rows: Row[]; counts: Record<Tab, number>; due: DateEntry[]; reportQuarter: string };

export const InboxPage = ({ model, filters, fields }: { model: InboxModel; filters: InboxFilters; fields: InboxFields }) => {
  const report = { ...filters, view: 'report' as const, picked: { ...filters.picked, period: filters.picked.period ?? model.reportQuarter } };
  const back = hereHref(filters, fields);
  return (
    <Layout title="Inbox" path="/" menu={<a href={hereHref({ ...report, page: 1 }, fields)}>Report</a>}>
      <h1 class="visually-hidden">Inbox</h1>
      <div class="inbox">
        <div class="inbox-bar stack">
          <OmniBar fields={fields} filters={filters} hidden={{ tab: filters.tab === 'new' ? undefined : filters.tab, sort: filters.sort }} />
          <nav class="tabs inline" aria-label="Status">
            {(['new', 'acting', 'done'] as const).map((tab) => (
              <a href={inboxHref({ ...filters, tab }, fields)} class={filters.tab === tab ? 'on' : ''} aria-current={filters.tab === tab ? 'page' : undefined}>
                <span>
                  {TAB_LABELS[tab]}
                  <i class="count" id={`count-${tab}`}>
                    {model.counts[tab] > 0 ? model.counts[tab] : ''}
                  </i>
                </span>
              </a>
            ))}
            <SortSelect filters={filters} fields={fields} />
          </nav>
        </div>
        <DueList entries={model.due} />
        <div class="inbox-list stack-half">
          {filters.tab === 'new' && model.rows.length > 0 && (
            <p class="note">
              {filters.picked.period === undefined && sortOf(filters) === 'priority' && 'JJ Richards first, then the big stuff. '}
              <span class="swipe-hint">Swipe right to act, left to chuck.</span>
            </p>
          )}
          {model.rows.length === 0 ? (
            <Empty filters={filters} />
          ) : (
            <div>
              {model.rows.map((row, index) => (
                <ItemCard row={row} filters={filters} fields={fields} back={back} index={index} live />
              ))}
            </div>
          )}
          <Pager filters={filters} fields={fields} matched={model.counts[filters.tab]} />
        </div>
      </div>
      <div class="toast inline" id="toast" role="status" aria-live="polite">
        <span />
        <button type="button" class="secondary" data-undo>
          Undo
        </button>
      </div>
    </Layout>
  );
};

type GroupRow = ReturnType<typeof groupTable>[number];

const GroupTable = ({ rows }: { rows: GroupRow[] }) => (
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
            <td>{g.label}</td>
            <td class="num">{g.count}</td>
            <td class="num">{g.serious}</td>
            <td class="num">{g.penaltyTotal > 0 ? aud(g.penaltyTotal) : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Stat = ({ value, text }: { value: number; text: string }) => (
  <div class="stat">
    <div class="value">{value}</div>
    <div class="note">{text}</div>
  </div>
);

type ReportModel = {
  label: string;
  counts: { high: number; action: number; submissions: number };
  top: Row[];
  dates: DateEntry[];
  groups: ReturnType<typeof groupTable>;
  acting: Row[];
};

export const REPORT_DATE_DAYS = 90;

const ReportItem = ({ row }: { row: Row }) => (
  <li class="report-item">
    <Title item={row.item} />
    <div class="note">
      {row.item.jurisdiction} · {date(row.item.publishedAt)} · {row.kind === 'regulatory' ? ITEM_TYPE_LABELS[row.answers.itemType.choice] : row.item.action}
      {row.item.partyGroup !== null && ` · ${GROUP_LABELS[row.item.partyGroup] ?? row.item.partyGroup}`}
      {row.item.penaltyAud !== null && ` · ${aud(row.item.penaltyAud)}`}
    </div>
    {row.item.summary !== null && <div>{row.item.summary.what}</div>}
    {row.triage !== null && row.triage.note !== '' && <div class="triage-note">Note: {row.triage.note}</div>}
  </li>
);

export const ReportView = ({ model, filters, fields }: { model: ReportModel; filters: InboxFilters; fields: InboxFields }) => {
  const jjr = model.groups.find((g) => g.id === 'jjr');
  const others = formatOmni(fields, { ...filters, picked: { ...filters.picked, period: undefined } });
  return (
    <Layout title={`Report ${model.label}`} path="/">
      <div class="no-print stack-half">
        <OmniBar fields={fields} filters={filters} hidden={{ view: 'report' }} />
      </div>
      <h1>Regulatory and enforcement summary</h1>
      <p class="sub">
        {model.label}
        {others !== '' && ` · ${others}`}. From public Australian sources. Check each source before you act.
      </p>

      <div class="inline">
        <button type="button" onclick="window.print()">
          Print or save as PDF
        </button>
      </div>

      <div class="stats">
        <Stat value={model.counts.high} text="High priority changes" />
        <Stat value={model.counts.action} text="May need action" />
        <Stat value={model.counts.submissions} text="Invite submissions" />
        <Stat value={jjr?.count ?? 0} text="Enforcement records against JJ Richards" />
      </div>

      <h2>Important items</h2>
      {model.top.length === 0 ? (
        <div class="empty">No big stuff this period. Nice.</div>
      ) : (
        <ul class="stack">
          {model.top.map((row) => (
            <ReportItem row={row} />
          ))}
        </ul>
      )}

      <h2>Coming dates (next {REPORT_DATE_DAYS} days)</h2>
      {model.dates.length === 0 ? <div class="empty">Nothing due in the next {REPORT_DATE_DAYS} days. Clear road.</div> : <DateTable entries={model.dates} />}

      <h2>Enforcement by company</h2>
      <GroupTable rows={model.groups} />
      <p class="note">Records about waste operators in this period. Counts depend on which registers publish data. Records that name a person are not stored.</p>

      <h2>Open actions</h2>
      {model.acting.length === 0 ? (
        <p>Nothing on the truck.</p>
      ) : (
        <ul class="stack">
          {model.acting.map((row) => (
            <ReportItem row={row} />
          ))}
        </ul>
      )}
    </Layout>
  );
};

const BENCHMARK_MIN = 3;

const PenaltyTable = ({ rows }: { rows: PenaltyBenchmark[] }) =>
  rows.length === 0 ? null : (
    <>
      <h2>Penalties in these results</h2>
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
                <td>{row.label}</td>
                <td class="num">{row.count}</td>
                <td class="num">{row.count >= BENCHMARK_MIN ? aud(row.median) : '-'}</td>
                <td class="num">{aud(row.highest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="note">Amounts that the sources state. The QLD register states no amounts. A median of fewer than {BENCHMARK_MIN} penalties is not shown.</p>
    </>
  );

const EXAMPLES = ['stormwater fines at transfer stations', 'changes to the QLD waste levy', 'PFAS rules for landfills'];

const SearchBox = ({ query }: { query: string }) => (
  <form class="field" method="get" action="/search" role="search">
    <input type="search" id="q" name="q" value={query} placeholder="Ask a question, for example: fines for leachate discharge" aria-label="Search" />
    <SearchIcon />
  </form>
);

type SearchModel = { query: string; result: SearchResult | null; rows: Row[]; scores: ReadonlyMap<string, number>; penalties: PenaltyBenchmark[] };

// Search reads all items, also the ones the inbox hides.
export const SearchPage = ({ model, filters, fields }: { model: SearchModel; filters: InboxFilters; fields: InboxFields }) => {
  const back = `/search?${new URLSearchParams({ q: model.query })}`;
  return (
    <Layout title={model.query === '' ? 'Search' : `Search: ${model.query}`} path="/search">
      <h1>Search</h1>
      <SearchBox query={model.query} />
      {model.result === null ? (
        <p class="note">
          Dig through the whole tip, even the stuff the inbox hides. Try:{' '}
          {EXAMPLES.map((text, i) => (
            <>
              {i > 0 && ' · '}
              <a href={`/search?${new URLSearchParams({ q: text })}`}>{text}</a>
            </>
          ))}
        </p>
      ) : (
        <>
          <p class="sub">{plural(model.rows.length, 'result')}. Best finds on top.</p>
          <PenaltyTable rows={model.penalties} />
          {model.rows.length === 0 ? (
            <div class="empty">Dug through the whole tip. Nothing. Try other words.</div>
          ) : (
            <div>
              {model.rows.map((row, index) => {
                const strong = (model.scores.get(row.item.id) ?? 0) >= STRONG_MATCH;
                return (
                  <ItemCard
                    row={row}
                    filters={filters}
                    fields={fields}
                    back={back}
                    index={index}
                    badge={
                      <span class={`prio ${strong ? 'match' : 'low'}`} title="How sure the AI model is that this item helps answer the search.">
                        {strong ? 'Strong match' : 'Possible match'}
                      </span>
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </Layout>
  );
};

type SourceRow = {
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
    <p class="sub">The truck comes each day at 05:00 Brisbane time. "Update now" sends it out early. {pending} items wait for tags.</p>
    <form method="post" action="/sources/update">
      <button type="submit">Update now</button>
    </form>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th style="min-width:13.8rem">Source</th>
            <th>Type</th>
            <th style="min-width:13.8rem">Last run</th>
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
