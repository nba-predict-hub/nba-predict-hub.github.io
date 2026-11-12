#!/usr/bin/env python3
"""ESPN 球员 ID → NBA 官方球员 ID（用于 NBA 官网头像）。
来源：NBA 官方球员异动表 stats.nba.com/js/data/playermovement/NBA_Player_Movement.json（PLAYER_SLUG/PLAYER_ID），
加上本地 NBA 官方伤病报告整理表里的 person_id。按英文全名精确匹配（去掉标点、大小写），对不上就不写。"""
import csv, glob, json, os, re, unicodedata, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
names = json.load(open(os.path.join(HERE, "player_names_zh.json"), encoding="utf-8"))
slug2id = {}
try:
    req = urllib.request.Request("https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json", headers={"User-Agent": "Mozilla/5.0"})
    rows = json.load(urllib.request.urlopen(req, timeout=60))["NBA_Player_Movement"]["rows"]
    for r in rows:
        if r.get("PLAYER_SLUG") and r.get("PLAYER_ID"):
            slug2id[r["PLAYER_SLUG"]] = str(int(float(r["PLAYER_ID"])))
except Exception as ex:
    print("异动表读取失败：", ex)
for f in glob.glob("/workspace/nba_model/raw/inj_reports/injury_report_*.csv"):
    try:
        for r in csv.DictReader(open(f, encoding="utf-8")):
            pid, nm = r.get("person_id") or r.get("PERSON_ID"), r.get("player_name") or r.get("player") or r.get("PLAYER_NAME")
            if pid and nm:
                if "," in nm:
                    last, first = nm.split(",", 1); nm = first.strip() + " " + last.strip()
                slug2id.setdefault(norm(nm), str(int(float(pid))))
    except Exception:
        pass
out = {}
for eid, v in names.items():
    s = norm(v.get("en"))
    for cand in (s, re.sub(r"-(jr|sr|ii|iii|iv)$", "", s)):
        if cand in slug2id:
            out[eid] = slug2id[cand]; break
tmp = os.path.join(HERE, "nba_ids.json.tmp")
json.dump(out, open(tmp, "w"), separators=(",", ":"))
os.replace(tmp, os.path.join(HERE, "nba_ids.json"))
print(f"NBA 头像 ID：匹配 {len(out)}/{len(names)}")
