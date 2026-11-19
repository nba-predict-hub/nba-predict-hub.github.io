#!/usr/bin/env python3
"""把 /workspace/nba_model/out/live_ledger_v9.csv 同步成网站 v9_ledger.json。
文件不存在或读失败时写空账本，不报错、不编造数据。
"""
from __future__ import annotations
import csv, json, os, sys
from datetime import datetime, timedelta, timezone

PT = timezone(timedelta(hours=-8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("V9_LEDGER") or "/workspace/nba_model/out/live_ledger_v9.csv"
OUT = os.environ.get("V9_OUT") or os.path.join(ROOT, "v9_ledger.json")

sys.path.insert(0, "/workspace/nba_model")
try:
    from teams import ABBR_TO_CN
except Exception:
    ABBR_TO_CN = {}
ESPN_ABBR = {"GS": "GSW", "SA": "SAS", "NO": "NOP", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS"}

COLS = {
    "lock_time": ["lock_time", "locked_at", "lock_at", "time"],
    "game": ["game", "matchup", "match", "contest"],
    "away": ["away", "away_team", "away_abbr"],
    "home": ["home", "home_team", "home_abbr"],
    "direction": ["pick", "direction", "side", "pick_team", "pick_cn"],
    "line": ["line", "spread", "pick_line", "line_home"],
    "confidence": ["confidence", "band_cn", "band", "conf"],
    "result": ["result", "hit", "correct", "res", "grade"],
    "espn_id": ["espn_id", "game_id", "event_id"],
    "game_date": ["game_date", "date"],
}
BAND = {"high": "高", "mid": "中", "low": "低", "h": "高", "m": "中", "l": "低"}


def now_pt():
    return datetime.now(PT).strftime("%Y-%m-%d %H:%M:%S PT")


def mtime_pt(path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), PT).strftime("%Y-%m-%d %H:%M:%S PT")
    except OSError:
        return None


def empty(exists=False, src_upd=None, note=""):
    return {
        "generated_at": now_pt(),
        "source": "nba_model/out/live_ledger_v9.csv",
        "source_updated": src_upd,
        "exists": exists,
        "note": note,
        "rows": [],
        "record": {"w": 0, "l": 0, "p": 0, "n": 0, "pct": None, "max_lose_streak": 0},
    }


def team(v):
    t = (v or "").strip()
    if not t:
        return ""
    u = ESPN_ABBR.get(t.upper(), t.upper()) if t.isalpha() and len(t) <= 4 else t
    return ABBR_TO_CN.get(u, t)


def as_pt(s):
    s = (s or "").strip()
    if not s:
        return ""
    if s.endswith(" PT") or s.endswith("PT"):
        return s if s.endswith(" PT") else s[:-2] + " PT"
    for fmt, tz in (
        ("%Y-%m-%dT%H:%M:%SZ", timezone.utc),
        ("%Y-%m-%dT%H:%M:%S.%fZ", timezone.utc),
        ("%Y-%m-%dT%H:%M:%S%z", None),
        ("%Y-%m-%d %H:%M:%S", PT),
        ("%Y-%m-%d %H:%M", PT),
        ("%Y-%m-%dT%H:%M:%S", PT),
    ):
        try:
            raw = s
            if fmt.endswith("%z"):
                raw = s.replace("Z", "+0000").replace("+00:00", "+0000")
            dt = datetime.strptime(raw[:26] if "%f" in fmt else raw[:19] if "T" in fmt or " " in fmt else raw, fmt)
            if tz and dt.tzinfo is None:
                dt = dt.replace(tzinfo=tz)
            elif dt.tzinfo is None:
                dt = dt.replace(tzinfo=PT)
            return dt.astimezone(PT).strftime("%Y-%m-%d %H:%M:%S PT")
        except Exception:
            continue
    return s if "PT" in s else (s + " PT")


def conf_of(v):
    t = (v or "").strip()
    if not t:
        return ""
    return BAND.get(t.lower(), t)


def result_of(v):
    t = (v or "").strip()
    if t == "":
        return "", "待定"
    u = t.upper()
    if u in ("W", "WIN", "WON", "TRUE", "1", "HIT", "CORRECT", "Y", "对"):
        return "W", "对"
    if u in ("L", "LOSS", "LOSE", "LOST", "FALSE", "0", "MISS", "WRONG", "N", "错"):
        return "L", "错"
    if u in ("P", "PUSH", "TIE", "走"):
        return "P", "走"
    return "", "缺"


def pick(low, names):
    for a in names:
        if low.get(a) not in (None, ""):
            return low[a]
    return ""


def write(obj):
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, OUT)


def main():
    src_rel = "nba_model/out/live_ledger_v9.csv"
    if not os.path.exists(SRC):
        write(empty(False, None, "账本文件尚不存在"))
        return 0
    src_upd = mtime_pt(SRC)
    try:
        if os.path.getsize(SRC) == 0:
            write(empty(True, src_upd, "账本文件为空"))
            return 0
        with open(SRC, newline="", encoding="utf-8-sig") as f:
            rows_in = list(csv.DictReader(f))
    except Exception as ex:
        print("v9 账本读取失败（写空数据）：", ex, file=sys.stderr)
        write(empty(True, src_upd, "读取失败"))
        return 0

    out_rows = []
    for r in rows_in:
        low = {(k or "").strip().lower(): (v if v is None else str(v).strip()) for k, v in r.items()}
        x = {k: pick(low, alts) for k, alts in COLS.items()}
        away, home = team(x["away"]), team(x["home"])
        game = x["game"] or ((" @ ".join([p for p in (away, home) if p])) if (away or home) else "")
        direction = team(x["direction"]) if x["direction"] else ""
        code, cn = result_of(x["result"])
        out_rows.append({
            "lock_time": x["lock_time"] or "",
            "lock_time_pt": as_pt(x["lock_time"]) if x["lock_time"] else "",
            "game_date": x["game_date"] or "",
            "espn_id": x["espn_id"] or "",
            "game": game,
            "away": x["away"] or "",
            "home": x["home"] or "",
            "away_cn": away,
            "home_cn": home,
            "direction": direction,
            "line": x["line"] or "",
            "confidence": conf_of(x["confidence"]),
            "result": code,
            "result_cn": cn,
        })

    def key(r):
        return r.get("lock_time_pt") or r.get("lock_time") or r.get("game_date") or ""

    graded = []
    chrono = sorted(out_rows, key=key)
    streak = best = 0
    for r in chrono:
        if r["result"] == "L":
            streak += 1
            best = max(best, streak)
        elif r["result"] in ("W", "P"):
            streak = 0
        if r["result"] in ("W", "L", "P"):
            graded.append(r)
    w = sum(1 for r in graded if r["result"] == "W")
    l = sum(1 for r in graded if r["result"] == "L")
    p_ = sum(1 for r in graded if r["result"] == "P")
    n = w + l
    out_rows.sort(key=key, reverse=True)
    write({
        "generated_at": now_pt(),
        "source": src_rel,
        "source_updated": src_upd,
        "exists": True,
        "note": "",
        "rows": out_rows,
        "record": {"w": w, "l": l, "p": p_, "n": n, "pct": (round(100 * w / n, 1) if n else None), "max_lose_streak": best},
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:
        print("v9 同步失败（写空数据）：", ex, file=sys.stderr)
        try:
            write(empty(False, None, "同步失败"))
        except Exception:
            pass
        sys.exit(0)
