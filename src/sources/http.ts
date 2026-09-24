import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { SourceError } from './types';

const USER_AGENT = 'Trashboard/0.1 (private research tool; one request per source per day)';

export type HttpResponse = { status: number; text: string; headers: Headers };

export const getText = ({ url, headers = {} }: { url: string; headers?: Record<string, string> }) =>
  ResultAsync.fromPromise(
    fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers } }).then(async (res) => ({
      status: res.status,
      text: res.status === 304 ? '' : await res.text(),
      headers: res.headers,
    })),
    (cause): SourceError => ({ type: 'network', url, cause }),
  ).andThen((res): ResultAsync<HttpResponse, SourceError> =>
    res.status === 304 || (res.status >= 200 && res.status < 300) ? okAsync(res) : errAsync({ type: 'http', url, status: res.status }),
  );

export const getJson = ({ url, headers = {} }: { url: string; headers?: Record<string, string> }) =>
  getText({ url, headers: { accept: 'application/json', ...headers } }).andThen((res) =>
    ResultAsync.fromPromise(
      Promise.resolve().then((): unknown => JSON.parse(res.text)),
      (): SourceError => ({ type: 'parse', url, message: 'The response is not valid JSON.' }),
    ).map((json) => ({ ...res, json })),
  );

export const getBytes = ({ url, headers = {} }: { url: string; headers?: Record<string, string> }) =>
  ResultAsync.fromPromise(
    fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers } }).then(async (res) => ({
      status: res.status,
      bytes: new Uint8Array(await res.arrayBuffer()),
    })),
    (cause): SourceError => ({ type: 'network', url, cause }),
  ).andThen((res) => (res.status >= 200 && res.status < 300 ? okAsync(res.bytes) : errAsync<Uint8Array, SourceError>({ type: 'http', url, status: res.status })));

export const postJson = ({ url, body, headers = {} }: { url: string; body: unknown; headers?: Record<string, string> }) =>
  ResultAsync.fromPromise(
    fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json', accept: 'application/json', ...headers } }).then(
      async (res) => ({ status: res.status, text: await res.text() }),
    ),
    (cause): SourceError => ({ type: 'network', url, cause }),
  )
    .andThen((res) => (res.status >= 200 && res.status < 300 ? okAsync(res) : errAsync<{ status: number; text: string }, SourceError>({ type: 'http', url, status: res.status })))
    .andThen((res) =>
      ResultAsync.fromPromise(
        Promise.resolve().then((): unknown => JSON.parse(res.text)),
        (): SourceError => ({ type: 'parse', url, message: 'The response is not valid JSON.' }),
      ).map((json) => ({ text: res.text, json })),
    );
