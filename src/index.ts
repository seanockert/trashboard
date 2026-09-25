import { app } from './web/app';
import { z } from 'zod';
import { handleItemQueueMessage, IngestMessage, ingestPage, ItemQueueMessage, updateAll } from './pipeline';

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
  schema: z.ZodType<T>;
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
    ctx.waitUntil(updateAll(env));
  },

  async queue(batch, env) {
    await Promise.all(
      batch.messages.map((message) => {
        if (batch.queue === INGEST_QUEUE) return handle({ message, queue: batch.queue, schema: IngestMessage, run: async (body) => void (await ingestPage({ env, ...body })) });
        if (batch.queue === ITEM_QUEUE) return handle({ message, queue: batch.queue, schema: ItemQueueMessage, run: (body) => handleItemQueueMessage({ env, message: body }) });
        console.error(JSON.stringify({ event: 'unknown_queue', queue: batch.queue }));
        message.ack();
        return Promise.resolve();
      }),
    );
  },
} satisfies ExportedHandler<Env>;
