// Test-time helper: mirrors what the app says and does to web/lab-log.jsonl on the laptop running
// the dev/preview server (the /__lablog endpoint in vite.config.ts). On any other server the
// endpoint doesn't exist and lines are silently dropped.

/** Mirror the log to web/lab-log.jsonl on the laptop (dev server / preview). Lines that can't be
 *  sent (phone offline, e.g. the airplane-mode test) are kept and sent when the connection is back. */
const unsent: string[] = [];
let sending = false;
let disabled = false; // no log endpoint on this server (real deployment): stop trying
async function flushToLaptop() {
  if (sending || disabled) return;
  sending = true;
  try {
    while (unsent.length) {
      const r = await fetch("/__lablog", { method: "POST", body: unsent[0] });
      if (r.status === 404) { disabled = true; unsent.length = 0; break; }
      if (!r.ok) break;
      unsent.shift();
    }
  } catch { /* offline: try again later */ }
  sending = false;
}
let retryTimer: ReturnType<typeof setInterval> | null = null;
export function sendToLaptop(line: { at: string; kind: string; text: string }) {
  if (disabled) return;
  unsent.push(JSON.stringify(line));
  if (unsent.length > 2000) unsent.shift();
  retryTimer ??= setInterval(() => void flushToLaptop(), 2000); // only once something is logged
  void flushToLaptop();
}
