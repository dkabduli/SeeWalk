"""The public deployment's per-phone limits (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ratelimit import RateLimiter, bucket  # noqa: E402


def test_a_real_walk_is_never_limited():
    rl = RateLimiter()
    # 10 minutes of walking: a snapshot every 0.8 s, two at once, plus a question every 20 s
    t, ok = 0.0, True
    while t < 600:
        ok &= rl.allow("phone", "/api/analyze", t)
        if int(t * 10) % 200 == 0:
            ok &= rl.allow("phone", "/api/listen", t) and rl.allow("phone", "/api/tts", t)
        t += 0.8
    assert ok


def test_a_script_hammering_the_keys_is_stopped_then_let_back_in():
    rl = RateLimiter()
    allowed = sum(rl.allow("bot", "/api/analyze", 0.001 * i) for i in range(1000))
    assert allowed == 150                        # the rest of that minute is refused
    assert rl.allow("bot", "/api/analyze", 61)   # a minute later it works again


def test_each_phone_and_endpoint_counts_separately():
    rl = RateLimiter({"analyze": 2, "listen": 1, "tts": 1, "other": 1})
    assert rl.allow("a", "/api/analyze", 0) and rl.allow("a", "/api/analyze", 0)
    assert not rl.allow("a", "/api/analyze", 0)
    assert rl.allow("b", "/api/analyze", 0)      # another phone
    assert rl.allow("a", "/api/listen", 0)       # another endpoint


def test_bucket_names():
    assert bucket("/api/analyze") == "analyze"
    assert bucket("/api/listen/") == "listen"
    assert bucket("/api/tts") == "tts"
    assert bucket("/api/hazards") == "other"
