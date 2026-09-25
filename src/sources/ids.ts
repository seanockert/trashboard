export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// Duplicate rows get "-2", "-3" in page order.
export const withUniqueIds = <T extends { externalId: string }>(records: T[]) => {
  const counts = new Map<string, number>();
  return records.map((record) => {
    const count = (counts.get(record.externalId) ?? 0) + 1;
    counts.set(record.externalId, count);
    return count === 1 ? record : { ...record, externalId: `${record.externalId}-${count}` };
  });
};
