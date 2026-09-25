# Status

Trashboard is a private dashboard for the in-house legal counsel at JJ Richards & Sons.
It collects public Australian regulatory and enforcement data every day.
Jev (TypeSafe) tags each item one time, when it arrives.
Code does the filters, the ranking, the dates and the company matches.
Workers AI writes a short summary for each card that the views show by default.

## Rules for v1

- Use only free, public data sources.
- Do not keep personal information. Keep enforcement records for companies only.
- Do not upload documents from JJ Richards.
- One user. A single password protects the dashboard.

## v1 scope

| Part | State |
| --- | --- |
| Project setup (TypeScript, Hono, Wrangler, D1, Queues, Cron) | Done |
| 21 sources (14 regulatory, 7 enforcement) | Done, tested live |
| Inbox: one ranked list of regulatory items and enforcement records, with New, Acting and Done tabs | Done |
| Search (D1 full-text search, then Jev rerank) | Done |
| Password login, 5 attempts each minute for each IP address | Done |
| Triage on each card: Act, Dismiss, a note while acting, Done | Done |
| Due dates at the top of the inbox (submission close dates and start dates from the source text, next 30 days) | Done |
| Company tag on regulatory items. Items that name JJ Richards are always shown, first | Done |
| Omni-bar filters with suggestions: period (also each quarter), jurisdiction, topic, type, company | Done |
| Report: the inbox filters on one page, to print or save as PDF | Done |
| Penalty benchmarks by conduct, for the enforcement records in search results | Done |
| Card summaries (Workers AI, Llama 3.1 8B) | Done. Not deployed |
| Tests (parsers, paging, company filter, dates, penalty selection, summary checks, filters, D1 queries, ingest and retry) | Done, 119 tests |
| Fit the Workers Free plan (10 ms CPU, 50 subrequests for each invocation) | Done locally. Check real CPU time after deploy |
| Deploy to Cloudflare (`trashboard.seanockert.workers.dev`) | Not started |
| Labelled test set (about 100 items) to measure tag accuracy | Not started. Needs labels from the user |

## Sources

| Source | Kind | Access | Notes |
| --- | --- | --- | --- |
| Federal Register of Legislation | Regulatory | OData API | New titles with the administering department |
| QLD legislation | Regulatory | Atom feeds, query endpoint for backfill | New Acts, subordinate legislation and bills. Law text from the "whole" view |
| NSW legislation | Regulatory | Atom feeds | Title only. The site blocks automated text requests. No backfill: the feeds keep one week |
| VIC legislation | Regulatory | Site search endpoint | Not a documented API |
| TAS legislation | Regulatory | Atom feed, query endpoint for backfill | Law text from the "whole" view |
| NSW EPA news | Regulatory | HTML | Article text from each page. A backfill reads the list pages to its start date |
| EPA Victoria news | Regulatory | Site search endpoint | Not a documented API |
| QLD enforcement register | Enforcement | CKAN datastore API | No description of the conduct. Code reads the ERA codes |
| EPA Victoria court proceedings | Enforcement | JSON endpoint | Full summary from each page. A run reads again the 90 days before the newest date seen |
| WA DWER enforcement | Enforcement | HTML tables | Notices, penalty notices, prosecutions |
| SA EPA prosecutions | Enforcement | HTML table | Needs a browser-like user agent |
| NSW EPA prosecutions | Enforcement | Salesforce Apex call behind the register search | Not a documented API. One search for each company word ("pty", "ltd" and others), 300 matters for each invocation. Fines for each charge |
| WorkSafe Victoria prosecution result summaries | Enforcement | JSON search API | Not a documented API. 20 records for each page, newest first. A run reads again the 90 days before the newest date seen |
| SafeWork NSW prosecutions | Enforcement | HTML, one page for each month | The index gives the month pages. A run reads again the 2 months before the newest date seen |
| NSW EPA Your Say | Regulatory (consultations) | JSON behind the "load more" list of open projects | Not a documented API. The close date is on each project page, thus the page is the item detail |
| Engage Victoria | Regulatory (consultations) | Inertia page data as JSON | Not a documented API. Needs the version from the home page. Open projects only. EPA Victoria also uses this site. A licence application that names a person is not kept |
| DCCEEW consultation hub | Regulatory (consultations) | Converlens search call behind the hub page | Not a documented API. Open consultations, with start and end times |
| WA DWER consultations | Regulatory (consultations) | Citizen Space search API | All consultations, about 40, in one response |
| QLD environmental authority applications | Regulatory (JJ Richards only) | CKAN datastore SQL | New and amendment applications, with their status |
| EPA Victoria operating licences | Regulatory (JJ Richards only) | Vicmap WFS | One item for each amendment date |
| SA EPA licence changes | Regulatory (JJ Richards only) | JSONP feed of all changes | CloudFront refuses Cloudflare, thus the daily run skips it. Run `bun run relay:sa` on a local computer (see below). The first run reads back about 12 months |

## SA EPA relay

The SA EPA register returns HTTP 403 to Cloudflare. To update it, run this on a local computer from time to time:

```
TRASHBOARD_URL=https://<worker url> DASHBOARD_PASSWORD=... bun run relay:sa
```

The script logs in, fetches each page, and sends it to `POST /relay/sa`. The worker stops at the cursor, thus a missed week loses nothing.

## Backfill

The first run of each source (the daily run or "Update now" on the Sources page) sends a start date 12 months back. Later runs load only what is new.
The Federal Register, VIC and NSW EPA sources page back to the start date. QLD and TAS use the query endpoint behind the browse pages (not a documented API). NSW legislation and the enforcement sources ignore the start date. The enforcement sources hold their full history already.
A new item gets tags. An item that is stored already, with the same content, does not.

## Measured results (local run, 2026-09-23)

- 2,186 items stored. 805 enforcement records were dropped because they name a person.
- Jev tagged 2,096 items with 0 failures, for US$0.13 (about 1,500 input tokens each).
- Regulatory changes, last 30 days: 31 of 527 items pass the relevance gate. In the top 10, 8 are relevant (checked by Claude, not by the user).
- Items with a priority of 0.15 or more: 10 of 12 are relevant.
- Enforcement: Jev selected a penalty amount in 290 of 417 records that have dollar amounts.
- Search: about 0.5 seconds and US$0.0007 for each query.
- Pages load in less than 40 ms on local D1.

The success criterion "90% of the top 20 are relevant" is not a good measure.
In a quiet month there are fewer than 20 relevant items.
A better measure is precision above a priority threshold, and recall on a labelled set.

## Summaries

- Model: `@cf/meta/llama-3.1-8b-instruct-fp8-fast`, JSON mode. About 6 neurons for each item. The free plan gives 10,000 neurons each day.
- An item gets a summary right after its tags, if the view shows it by default and its source has prose text (news, laws, VIC court, SA prosecutions). QLD enforcement gives only fields, thus no summary.
- The daily run sends up to 600 older items with no current summary. Increase `SUMMARY_VERSION` after a prompt change.
- Code checks each answer. It drops a point with a number that is not in the text, a point copied from the prompt example, and a point that repeats the title.
- Tested on 33 items (2026-09-23), rated by the user as better than the start of the text. Laws are the weakest, because the model sees only the first 4,000 characters.
- A summary can still give a wrong date when that date is in the text for a different reason.

## Workers Free plan design

- One ingest message is one page of one source. A page sends the next page as a new message. The cursor moves only after the last page.
- Remote runs on 2026-09-23 stored pages of up to 376 records with no failure.
- The pipeline does not keep a copy of the source files. They can hold names of persons.
- QLD uses the CKAN datastore API in pages of 400 rows. A page ends at a reference boundary, thus no record holds only some of its rows.
- One item message holds up to 10 items: 10 Jev requests, up to 10 detail pages and up to 10 Workers AI requests. Only the failed items go back on the queue.
- The views do the filters, the sort, the counts and the paging in D1 SQL over the stored answers (`json_extract`). The Worker parses only the 50 rows on the page. The ranking policy is in `src/rank.ts`.
- Queue budget: 10,000 operations each day. A full new tag of all items uses about 700.
- D1 read budget: 5 million rows each day. The 12-month backfill on 2026-09-24 went above it, because each item message read all rows. Each query must use an index:
  - The New tab and the date filters use the `items_day` index. The Acting and Done tabs read the `triage` table first.
  - Write `+kind` in a filter, so that SQLite does not use the kind index. That index reads all items of one kind.
  - Check a new query with `EXPLAIN QUERY PLAN`, and after deploy with `wrangler d1 insights trashboard --sort-by=reads`.
- Measured locally in Bun (warm): the largest parse is the WA page at 5.5 ms. It is 17.5 ms on a cold start. Check the real CPU time in Workers Logs after deploy. If it is too high, split the WA page into one message for each table.

## Inbox

- One list for both kinds of item. Items that name JJ Richards are first, then the highest priority. The ranking policy is in `src/rank.ts`.
- Regulatory items pass the relevance gate. Enforcement records pass when the company is a waste operator, and the record names a known group or the conduct is serious (`IN_INBOX_SQL`).
- The enforcement priority is severity times the risk that the conduct can happen in own operations. It is not calibrated yet.
- The New tab shows the last 90 days when the user sets no period. The Acting and Done tabs show all dates, thus open work does not go away.
- `?view=report` shows the same filters as a report. With no period, the report is for the current quarter. Dismissed items are not in the report.
- The `triage` table holds the labels that measure the priority: Act and Done mean useful, Dismiss means not useful. Get at least 20 labels in each band before you change a weight or a threshold.

## Dates, company tags and labels

- Code finds each date in the text of a regulatory item. Jev selects the date when submissions close and the date when the rule starts to apply, as for penalties. A stored date is always a date that the source states.
- A regulatory item names a company group when a group name is in its title. JJ Richards counts in the body too.
- Code sets the group each time it stores the text of an item. After a change to a pattern in `src/parties.ts`, increase `PARTIES_VERSION`. The daily run then sets the group again for each item, with no new tags. An item that names JJ Richards passes the relevance gate and is first in the list.
- Consultation sites give the close date as free text. The body starts with that text, thus Jev selects the close date as for other items. A date with no year ("9 May") gets its year from the publication date.
- A check of the past 12 months found about 19 relevant consultations on NSW EPA Your Say and Engage Victoria, and about 12 on the DCCEEW and WA DWER sites. About 15 of the NSW and VIC ones had no news release in the news sources.
- Consultation sites that were checked and not added: QLD Have Your Say and DETSI (free-text dates, a Cloudflare challenge, about 1 relevant item each year), SA YourSAy (dates only on each project page, about 2 relevant items each year), NHVR (about 2 each year).
- The DCCEEW and WA DWER sites give the dates as fields. The source writes them in words in the body, thus the same date step reads all consultation sites.
- `wasteFocus` rates a rule for all vehicles as general. The `fleetRule` question finds the vehicle rules that apply to the trucks and drivers of the company. An item with `fleetRule` at 0.6 or more passes the relevance gate, and its relevance for the priority is the larger of the waste relevance and `fleetRule`.
- A local run on 2026-09-24 (tag version 4): 33 items in the last 12 months passed the gate because of `fleetRule`, 5 of them High. The 20 NHVR route map notices and the permits for road trains, cranes and livestock carriers stayed hidden. About 9 of the 33 were not useful, for example Port of Brisbane mass permits and road closures.
- A check on 2026-09-24 found 13 dates in the next 90 days, from NSW, VIC and the Commonwealth.
- At 2026-09-24, the live site had 206 relevant items in the last 12 months: 51 High, 67 Medium and 88 Low. Of the 51 High items, 23 were regulator news about enforcement against other companies.

## Sources that were checked and not added

- NSW EPA POEO register of notices and licences: the data is frozen at 28 April 2026 while the EPA moves to a new register. Check again when the new register is live.
- NHVR enforceable undertakings: the NHVR copyright terms do not permit storage in a retrieval system without written permission.
- NHVR court outcomes: the defendants are not named.
- WorkSafe Queensland: a Cloudflare challenge blocks all requests without a browser.
- NSW Land and Environment Court judgments: the Open Australian Legal Corpus stops at September 2024, and the NSW Caselaw robots.txt blocks bots. The NSW EPA prosecutions register gives the LEC fines.
- WA DWER licences: HTML only, results stop at 20, and no JJ Richards licences.

## Known limitations

- A company record can name a person in its text, for example a director in a VIC court summary. The party filter does not remove these names.
- The party filter uses rules of thumb for names that have "&" in them. When a rule is wrong, it drops a company. It does not keep a person.
- The QLD register has no description of the conduct. Many QLD records show the conduct as "Not stated".
- The Search view shows up to 30 candidates from full-text search. A relevant item that has none of the query words is not found.
- The VIC search endpoints are not documented APIs, and they can change without notice. The schema check fails loudly if they change.
- The NSW EPA prosecutions call uses a Salesforce class ID that can change when the EPA changes the site. The schema check then fails loudly.
- WHS summaries (WorkSafe Victoria, SafeWork NSW) can name injured workers. The party filter does not remove these names.
- The licence sources show changes for JJ Richards only. They do not show changes for competitors.

## Before deploy

- Create the D1 database `trashboard` and the queues `trashboard-ingest` and `trashboard-items`, then put the database ID in `wrangler.jsonc`.
- Apply the migrations: `npm run db:migrate:remote`. The live database has data, thus a schema change is a new migration file. `npm run db:reset:remote` deletes all tables and data.
- After the deploy, click "Tag and summarise waiting items" on the Sources page. Tag version 4 changes the questions, thus the views are empty until the items have new tags.
- Set the secrets: `TYPESAFE_API_KEY`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`.

## Next (v2 and later)

- Case law text: NSW Land and Environment Court judgments from the Open Australian Legal Corpus (Hugging Face, `isaacus/open-australian-legal-corpus`), as a one-time backfill to September 2024. Do not use AustLII, because its terms do not permit bots or AI.
- NSW EPA penalty notices, from the new register when it is live.
- More sources: WA legislation feeds (slow server), QLD and NSW Government Gazettes (PDF), DCCEEW news, NSW Have Your Say, QLD ministerial statements.
- Email digest. The digest is a query over tagged items and tracked items, thus the send step is the only new part.
- Council contract expiry map from council meeting minutes and tender portals.
- Paid sources that the user possibly has already, for example TenderLink.
- Upload of own documents (licence conditions, contracts), with redaction in the browser (Desert Ant Redact). Only after JJR IT approves.
- Names of persons in record text: remove them before storage, for example with Desert Ant Redact or a Jev check.
- Records for persons, if the user and JJR agree that this is correct.
