#!/usr/bin/env python3
"""赛前盘口汇总（只读同事已有的真实数据，不抓新数据、不改模型输出）
输入：/workspace/nba_model/monitor/lines.json（ESPN/DraftKings、Pinnacle 等）、monitor/crown.json（皇冠，浏览器读的）
输出：pre_odds.json  {updated_pt, lines_updated_pt, crown_read_at, games:{espn_id:{books:[...], med_line_home, med_total, n}}, crown:[...原样]}
"""
import json, os, statistics, datetime
M = "/workspace/nba_model/monitor"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pre_odds.json")
NAME = {"draftkings": "DraftKings", "pinnacle": "Pinnacle", "fanduel": "FanDuel", "caesars": "Caesars", "espnbet": "ESPN BET", "betmgm": "BetMGM"}


def book_of(src):
    s = src.lower()
    for k in NAME:
        if k in s:
            return k
    return s


def main():
    try:
        L = json.load(open(os.path.join(M, "lines.json")))
    except Exception:
        L = {}
    games = {}
    for g in L.get("games", []):
        if g.get("game_status") != "pre" or not g.get("espn_id"):
            continue
        per = {}
        for src, b in (g.get("books") or {}).items():
            k = book_of(src)
            if k in per:  # 同一家多个入口（记分板/core）只算一次
                continue
            if b.get("line_home") is None and b.get("line_total") is None:
                continue
            per[k] = {"book": NAME.get(k, k), "line_home": b.get("line_home"), "line_total": b.get("line_total")}
        if not per:
            continue
        bs = list(per.values())
        sp = [b["line_home"] for b in bs if b["line_home"] is not None]
        to = [b["line_total"] for b in bs if b["line_total"] is not None]
        games[g["espn_id"]] = {"away": g.get("away"), "home": g.get("home"), "books": bs,
                               "med_line_home": statistics.median(sp) if sp else None,
                               "med_total": statistics.median(to) if to else None, "n": len(bs)}
    try:
        C = json.load(open(os.path.join(M, "crown.json")))
    except Exception:
        C = []
    crown = [{k: c.get(k) for k in ("game", "crown_spread_now", "crown_total_now", "crown_spread_open", "crown_total_open", "read_at")} for c in C if isinstance(c, dict)]
    out = {"updated_pt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "lines_updated_pt": L.get("updated_at_pt", ""),
           "source": "同事监控 monitor/lines.json（ESPN 记分板/核心接口的 DraftKings、Pinnacle 公开盘）；皇冠来自 monitor/crown.json",
           "games": games, "crown": crown}
    old = None
    try:
        old = json.load(open(OUT))
    except Exception:
        pass
    if old and {k: v for k, v in old.items() if k != "updated_pt"} == {k: v for k, v in out.items() if k != "updated_pt"}:
        return
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)


main()
