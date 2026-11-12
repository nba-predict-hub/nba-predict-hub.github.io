#!/usr/bin/env python3
"""球员分量标签：ESPN 免费接口一次取全联盟本赛季常规赛场均数据，生成 player_roles.json（键 = ESPN 球员 ID）。
接口：site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete（本赛季，常规赛）。
规则（按顺序取第一个符合的）：核心=场均≥18 分或球队场均得分前 2（至少出场 3 场才参与排名）；主力=场均>25 分钟；轮换=15–25 分钟；边缘=<15 分钟。
本赛季没出场的不在接口里，就不标；不用上赛季数据。"""
import datetime, json, os, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
now = datetime.date.today()
season = now.year + 1 if now.month >= 8 else now.year
URL = ("https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
       "?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=1000&sort=offensive.avgPoints%3Adesc"
       f"&season={season}&seasontype=2")
d = json.load(urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"}), timeout=60))
cats = {c["name"]: c["names"] for c in d["categories"]}
rows = []
for a in d.get("athletes", []):
    at = a.get("athlete", {}); vals = {}
    for c in a.get("categories", []):
        for n, v in zip(cats.get(c["name"], []), c.get("totals", [])):
            vals[n] = v
    try:
        gp = int(float(vals.get("gamesPlayed") or 0)); mpg = float(vals.get("avgMinutes") or 0); ppg = float(vals.get("avgPoints") or 0)
    except ValueError:
        continue
    if gp <= 0:
        continue
    rows.append({"id": str(at.get("id")), "name": at.get("displayName"), "team": at.get("teamShortName") or "", "gp": gp, "mpg": round(mpg, 1), "ppg": round(ppg, 1)})
top2 = {}
for r in sorted([r for r in rows if r["gp"] >= 3], key=lambda r: -r["ppg"]):
    top2.setdefault(r["team"], [])
    if len(top2[r["team"]]) < 2:
        top2[r["team"]].append(r["id"])
out = {}
for r in rows:
    if r["ppg"] >= 18 or r["id"] in top2.get(r["team"], []): role = "核心"
    elif r["mpg"] > 25: role = "主力"
    elif r["mpg"] >= 15: role = "轮换"
    else: role = "边缘"
    out[r["id"]] = {"role": role, "ppg": r["ppg"], "mpg": r["mpg"], "gp": r["gp"], "team": r["team"], "en": r["name"]}
res = {"season": d.get("requestedSeason", {}).get("displayName", str(season)), "source": "ESPN 本赛季常规赛场均", "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "players": out}
tmp = os.path.join(HERE, "player_roles.json.tmp")
json.dump(res, open(tmp, "w"), ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, os.path.join(HERE, "player_roles.json"))
from collections import Counter
print(f"球员分量：{len(out)} 人", dict(Counter(v['role'] for v in out.values())))
