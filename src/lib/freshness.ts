// Which data in the device copy is newest, while reads from the server are running.
//
// A full refresh reads the server for a few seconds. A live update (or a write's own
// answer) that lands in the device copy meanwhile is NEWER than what the refresh read,
// and must not be overwritten by it, nor must a row deleted meanwhile come back. So
// every read takes a ticket when it starts, and every write records the ticket of the
// data it wrote. A write is skipped for a row that already holds data from a later
// ticket. Nothing is recorded when no read is running, so this stays tiny.

let seq = 0;
const running = new Set<number>();
/** `${table}:${id}` -> ticket of the data the device copy holds (only while reads run). */
const holds = new Map<string, number>();

const key = (table: string, id: string) => `${table}:${id}`;

/** A ticket for data that is as fresh as it gets right now (a live update, a write's answer). */
export const freshTicket = (): number => ++seq;

/** Starts a server read; its data carries this ticket. Call endRead when done. */
export const beginRead = (): number => {
  const ticket = ++seq;
  running.add(ticket);
  return ticket;
};

export const endRead = (ticket: number): void => {
  running.delete(ticket);
  if (!running.size) {
    holds.clear();
    return;
  }
  // An entry no running read could lose to is not needed any more.
  const oldest = Math.min(...running);
  for (const [k, t] of holds) if (t <= oldest) holds.delete(k);
};

/** False when the device copy already holds newer data for this row than `ticket`. */
export const mayWrite = (table: string, id: string, ticket: number): boolean =>
  (holds.get(key(table, id)) ?? 0) <= ticket;

/** Records that these rows now hold data of `ticket` (or were removed by it). */
export const recordWrite = (table: string, ids: string[], ticket: number): void => {
  if (!running.size) return;
  for (const id of ids) {
    const k = key(table, String(id));
    if ((holds.get(k) ?? 0) < ticket) holds.set(k, ticket);
  }
};
