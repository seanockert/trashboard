// For pages that give no record IDs. The ID comes from fields that do not change.
export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// Two rows can have the same fields, for example two charges on one day.
// The second gets "-2", the third "-3", in page order.
export const withUniqueIds = <T extends { externalId: string }>(records: T[]) =>
  records.map((record, i) => {
    const earlier = records.slice(0, i).filter((r) => r.externalId === record.externalId).length;
    return earlier === 0 ? record : { ...record, externalId: `${record.externalId}-${earlier + 1}` };
  });
