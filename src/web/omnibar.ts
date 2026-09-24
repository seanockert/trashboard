// The omni-bar holds filter tokens and free text in one string, for example
// "period:30d jurisdiction:QLD topic:levy stormwater". The server parses the string,
// thus a user can type a query and press Enter without the script.

export type OmniOption<V> = { token: string; label: string; value: V };
export type OmniField<V> = { key: string; label: string; options: readonly OmniOption<V>[] };

export const omniField = <V extends string | number>(key: string, label: string, options: readonly OmniOption<V>[]): OmniField<V> => ({ key, label, options });

type Fields = Record<string, OmniField<string | number>>;
export type Picked<F extends Fields> = { [P in keyof F]?: F[P]['options'][number]['value'] | undefined };
export type OmniQuery<F extends Fields> = { picked: Picked<F>; text: string; invalid: string[] };

const TOKEN = /^([a-z]+):(.*)$/i;

// A token with a known key and value sets that filter. A later token for the same key wins.
// A token with an unknown key or value goes into `invalid`, thus the page can tell the user.
export const parseOmni = <F extends Fields>(fields: F, q: string): OmniQuery<F> => {
  const picked: Record<string, string | number> = {};
  const text: string[] = [];
  const invalid: string[] = [];
  for (const word of q.trim().split(/\s+/).filter((w) => w !== '')) {
    const match = TOKEN.exec(word);
    if (match === null) {
      text.push(word);
      continue;
    }
    const [, key = '', token = ''] = match;
    const entry = Object.entries(fields).find(([, field]) => field.key === key.toLowerCase());
    const option = entry?.[1].options.find((o) => o.token.toLowerCase() === token.toLowerCase());
    if (entry === undefined || option === undefined) invalid.push(word);
    else picked[entry[0]] = option.value;
  }
  // The keys and values come from `fields`, thus `picked` has the shape of Picked<F>.
  return { picked: picked as Picked<F>, text: text.join(' '), invalid };
};

// The tokens in the order of `fields`, then the invalid tokens, then the free text.
export const formatOmni = <F extends Fields>(fields: F, { picked, text, invalid }: OmniQuery<F>) =>
  [
    ...Object.entries(fields).flatMap(([prop, field]) => {
      const option = field.options.find((o) => o.value === picked[prop]);
      return option === undefined ? [] : [`${field.key}:${option.token}`];
    }),
    ...invalid,
    text,
  ]
    .filter((part) => part !== '')
    .join(' ');

// The data that the browser script needs for the suggestions.
export const omniSpec = (fields: Fields) =>
  Object.values(fields).map((field) => ({ key: field.key, label: field.label, options: field.options.map(({ token, label }) => ({ token, label })) }));
