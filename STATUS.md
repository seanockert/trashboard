# Status

Trashboard is a private dashboard for the in-house legal counsel at JJ Richards & Sons.
It collects public Australian regulatory and enforcement data every day.
Jev (TypeSafe) tags each item one time, when it arrives.
Code does the filters, the ranking, the dates and the company matches.

## Rules for v1

- Use only free, public data sources.
- Do not keep personal information. Keep enforcement records for companies only.
- Do not upload documents from JJ Richards.
- One user. A single password protects the dashboard.

## v1 scope

| Part | State |
| --- | --- |
| Project setup (TypeScript, Hono, Wrangler, D1, R2, Queues, Cron) | Done |
| 11 sources (7 regulatory, 4 enforcement) | Done, tested live |
| Regulatory changes view | Done |
| Enforcement view (JJR and competitors) | Done |
| Search (D1 full-text search, then Jev rerank) | Done |
| Password login | Done |
| Unit tests (parsers, company filter, dates, penalty selection) | Done, 56 tests |
| Fit the Workers Free plan (10 ms CPU, 50 subrequests for each invocation) | Done locally. Check real CPU time after deploy |
| Deploy to Cloudflare (`trashboard.seanockert.workers.dev`) | Not started |
| Labelled test set (about 100 items) to measure tag accuracy | Not started. Needs labels from the user |

## Sources

| Source | Kind | Access | Notes |
| --- | --- | --- | --- |
| Federal Register of Legislation | Regulatory | OData API | New titles with the administering department |
| QLD legislation | Regulatory | Atom feeds | New Acts, subordinate legislation and bills. Law text from the "whole" view |
| NSW legislation | Regulatory | Atom feeds | Title only. The site blocks automated text requests |
| VIC legislation | Regulatory | Site search endpoint | Not a documented API |
| TAS legislation | Regulatory | Atom feed | Law text from the "whole" view |
| NSW EPA news | Regulatory | HTML | Article text from each page |
| EPA Victoria news | Regulatory | Site search endpoint | Not a documented API |
| QLD enforcement register | Enforcement | CKAN datastore API | No description of the conduct. Code reads the ERA codes |
| EPA Victoria court proceedings | Enforcement | JSON endpoint | Full summary from each page |
| WA DWER enforcement | Enforcement | HTML tables | Notices, penalty notices, prosecutions |
| SA EPA prosecutions | Enforcement | HTML table | Needs a browser-like user agent |

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

## Workers Free plan design

- One ingest message is one page of one source. A page sends the next page as a new message. The cursor moves only after the last page.
- QLD uses the CKAN datastore API in pages of 400 rows. A page ends at a reference boundary, thus no record holds only some of its rows.
- One item message holds up to 10 items: 10 Jev requests and up to 10 detail pages. Only the failed items go back on the queue.
- The views do the filters, the sort, the counts and the paging in D1 SQL over the stored answers (`json_extract`). The Worker parses only the 50 rows on the page. The ranking policy is in `src/rank.ts`.
- Queue budget: 10,000 operations each day. A full new tag of all items uses about 700.
- Measured locally in Bun (warm): the largest parse is the WA page at 5.5 ms. It is 17.5 ms on a cold start. Check the real CPU time in Workers Logs after deploy. If it is too high, split the WA page into one message for each table.

## Known limitations

- A company record can name a person in its text, for example a director in a VIC court summary. The party filter does not remove these names.
- The party filter uses rules of thumb for names that have "&" in them. When a rule is wrong, it drops a company. It does not keep a person.
- The QLD register has no description of the conduct. Many QLD records show the conduct as "Not stated".
- The Search view shows up to 30 candidates from full-text search. A relevant item that has none of the query words is not found.
- The VIC search endpoints are not documented APIs, and they can change without notice. The schema check fails loudly if they change.

## Before deploy

- Create the D1 database `trashboard`, the R2 bucket `trashboard-raw` and the queues `trashboard-ingest` and `trashboard-items`, then put the database ID in `wrangler.jsonc`.
- Set the secrets: `TYPESAFE_API_KEY`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`.
- Test the SA EPA source from Cloudflare. CloudFront can block Cloudflare egress addresses.

## Next (v2 and later)

- Case law: NSW Land and Environment Court judgments from the Open Australian Legal Corpus (Hugging Face, `isaacus/open-australian-legal-corpus`). Do not use AustLII, because its terms do not permit bots or AI.
- NSW EPA penalty notices and prosecutions. The register needs ASP.NET form posts. Search only for the names of JJR and its competitors.
- More sources: WA legislation feeds (slow server), QLD and NSW Government Gazettes (PDF), DCCEEW news, NSW Have Your Say, QLD ministerial statements.
- Email digest. The digest is a query over tagged items, thus the send step is the only new part.
- Council contract expiry map from council meeting minutes and tender portals.
- Paid sources that the user possibly has already, for example TenderLink.
- Upload of own documents (licence conditions, contracts), with redaction in the browser (Desert Ant Redact). Only after JJR IT approves.
- Names of persons in record text: remove them before storage, for example with Desert Ant Redact or a Jev check.
- Records for persons, if the user and JJR agree that this is correct.
