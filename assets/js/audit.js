/* Tamper-evident audit log: every entry stores the SHA-256 of (its own body + the previous hash).
 * Editing or deleting any past entry breaks every hash after it, which verify() detects.
 * In production this chain would be written to an append-only store per node, and its head hash
 * periodically anchored somewhere the node operator cannot rewrite (a peer node, a notary, or a ledger).
 */
import { sha256Hex } from "./util.js";

export const entries = [];
let last = "0".repeat(64);
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const enc = (o) => new TextEncoder().encode(JSON.stringify(o)).buffer;

let queue = Promise.resolve();
/** Appends are serialised: each entry must see the previous entry's hash, even if callers fire concurrently. */
export function record(e) {
  queue = queue.then(async () => {
    const body = { seq: entries.length + 1, ts: new Date().toISOString(), ...e, prev: last };
    const hash = await sha256Hex(enc(body));
    entries.push({ ...body, hash });
    last = hash;
    listeners.forEach((f) => f());
  }).catch((err) => console.error("audit failure", err));
  return queue;
}

export async function verify() {
  let prev = "0".repeat(64);
  for (const e of entries) {
    const { hash, ...body } = e;
    if (body.prev !== prev) return { ok: false, brokenAt: e.seq, why: "previous-hash link does not match" };
    const h = await sha256Hex(enc(body));
    if (h !== hash) return { ok: false, brokenAt: e.seq, why: "entry content does not match its hash" };
    prev = hash;
  }
  return { ok: true, count: entries.length };
}
