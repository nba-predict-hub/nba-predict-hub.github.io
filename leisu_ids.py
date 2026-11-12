#!/usr/bin/env python3
"""把当天 NBA 比赛和雷速比赛 ID 对上，写进 leisu_ids.json（保留已有的，匹配不到就不写，不猜）。

做法（只用普通 GET + 手机 UA，不绕过任何限制）：
- 雷速列表页的数据接口需要设备验证（直接请求返回 405），所以不碰它；
- 改为读雷速公开的单场页面 m.leisu.com/live/lanqiu/detail-<ID>：页面标题是“客队vs主队”，
  页面里有北京时间开赛时间和“NBA 常规赛”字样。雷速的 NBA ID 基本按开赛时间连续编号，
  所以从已知 ID 附近往前后看一小段窗口即可；看过的页面缓存在 .leisu_cache.json，不重复请求。
- 和 ESPN 当天赛程按“客队 + 主队（中文名）+ 开赛时间相差 3 小时内”匹配，三项都对上才写。
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "leisu_ids.json")
CACHE = os.path.join(HERE, ".leisu_cache.json")
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
SEED = 3931668          # 2026-11-11 雷霆@开拓者，已人工核对
BACK, AHEAD = 12, 20    # 从锚点往前/往后看的 ID 数
MAX_FETCH = 20          # 每次最多请求几页（礼貌访问）
CN = {'ATL': '老鹰', 'BOS': '凯尔特人', 'BKN': '篮网', 'CHA': '黄蜂', 'CHI': '公牛', 'CLE': '骑士', 'DAL': '独行侠', 'DEN': '掘金', 'DET': '活塞', 'GSW': '勇士',
      'HOU': '火箭', 'IND': '步行者', 'LAC': '快船', 'LAL': '湖人', 'MEM': '灰熊', 'MIA': '热火', 'MIL': '雄鹿', 'MIN': '森林狼', 'NOP': '鹈鹕', 'NYK': '尼克斯',
      'OKC': '雷霆', 'ORL': '魔术', 'PHI': '76人', 'PHX': '太阳', 'POR': '开拓者', 'SAC': '国王', 'SAS': '马刺', 'TOR': '猛龙', 'UTA': '爵士', 'WAS': '奇才'}
ESPN2NBA = {"GS": "GSW", "SA": "SAS", "NO": "NOP", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS", "PHO": "PHX"}
BJ = timezone(timedelta(hours=8))
try:
    from zoneinfo import ZoneInfo
    PT = ZoneInfo("America/Los_Angeles")
except Exception:
    PT = timezone(timedelta(hours=-8))


def get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def leisu_page(i):
    html = get(f"https://m.leisu.com/live/lanqiu/detail-{i}")
    t = re.search(r"<title>([^<]*)</title>", html)
    tm = re.search(r"(20\d\d)/(\d{1,2})/(\d{1,2}) (\d{1,2}):(\d{2})", html)
    title = t.group(1).strip() if t else ""
    m = re.match(r"^(.+?)vs(.+)$", title)
    rec = {"nba": "NBA" in html, "fetched": int(time.time())}
    if m:
        rec["away"], rec["home"] = m.group(1).strip(), m.group(2).strip()
    if tm:
        y, mo, d, hh, mi = map(int, tm.groups())
        rec["tip_utc"] = datetime(y, mo, d, hh, mi, tzinfo=BJ).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    return rec


def main():
    now_pt = datetime.now(PT)
    day = now_pt.strftime("%Y%m%d")
    sb = json.loads(get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day}"))
    events = []
    for e in sb.get("events", []):
        c = (e.get("competitions") or [{}])[0]
        t = {x["homeAway"]: ESPN2NBA.get(x["team"]["abbreviation"], x["team"]["abbreviation"]) for x in c.get("competitors", [])}
        events.append({"id": str(e["id"]), "away": t.get("away"), "home": t.get("home"),
                       "tip": datetime.strptime(e["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)})

    data = load(OUT, {})
    games = data.get("games") if isinstance(data.get("games"), dict) else {}
    cache = load(CACHE, {})

    known = [int(v) for v in games.values() if re.fullmatch(r"\d+", str(v))]
    nba_ids = [int(k) for k, v in cache.items() if v.get("nba") and v.get("tip_utc", "") <= (now_pt + timedelta(days=1)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")]
    anchor = max(known + nba_ids + [SEED])
    fetched = 0
    for i in list(range(anchor - BACK, anchor + AHEAD + 1)):
        k = str(i)
        c = cache.get(k)
        stale = c is not None and not c.get("away") and time.time() - c.get("fetched", 0) > 6 * 3600  # 空页 6 小时后再看
        if c is not None and not stale:
            continue
        if fetched >= MAX_FETCH:
            break
        try:
            cache[k] = leisu_page(i)
        except Exception as ex:
            print(f"雷速 {i} 读取失败：{ex}", file=sys.stderr)
        fetched += 1
        time.sleep(1.0)
    save(CACHE, cache)

    matched, unmatched = [], []
    for ev in events:
        a, h = CN.get(ev["away"]), CN.get(ev["home"])
        hits = []
        for k, v in cache.items():
            if not v.get("nba") or v.get("away") != a or v.get("home") != h or not v.get("tip_utc"):
                continue
            tip = datetime.strptime(v["tip_utc"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
            if abs((tip - ev["tip"]).total_seconds()) <= 3 * 3600:
                hits.append(int(k))
        key = f"{a}@{h}"
        if len(hits) == 1:
            lid = hits[0]
            games.setdefault(ev["id"], lid)
            if key not in games or not games[key]:
                games[key] = lid
            matched.append(f"{key} {lid}")
        else:
            unmatched.append(key + ("（多个候选，不猜）" if hits else ""))

    data["说明"] = data.get("说明") or "场次 → 雷速比赛 ID。键可以写“客队@主队”（中文或英文缩写）或 ESPN 比赛 ID。网页每次刷新都会重新读取。"
    data["games"] = games
    data["updated_at"] = now_pt.strftime("%Y-%m-%d %H:%M")
    data["unmatched_today"] = unmatched
    save(OUT, data)
    print(f"雷速 ID：新请求 {fetched} 页；匹配 {len(matched)} 场：{'，'.join(matched)}；未匹配：{'，'.join(unmatched) or '无'}")


if __name__ == "__main__":
    main()
