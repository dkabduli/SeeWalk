"""Per-phone request limits for the public (Vercel) deployment.

A public link spends our Gemini and ElevenLabs credit if strangers find it. One phone walking uses
about 75 snapshots a minute (one every 0.8 s) plus a few questions, so these limits never touch a
real walk but stop a script from hammering the keys. Counts live in memory, so each server copy
counts on its own: on Vercel requests spread across copies, and the Vercel Firewall rule (see
api/index.py) is the limit that holds; this is the backstop, and the limit on a single server.
"""
import time
from collections import defaultdict, deque

# requests per minute per phone (IP address), by endpoint
LIMITS = {"analyze": 150, "listen": 40, "tts": 90, "other": 120}
WINDOW_S = 60.0


def bucket(path: str) -> str:
    for name in ("analyze", "listen", "tts"):
        if path.rstrip("/").endswith("/" + name):
            return name
    return "other"


class RateLimiter:
    def __init__(self, limits: dict[str, int] = LIMITS, window_s: float = WINDOW_S):
        self.limits = limits
        self.window_s = window_s
        self.seen: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def allow(self, client: str, path: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        name = bucket(path)
        times = self.seen[(client, name)]
        while times and now - times[0] >= self.window_s:
            times.popleft()
        if len(times) >= self.limits[name]:
            return False
        times.append(now)
        if len(self.seen) > 5000:  # forget idle phones so memory stays small
            for key in [k for k, v in self.seen.items() if not v or now - v[-1] >= self.window_s]:
                del self.seen[key]
        return True
