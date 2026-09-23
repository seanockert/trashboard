import { z } from 'zod';

// Secrets are not in wrangler.jsonc, thus `wrangler types` does not know them.
const Secrets = z.object({
  TYPESAFE_API_KEY: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
});

export type Secrets = z.infer<typeof Secrets>;

export const readSecrets = (env: unknown): Secrets => {
  const parsed = Secrets.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing or invalid secrets: ${missing}. Set them with \`wrangler secret put\` or in .dev.vars.`);
  }
  return parsed.data;
};
