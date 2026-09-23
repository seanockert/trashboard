import { app } from './web/app';
import { z } from 'zod';
import { handleItemMessage, handleSummaryMessage, IngestMessage, ingestPage, ItemMessage, retagStale, scheduleAll, summariseStale, SummaryMessage } from './pipeline';

// The daily run also sends items that have no current tags, for example
// after a failed batch or a question change.
const RETAG_LIMIT = 2000;

// About 6 neurons each, thus about 3,600 of the 10,000 free neurons each day.
// New items get a summary when they get tags. This limit is for older items.
const SUMMARY_LIMIT = 600;

const INGEST_QUEUE = 'trashboard-ingest';
const ITEM_QUEUE = 'trashboard-items';

const handle = async <T>({
  message,
  queue,
  schema,
  run,
}: {
  message: Message;
  queue: string;
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } };
  run: (body: T) => Promise<void>;
}) => {
  const parsed = schema.safeParse(message.body);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: 'bad_message', queue, body: message.body }));
    message.ack();
    return;
  }
  await run(parsed.data).then(
    () => message.ack(),
    (error: unknown) => {
      console.error(JSON.stringify({ event: 'message_crashed', queue, error: String(error) }));
      message.retry({ delaySeconds: 60 });
    },
  );
};

export default {
  fetch: app.fetch,

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([scheduleAll(env), retagStale({ env, limit: RETAG_LIMIT, minAgeHours: 6 }), summariseStale({ env, limit: SUMMARY_LIMIT })]));
  },

  async queue(batch, env) {
    await Promise.all(
      batch.messages.map((message) => {
        if (batch.queue === INGEST_QUEUE) return handle({ message, queue: batch.queue, schema: IngestMessage, run: (body) => ingestPage({ env, ...body }) });
        if (batch.queue === ITEM_QUEUE)
          return handle({
            message,
            queue: batch.queue,
            schema: z.union([ItemMessage, SummaryMessage]),
            run: (body) => ('summariseIds' in body ? handleSummaryMessage({ env, message: body }) : handleItemMessage({ env, message: body })),
          });
        console.error(JSON.stringify({ event: 'unknown_queue', queue: batch.queue }));
        message.ack();
        return Promise.resolve();
      }),
    );
  },
} satisfies ExportedHandler<Env>;
