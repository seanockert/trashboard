import { ResultAsync, errAsync, okAsync, Result } from 'neverthrow';
import type { SourceError } from './types';

const USER_AGENT = 'Trashboard/0.1 (private research tool; one request per source per day)';

// CloudFront sites refuse requests without a browser user agent.
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (compatible; Trashboard/0.1)';

type Headers = Record<string, string>;

const request = ({ url, method = 'GET', body, headers }: { url: string; method?: 'GET' | 'POST'; body?: string; headers: Headers }) =>
  ResultAsync.fromPromise(
    fetch(url, { method, body: body ?? null, headers: { 'user-agent': USER_AGENT, ...headers } }).then(async (res) => ({ status: res.status, text: await res.text() })),
    (cause): SourceError => ({ type: 'network', url, cause }),
  ).andThen((res) => (res.status >= 200 && res.status < 300 ? okAsync(res) : errAsync<typeof res, SourceError>({ type: 'http', url, status: res.status })));

const withJson =
  (url: string) =>
  <T extends { text: string }>(res: T) =>
    Result.fromThrowable(
      (): unknown => JSON.parse(res.text),
      (): SourceError => ({ type: 'parse', url, message: 'The response is not valid JSON.' }),
    )().map((json) => ({ ...res, json }));

export const getText = ({ url, headers = {} }: { url: string; headers?: Headers }) => request({ url, headers });

export const getJson = ({ url, headers = {} }: { url: string; headers?: Headers }) =>
  request({ url, headers: { accept: 'application/json', ...headers } }).andThen(withJson(url));

export const postJson = ({ url, body, headers = {} }: { url: string; body: unknown; headers?: Headers }) =>
  request({ url, method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json', ...headers } }).andThen(withJson(url));
