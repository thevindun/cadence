from datetime import datetime, timezone

import main


def test_next_occurrence_weekly_skips_past():
    now = datetime(2026, 8, 15, tzinfo=timezone.utc)
    nxt = main._next_occurrence("2026-08-01T09:00:00Z", "weekly", now)
    assert nxt > now
    assert nxt.weekday() == datetime(2026, 8, 1, tzinfo=timezone.utc).weekday()


def test_next_occurrence_monthly_clamps_month_end():
    now = datetime(2026, 1, 31, 12, tzinfo=timezone.utc)
    nxt = main._next_occurrence("2026-01-31T09:00:00Z", "monthly", now)
    assert (nxt.month, nxt.day) == (2, 28)        # Feb has no 31st


def test_none_returns_nothing():
    now = datetime(2026, 8, 15, tzinfo=timezone.utc)
    assert main._next_occurrence("2026-08-01T09:00:00Z", "none", now) is None