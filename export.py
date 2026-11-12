#!/usr/bin/env python3
"""从 /workspace/nba_model 的真实模型输出生成 data.json（只读，不改模型输出）。

用法：python3 export.py [--model-dir /workspace/nba_model] [--out data.json]
任何拿不到的字段一律写 null，并在 missing 列表里写明“缺”。
"""
from __future__ import annotations
import argparse, csv, glob, json, os, re, statistics, sys
from datetime import datetime, timedelta, timezone

PT = timezone(timedelta(hours=-8))   # 11 月为太平洋标准时间
ET_OFFSET = 3                         # ET 比 PT 早 3 小时

ap = argparse.ArgumentParser()
ap.add_argument("--model-dir", default="/workspace/nba_model")
ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json"))
args = ap.parse_args()
M = args.model_dir
sys.path.insert(0, M)
try:
    from teams import ABBR_TO_CN, ABBR_TO_NAME, TPT_TO_ABBR
except Exception:
    ABBR_TO_CN, ABBR_TO_NAME, TPT_TO_ABBR = {}, {}, {}
NAME_TO_ABBR = {v: k for k, v in ABBR_TO_NAME.items()}
NAME_TO_ABBR["LA Clippers"] = "LAC"
ESPN_ABBR = {"GS": "GSW", "SA": "SAS", "NO": "NOP", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS"}

missing: list[str] = []
sources: list[dict] = []


def p(*a):
    return os.path.join(M, *a)


def mtime_pt(path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), PT).strftime("%Y-%m-%d %H:%M PT")
    except OSError:
        return None


def add_source(name, path, note=""):
    sources.append({"name": name, "file": os.path.relpath(path, M) if path.startswith(M) else path,
                    "updated": mtime_pt(path), "note": note, "exists": os.path.exists(path)})


def fnum(x):
    try:
        if x is None or x == "":
            return None
        return float(x)
    except ValueError:
        return None


def cn(abbr):
    return ABBR_TO_CN.get(abbr, abbr)


def utc_to_pt(s):
    if not s:
        return None
    try:
        dt = datetime.strptime(s.replace("Z", ""), "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
        return dt.astimezone(PT).strftime("%m-%d %H:%M PT")
    except ValueError:
        return None


def handicap_text(team_abbr, team_is_home, line_home):
    """line_home = 盘口预期主队净胜分（正=主队让分）。返回如 '勇士 +6.5'。"""
    if line_home is None:
        return None
    h = -line_home if team_is_home else line_home
    s = "0" if h == 0 else (f"+{h:g}" if h > 0 else f"{h:g}")
    return f"{cn(team_abbr)} {s}"


BAND = {"high": "高", "mid": "中", "low": "低"}

# ---------------- 1. live_ledger.csv ----------------
ledger_path = p("out", "live_ledger.csv")
add_source("赛前锁定账本 live_ledger.csv", ledger_path, "每场赛前锁定的方向/盘口/把握度；赛后填对错")
ledger = []
if os.path.exists(ledger_path):
    with open(ledger_path, newline="", encoding="utf-8") as f:
        ledger = list(csv.DictReader(f))
else:
    missing.append("live_ledger.csv 缺")

# ---- 自动识别台账里的模型版本：取最大版本号，主结论用该版本的“融合版” ----
CN_NUM = "零一二三四五六七八九十"


def ver_of(m):
    mm = re.match(r"v(\d+)[_=]", m or "")
    return int(mm.group(1)) if mm else None


def ver_cn(n):
    return f"第{CN_NUM[n]}版" if n is not None and n <= 10 else f"v{n}"


ledger_versions = sorted({ver_of(r["model"]) for r in ledger if ver_of(r["model"]) is not None})
LATEST_V = ledger_versions[-1] if ledger_versions else None
# 主结论优先级（可用环境变量覆盖）：融合版 stack > fusion > 冻结选定 selected
MAIN_PREF = [x.strip().lower() for x in os.environ.get("MAIN_MODEL_PREF", "stack,fusion,融合,selected").split(",") if x.strip()]


def choose_main(market, version):
    models = sorted({r["model"] for r in ledger if r["market"] == market and ver_of(r["model"]) == version})
    for kw in MAIN_PREF:
        hits = [m for m in models if kw in m.lower()]
        if hits:
            return hits[0]
    return models[0] if models else None


def pick_lt(model, suffix):
    lts = sorted({r["line_type"] for r in ledger if r["model"] == model and r["line_type"].endswith(suffix)})
    return ("dk" + suffix) if ("dk" + suffix) in lts else (lts[0] if lts else None)


def model_label(m):
    if not m:
        return "缺"
    v = ver_of(m)
    low = m.lower()
    if "stack" in low or "fusion" in low:
        nm = "融合版（球员模型 + ESPN）"
    elif "player" in low:
        nm = "自建球员模型"
    elif "selected" in low and "espn" in low:
        nm = "冻结规则选定（ESPN " + ("总分" if "total" in low else "FPI") + "）"
    elif "selected" in low:
        nm = "冻结规则选定 " + m.split("=", 1)[-1]
    elif "_cand_" in low:
        nm = "候选 " + m.split("_cand_", 1)[-1]
    elif "massey" in low:
        nm = "Massey"
    elif "sagarin" in low:
        nm = "Sagarin"
    elif "frozen" in low:
        nm = "冻结版（ESPN）"
    else:
        nm = m
    return (ver_cn(v) + " " if v is not None else "") + nm


MAIN_SP = choose_main("spread", LATEST_V)
MAIN_TO = choose_main("total", LATEST_V)
SP_CUR, SP_OPEN = pick_lt(MAIN_SP, "_current"), pick_lt(MAIN_SP, "_open")
TO_CUR, TO_OPEN = pick_lt(MAIN_TO, "_current"), pick_lt(MAIN_TO, "_open")
if LATEST_V is None:
    missing.append("台账里识别不到模型版本号")


def grade(model, lt):
    w = l = pu = 0
    for r in ledger:
        if r["model"] == model and r["line_type"] == lt and (r.get("result") or "").strip():
            x = r["result"].strip().lower()
            if x[0] in "w胜赢" or x.startswith("win"):
                w += 1
            elif x[0] in "l负输" or x.startswith("loss"):
                l += 1
            elif x[0] in "p走" or x.startswith("push"):
                pu += 1
    n = w + l
    return {"w": w, "l": l, "p": pu, "graded": w + l + pu, "pct": round(100 * w / n, 1) if n else None}


# ---------------- 2. ESPN 记分板（赛程/场馆/战绩/转播） ----------------
sb_path = p("raw", "espn_scoreboard.json")
add_source("ESPN 记分板", sb_path, "开球时间、场馆、战绩、转播")
sb = {}
try:
    for e in json.load(open(sb_path))["events"]:
        c = e["competitions"][0]
        info = {"tip_pt": utc_to_pt(e.get("date", "")[:16]), "venue": c.get("venue", {}).get("fullName"),
                "broadcast": "、".join(n for b in c.get("broadcasts", []) for n in b.get("names", [])) or None,
                "records": {}}
        for t in c["competitors"]:
            ab = ESPN_ABBR.get(t["team"]["abbreviation"], t["team"]["abbreviation"])
            recs = t.get("records") or []
            info["records"][ab] = recs[0]["summary"] if recs else None
        sb[e["id"]] = info
except Exception as ex:
    missing.append(f"ESPN 记分板读取失败：{ex}")

# ---------------- 3. TPT 快照 ----------------
tpt_files = sorted(glob.glob(p("raw", "tpt_daily", "nbapreds_*.csv")))
tpt = {}
tpt_time = None
if tpt_files:
    tf = tpt_files[-1]
    m = re.search(r"(\d{8})_(\d{4})", tf)
    if m:
        tpt_time = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M").strftime("%Y-%m-%d %H:%M PT")
    add_source("ThePredictionTracker 快照", tf, f"快照时间 {tpt_time}；Massey/Sagarin/ESPN FPI 等电脑分与美盘初盘/现盘")
    with open(tf, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            a, h = TPT_TO_ABBR.get(r["road"]), TPT_TO_ABBR.get(r["home"])
            if a and h:
                tpt[(a, h)] = r
else:
    missing.append("TPT 快照缺")

# ---------------- 4. 官方伤病报告 ----------------
STATUSES = ["Out", "Doubtful", "Questionable", "Probable", "Available"]
STATUS_CN_KEYS = set(STATUSES)
TEAM_NAMES = sorted(NAME_TO_ABBR.keys(), key=len, reverse=True)


def parse_inj_txt(path):
    """解析官方 PDF 转出的 txt。返回 {(away,home): [ {team,name,status,reason_raw} ]} 以及未提交名单。"""
    out, not_sub = {}, set()
    matchup, team, gdate = None, None, None
    lines = open(path, encoding="utf-8", errors="ignore").read().splitlines()
    for i, ln in enumerate(lines):
        md = re.match(r"\s*(\d{2})/(\d{2})/(\d{4})\b", ln)
        if md:
            gdate = f"{md.group(3)}-{md.group(1)}-{md.group(2)}"
        mm = re.search(r"\b([A-Z]{2,3})@([A-Z]{2,3})\b", ln)
        if mm:
            matchup = (gdate, mm.group(1), mm.group(2))
        for tn in TEAM_NAMES:
            if re.search(r"(^|\s{2,})" + re.escape(tn) + r"(\s{2,}|$)", ln):
                team = NAME_TO_ABBR[tn]
                break
        if "NOT YET SUBMITTED" in ln and team and matchup:
            not_sub.add((matchup, team))
            continue
        toks = [t for t in re.split(r"\s{2,}", ln.strip()) if t]
        for j, t in enumerate(toks):
            if t in STATUSES and j > 0 and "," in toks[j - 1] and matchup and team:
                reason = " ".join(toks[j + 1:])
                if not reason:  # 原因被 PDF 拆成上下两行
                    prev = lines[i - 1].strip() if i > 0 else ""
                    nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
                    reason = (prev + " " + nxt).strip()
                out.setdefault(matchup, []).append({"team": team, "name": toks[j - 1], "status": t,
                                                    "reason_raw": re.sub(r"\s+", " ", reason)})
    return out, not_sub


def inj_file_time(path):
    m = re.search(r"(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)", path)
    if not m:
        return None, None
    hh = int(m.group(2)) % 12 + (12 if m.group(4) == "PM" else 0)
    et = datetime.strptime(f"{m.group(1)} {hh:02d}:{m.group(3)}", "%Y-%m-%d %H:%M")
    return et, et - timedelta(hours=ET_OFFSET)


inj_files = sorted(glob.glob(p("raw", "inj", "Injury-Report_*.txt")), key=lambda x: inj_file_time(x)[0] or datetime.min)
inj_versions = []
for fpath in inj_files:
    et, ptt = inj_file_time(fpath)
    data, ns = parse_inj_txt(fpath)
    inj_versions.append({"file": os.path.basename(fpath), "et": et, "pt": ptt, "data": data, "not_sub": ns})
# ---- 监控管道（每 15 分钟）：monitor/lines.json、injuries.json、alerts.json ----
def load_json(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return None


def pst_to_pt(sv):
    return (sv or "").replace(" PST", " PT").replace(" PDT", " PT") or None


MON_DIR = p("monitor")
mon_lines = load_json(os.path.join(MON_DIR, "lines.json"))
mon_inj = load_json(os.path.join(MON_DIR, "injuries.json"))
mon_alerts = load_json(os.path.join(MON_DIR, "alerts.json"))
for nm, obj, fn, note in [("盘口监控 lines.json", mon_lines, "lines.json", "DraftKings（ESPN）/ 平博 / TPT 共识，含初盘与变盘"),
                          ("伤病监控 injuries.json", mon_inj, "injuries.json", "NBA 官方伤病报告（监控抓取）"),
                          ("变动事件 alerts.json", mon_alerts, "alerts.json", "盘口变动 >1 分、伤病状态变化")]:
    if obj is not None:
        add_source(nm, os.path.join(MON_DIR, fn), f"监控更新 {pst_to_pt(obj.get('updated_at_pt'))}；{note}")
    else:
        missing.append(f"监控文件 monitor/{fn} 缺或读取失败，相关内容退回本地快照")
if mon_inj and mon_inj.get("official_version"):
    mv_ = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)", mon_inj["official_version"])
    if mv_:
        hh = int(mv_.group(2)) % 12 + (12 if mv_.group(4) == "PM" else 0)
        et_m = datetime.strptime(f"{mv_.group(1)} {hh:02d}:{mv_.group(3)}", "%Y-%m-%d %H:%M")
        data_m, ns_m = {}, set()
        for r in mon_inj.get("official") or []:
            mu = (r.get("matchup") or "").split("@")
            gd = r.get("game_date") or ""
            mdd = re.match(r"(\d{2})/(\d{2})/(\d{4})", gd)
            if len(mu) != 2 or not mdd:
                continue
            key = (f"{mdd.group(3)}-{mdd.group(1)}-{mdd.group(2)}", mu[0], mu[1])
            if r.get("status") == "NOT YET SUBMITTED" or r.get("role") == "team_pending":
                ns_m.add((key, r.get("team")))
            elif r.get("player") and r.get("status") in STATUS_CN_KEYS:
                data_m.setdefault(key, []).append({"team": r.get("team"), "name": r["player"], "status": r["status"],
                                                   "reason_raw": r.get("reason") or "", "g_league_flag": bool(r.get("is_gleague"))})
        if not inj_versions or et_m > inj_versions[-1]["et"]:
            inj_versions.append({"file": "monitor/injuries.json（" + mon_inj["official_version"] + "）", "et": et_m,
                                 "pt": et_m - timedelta(hours=ET_OFFSET), "data": data_m, "not_sub": ns_m, "monitor": True})
if inj_versions:
    add_source("NBA 官方伤病报告", p("raw", "inj", inj_versions[-1]["file"]),
               f"最新一版 {inj_versions[-1]['et']:%m-%d %I:%M %p} ET（{inj_versions[-1]['pt']:%H:%M} PT）")
else:
    missing.append("官方伤病报告缺")

# 球员 NBA personId：只取官方伤病数据整理表（SportsDataVerse，来自 NBA 官方报告）里的 person_id
pid_map, reason_map = {}, {}
for fpath in sorted(glob.glob(p("raw", "inj_reports", "injury_report_2027*.csv"))):
    with open(fpath, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ab = NAME_TO_ABBR.get(r.get("team", ""))
            nm = (r.get("report_player_name") or "").strip()
            if not ab or not nm:
                continue
            pid = r.get("person_id")
            if pid:
                try:
                    pid_map[(ab, nm)] = str(int(float(pid)))
                except ValueError:
                    pass
            if r.get("reason"):
                reason_map[(ab, nm)] = r["reason"]
if pid_map:
    add_source("球员 NBA ID（官方伤病报告整理表）", p("raw", "inj_reports", "injury_report_2027_new.csv"),
               "person_id 字段 = NBA 官方 personId，用于官方头像")

WORDS = [("Injury/Illness - ", ""), ("Return to Competition Reconditioning", "复出适应"), ("Personal Reasons", "个人原因"),
         ("MCL Tear", "内侧副韧带撕裂"), ("MCL", "内侧副韧带"), ("Plantar Fascia", "足底筋膜"), ("Achilles", "跟腱"), ("Recovery", "恢复"),
         ("Shoulder", "肩"), ("Wrist", "腕"), ("Toe", "脚趾"), ("Neck", "颈"), ("Quadriceps", "股四头肌"), ("Quad", "股四头肌"),
         ("Fracture", "骨折"), ("Tear", "撕裂"), ("Rest", "休息"), ("Hand", "手"), ("Head", "头"), ("Back", "背"), ("Leg", "腿"), ("G League - Two-Way", "发展联盟双向合同"), ("G League - On Assignment", "下放发展联盟"),
         ("Not With Team", "不随队"), ("Injury Management", "伤病管理"), ("Repair / Surgery", "修复手术"),
         ("Concussion Protocol", "脑震荡观察"), ("Respiratory Illness", "呼吸道疾病"), ("Illness", "生病"),
         ("Bilateral", "双侧"), ("Left", "左"), ("Right", "右"), ("Lumbar Disc Herniation", "腰椎间盘突出"),
         ("Low Back", "下背"), ("Hamstring", "腘绳肌"), ("Patellar Tendon", "髌腱"), ("Patellar Tendinopathy", "髌腱病"),
         ("ACL", "前十字韧带"), ("Knee", "膝"), ("Ankle", "踝"), ("Calf", "小腿"), ("Groin", "腹股沟"), ("Thumb", "拇指"),
         ("Finger", "手指"), ("Elbow", "肘"), ("Foot", "脚"), ("Hip", "髋"), ("Soleus", "比目鱼肌"), ("Adductor", "内收肌"),
         ("Meniscus", "半月板"), ("AC Joint", "肩锁关节"), ("UCL Tear", "尺侧副韧带撕裂"), ("Bone Bruise", "骨挫伤"),
         ("Contusion", "挫伤"), ("Avulsion Fracture", "撕脱性骨折"), ("Stress Reaction", "应力反应"),
         ("Inflammation", "发炎"), ("Impingement", "撞击症"), ("Strain", "拉伤"), ("Sprain", "扭伤"), ("Surgery", "手术"),
         ("Tightness", "紧绷"), ("Soreness", "酸痛"), ("Spasms", "痉挛"), ("Splint", "夹板"),
         ("Fracture", "骨折"), ("Tear", "撕裂"), ("Rest", "休息"), ("Hand", "手"), ("Head", "头"), ("Back", "背"), ("Leg", "腿"), ("Injury", "伤")]


WORDS += [("High Ankle", "高位踝"), ("Partially Torn", "部分撕裂"), ("Disc Irritation", "椎间盘刺激"), ("Plantar Plate", "跖板"),
          ("2nd", "第二"), ("Management", "管理")]
WORDS = sorted(dict(WORDS).items(), key=lambda kv: len(kv[0]), reverse=True)


def reason_cn(s):
    out = s or ""
    for a, b in WORDS:
        out = out.replace(a, b)
    return re.sub(r"\s*/\s*", "/", re.sub(r"\s+", "", out)) if out else ""


def name_cn_order(nm):
    # "Butler III, Jimmy" -> "Jimmy Butler III"
    parts = [x.strip() for x in nm.split(",")]
    if len(parts) == 2:
        return f"{parts[1]} {parts[0]}"
    if len(parts) == 3:
        return f"{parts[2]} {parts[0]} {parts[1]}"
    return nm


STATUS_CN = {"Out": ("缺阵", "out"), "Doubtful": ("大概率缺阵", "doubtful"), "Questionable": ("出战成疑", "questionable"),
             "Probable": ("大概率出战", "probable"), "Available": ("可出战", "available")}

# ---------------- 5. 球队五源报告（只有勇士@火箭有） ----------------
rep_v2 = p("out", "GSW_at_HOU_20261111_v2.md")
rep_v1 = p("out", "GSW_at_HOU_20261111.md")
cache_gh = p("cache", "GSW_at_HOU.json")
rep_text = open(rep_v2, encoding="utf-8").read() if os.path.exists(rep_v2) else ""
if rep_text:
    add_source("勇士@火箭 第二版赛前报告", rep_v2, "约 08:19 PT 采集")
if os.path.exists(rep_v1):
    add_source("勇士@火箭 演示报告", rep_v1, "约 08:02 PT 采集")
gh_cache = json.load(open(cache_gh)) if os.path.exists(cache_gh) else {}
if gh_cache:
    add_source("勇士@火箭 盘口缓存", cache_gh, "平博/DraftKings/Covers，08:02 PT")


def strip_md(s):
    return re.sub(r"\*\*|`", "", s).strip()


def md_section(text, title):
    m = re.search(r"^## " + re.escape(title) + r".*?$(.*?)(?=^## |\Z)", text, re.S | re.M)
    return m.group(1) if m else ""


def md_bullets(sec):
    return [strip_md(x[2:]) for x in sec.splitlines() if x.startswith("- ")]


# ---------------- 6. 组装每场比赛 ----------------
games = {}
for r in ledger:
    gid = r["espn_id"]
    g = games.setdefault(gid, {"espn_id": gid, "away": r["away"], "home": r["home"], "rows": []})
    g["rows"].append(r)


def latest(rows, pred):
    sel = [r for r in rows if pred(r)]
    return sorted(sel, key=lambda r: r["lock_time"])[-1] if sel else None


GD = ledger[0]["game_date"] if ledger else None
MON_GAMES = {g["espn_id"]: g for g in (mon_lines or {}).get("games", [])}
_pre = [MON_GAMES[x] for x in games if x in MON_GAMES and MON_GAMES[x].get("game_status") == "pre"]
PIN_FULL = bool(_pre) and all(fnum((g.get("books", {}).get("pinnacle") or {}).get("line_home")) is not None for g in _pre)
out_games = []
for gid, g in games.items():
    a, h = g["away"], g["home"]
    rows = g["rows"]
    s = sb.get(gid, {})
    t = tpt.get((a, h))
    GV = max([ver_of(r["model"]) for r in rows if ver_of(r["model"]) is not None] or [None])
    G_SP, G_TO = choose_main("spread", GV), choose_main("total", GV)
    G_SPC, G_SPO = pick_lt(G_SP, "_current"), pick_lt(G_SP, "_open")
    G_TOC, G_TOO = pick_lt(G_TO, "_current"), pick_lt(G_TO, "_open")
    sp = latest(rows, lambda r: r["market"] == "spread" and r["model"] == G_SP and r["line_type"] == G_SPC)
    sp_open = latest(rows, lambda r: r["market"] == "spread" and r["model"] == G_SP and r["line_type"] == G_SPO)
    to = latest(rows, lambda r: r["market"] == "total" and r["model"] == G_TO and r["line_type"] == G_TOC)
    to_open = latest(rows, lambda r: r["market"] == "total" and r["model"] == G_TO and r["line_type"] == G_TOO)

    def pick_obj(r, kind):
        if not r:
            return None
        if kind == "spread":
            team = r["pick"]
            line = fnum(r["line_home"])
            return {"model": r["model"], "model_label": model_label(r["model"]), "lock_time": r["lock_time"], "pick_team": team, "pick_cn": cn(team),
                    "pick_text": handicap_text(team, team == h, line), "line_home": line,
                    "pred_home_margin": fnum(r["pred_home_margin"]), "edge": fnum(r["edge"]),
                    "band": r.get("band") or None, "band_cn": BAND.get(r.get("band") or "", "缺"),
                    "line_source": ("DraftKings 现盘（经 ESPN，锁定时抓取）" if r["line_type"].startswith("dk") else r["line_type"]), "result": r.get("result") or None}
        return {"model": r["model"], "model_label": model_label(r["model"]), "lock_time": r["lock_time"], "pick": r["pick"],
                "pick_cn": {"OVER": "大分", "UNDER": "小分"}.get(r["pick"], r["pick"]),
                "line_total": fnum(r["line_total"]), "pred_total": fnum(r["pred_total"]), "edge": fnum(r["edge"]),
                "band": r.get("band") or None, "band_cn": BAND.get(r.get("band") or "", "缺"),
                "pick_text": f"{ {'OVER': '大', 'UNDER': '小'}.get(r['pick'], r['pick']) } {fnum(r['line_total']):g}" if fnum(r["line_total"]) is not None else None,
                "line_source": ("DraftKings 现盘（经 ESPN，锁定时抓取）" if r["line_type"].startswith("dk") else r["line_type"]), "result": r.get("result") or None}

    # 多家盘口：比赛未开赛且监控有数据 → 用 monitor/lines.json；否则用锁定时的数据
    books = []
    mg = MON_GAMES.get(gid)
    game_status = mg.get("game_status") if mg else None
    if mg and game_status == "pre" and mg.get("books"):
        B = mg["books"]
        upd = pst_to_pt(mon_lines.get("updated_at_pt"))
        dk_core, dk_sb = B.get("espn_core_draftkings"), B.get("espn_scoreboard_draftkings")
        if dk_core:
            books.append({"book": "DraftKings", "via": "ESPN core 接口", "time": upd,
                          "open_home": fnum(dk_core.get("open_line_home")), "cur_home": fnum(dk_core.get("line_home")),
                          "total_open": fnum(dk_core.get("open_line_total")), "total_cur": fnum(dk_core.get("line_total")), "in_median": True})
        if dk_sb:
            dup = dk_core is not None
            books.append({"book": "DraftKings（记分板接口）", "via": "ESPN 记分板", "time": upd,
                          "open_home": None, "cur_home": fnum(dk_sb.get("line_home")), "total_open": None,
                          "total_cur": fnum(dk_sb.get("line_total")), "in_median": not dup,
                          "note": "与上面同一家 DraftKings，中位数只算一次（用 core 接口）" if dup else ""})
        pin = B.get("pinnacle")
        if pin:
            books.append({"book": "平博 Pinnacle", "via": "平博公开接口", "time": upd, "open_home": None,
                          "cur_home": fnum(pin.get("line_home")), "total_open": None, "total_cur": fnum(pin.get("line_total")),
                          "in_median": PIN_FULL, "note": "" if PIN_FULL else "平博没有覆盖全部未开赛场次，暂不计入中位数"})
        tp = B.get("tpt")
        if tp:
            books.append({"book": "美盘共识（ThePredictionTracker）", "via": "TPT nbapreds.csv", "time": upd,
                          "open_home": fnum(tp.get("open_line_home")), "cur_home": fnum(tp.get("line_home")),
                          "total_open": None, "total_cur": None, "in_median": True, "note": "大小分缺"})
        market_src = f"monitor/lines.json（{upd}）"
    else:
        if sp:
            books.append({"book": "DraftKings", "via": "ESPN 接口（锁定时）", "time": sp["lock_time"],
                          "open_home": fnum(sp_open["line_home"]) if sp_open else None, "cur_home": fnum(sp["line_home"]),
                          "total_open": fnum(to_open["line_total"]) if to_open else None,
                          "total_cur": fnum(to["line_total"]) if to else None, "in_median": True})
        if t:
            books.append({"book": "美盘共识（ThePredictionTracker）", "via": "TPT nbapreds.csv", "time": tpt_time,
                          "open_home": fnum(t.get("lineopen")), "cur_home": fnum(t.get("line")),
                          "total_open": None, "total_cur": None, "in_median": True})
        market_src = ("比赛已开赛，盘口停在赛前锁定/快照时" if game_status in ("in", "post") else "监控没有本场盘口，用锁定时的数据")
    cur_lines = [b["cur_home"] for b in books if b["in_median"] and b["cur_home"] is not None]
    tot_lines = [b["total_cur"] for b in books if b["in_median"] and b["total_cur"] is not None]
    med = statistics.median(cur_lines) if cur_lines else None
    med_t = statistics.median(tot_lines) if tot_lines else None
    spread_range = (max(cur_lines) - min(cur_lines)) if len(cur_lines) > 1 else None

    # 各家电脑/模型预测（主队净胜分）
    comps = []
    def addc(name, val, src, official=False):
        if val is not None:
            comps.append({"name": name, "pred_home_margin": round(val, 2), "source": src, "official": official})
    lat_sp = sorted({r["model"] for r in rows if r["market"] == "spread" and ver_of(r["model"]) == GV})
    for mdl in sorted(lat_sp, key=lambda m: m != G_SP):
        r = latest(rows, lambda r, k=mdl: r["model"] == k and r["market"] == "spread" and r["pred_home_margin"] != "")
        if r:
            addc(model_label(mdl), fnum(r["pred_home_margin"]), f"live_ledger {mdl}（锁定 {r['lock_time']}）", mdl == G_SP)
    for mdl in sorted({r["model"] for r in rows if r["market"] == "spread" and ver_of(r["model"]) and ver_of(r["model"]) < (GV or 0)}, reverse=True):
        r = latest(rows, lambda r, k=mdl: r["model"] == k)
        if r:
            addc(model_label(mdl), fnum(r["pred_home_margin"]), f"live_ledger {mdl}（锁定 {r['lock_time']}）")
    if t:
        addc("Massey", fnum(t.get("linemassey")), f"TPT 快照 {tpt_time}")
        addc("Sagarin", fnum(t.get("linesag")), f"TPT 快照 {tpt_time}")
        addc("TPT 全部电脑平均", fnum(t.get("lineavg")), f"TPT 快照 {tpt_time}")
    lean_home = lean_away = 0
    for c in comps:
        if med is not None:
            c["lean"] = h if c["pred_home_margin"] > med else (a if c["pred_home_margin"] < med else "持平")
            c["lean_cn"] = cn(c["lean"]) if c["lean"] in (a, h) else "持平"
            lean_home += c["lean"] == h
            lean_away += c["lean"] == a
    total_comps = []
    lat_to = sorted({r["model"] for r in rows if r["market"] == "total" and ver_of(r["model"]) == GV})
    for mdl in sorted(lat_to, key=lambda m: m != G_TO):
        r = latest(rows, lambda r, k=mdl: r["model"] == k and r["market"] == "total")
        if r and fnum(r["pred_total"]) is not None:
            total_comps.append({"name": model_label(mdl), "pred_total": fnum(r["pred_total"]), "official": mdl == G_TO})
    # 主结论之外，再给出“冻结规则选定”那一行做对照（若主结论不是它）
    alt = None
    sel = [m for m in lat_sp if "selected" in m.lower() and m != G_SP]
    if sel:
        ra = latest(rows, lambda r: r["model"] == sel[0] and r["line_type"] == G_SPC)
        if ra:
            alt = {"label": model_label(sel[0]), "pick_text": handicap_text(ra["pick"], ra["pick"] == h, fnum(ra["line_home"])),
                   "edge": fnum(ra["edge"]), "band_cn": BAND.get(ra.get("band") or "", "缺")}

    # 伤病
    inj = {"report": None, "players": [], "not_submitted": [], "changes": []}
    if inj_versions:
        lv = inj_versions[-1]
        inj["report"] = f"{lv['et']:%m-%d %I:%M %p} ET（{lv['pt']:%H:%M} PT）"
        for pl in lv["data"].get((GD, a, h), []):
            key = (pl["team"], pl["name"])
            reason_raw = (pl["reason_raw"] if lv.get("monitor") else None) or reason_map.get(key) or pl["reason_raw"]
            lab, cls = STATUS_CN[pl["status"]]
            gl = pl.get("g_league_flag") or "G League" in reason_raw
            inj["players"].append({"team": pl["team"], "team_cn": cn(pl["team"]), "name": name_cn_order(pl["name"]),
                                   "status": pl["status"], "status_cn": lab, "cls": cls,
                                   "reason": reason_cn(reason_raw), "reason_raw": reason_raw,
                                   "nba_id": pid_map.get(key), "g_league": gl})
        inj["not_submitted"] = [cn(tm) for (mu, tm) in lv["not_sub"] if mu == (GD, a, h)]
        # 各版本之间名单变化
        prev = None
        for v in inj_versions:
            cur = {(x["team"], x["name"]): x["status"] for x in v["data"].get((GD, a, h), [])}
            if prev is not None:
                ch = []
                for k2 in sorted(set(cur) | set(prev)):
                    if cur.get(k2) != prev.get(k2):
                        ch.append(f"{cn(k2[0])} {name_cn_order(k2[1])}：{STATUS_CN.get(prev.get(k2), ('未列',))[0]} → {STATUS_CN.get(cur.get(k2), ('未列',))[0]}")
                if ch:
                    inj["changes"].append({"report": f"{v['et']:%m-%d %I:%M %p} ET", "pt": f"{v['pt']:%m-%d %H:%M} PT", "items": ch})
            prev = cur

    game = {"espn_id": gid, "away": a, "home": h, "away_cn": cn(a), "home_cn": cn(h),
            "away_name": ABBR_TO_NAME.get(a), "home_name": ABBR_TO_NAME.get(h),
            "tip_pt": s.get("tip_pt"), "venue": s.get("venue"), "broadcast": s.get("broadcast"),
            "records": {a: s.get("records", {}).get(a), h: s.get("records", {}).get(h)},
            "records_note": "ESPN 记分板，" + (mtime_pt(sb_path) or "") + " 抓取",
            "game_status": game_status, "game_status_cn": {"pre": "未开赛", "in": "进行中", "post": "已结束"}.get(game_status, "缺"),
            "spread": pick_obj(sp, "spread"), "total": pick_obj(to, "total"),
            "market": {"books": books, "median_home": med, "median_text": handicap_text(h if (med or 0) >= 0 else a, (med or 0) >= 0, med) if med is not None else None,
                       "median_n": len(cur_lines), "median_total": med_t, "median_total_n": len(tot_lines),
                       "spread_range": spread_range, "source": market_src,
                       "median_books": [b["book"] for b in books if b["in_median"] and b["cur_home"] is not None],
                       "median_total_books": [b["book"] for b in books if b["in_median"] and b["total_cur"] is not None],
                       "crown": None, "crown_note": "缺：皇冠盘口需在雷速网页用浏览器读取，本系统没有存档",
                       "leisu": None, "leisu_note": "缺：雷速 12 家中位数需浏览器读取"},
            "comps": comps, "alt_pick": alt,
            "version": GV, "version_cn": ver_cn(GV) if GV else "缺", "version_record": grade(G_SP, G_SPC),
            "version_record_total": grade(G_TO, G_TOC), "lean_count": {a: lean_away, h: lean_home}, "total_comps": total_comps,
            "injuries": inj, "extra": None}

    if gid == "401909974" and rep_text:
        five = []
        for ln in md_section(rep_text, "五源").splitlines():
            cells = [strip_md(c) for c in ln.strip().strip("|").split("|")]
            if len(cells) == 4 and cells[0] not in ("源", "---") and not set(cells[0]) <= set("-"):
                five.append({"source": cells[0], "pred": cells[1], "vs_line": cells[2], "from": cells[3]})
        game["extra"] = {
            "report_file": os.path.basename(rep_v2), "report_time": "约 2026-11-11 08:19 PT",
            "headline": md_bullets(md_section(rep_text, "方向")),
            "five_sources": five,
            "efficiency": md_bullets(md_section(rep_text, "球队效率与作息")),
            "referees": strip_md(md_section(rep_text, "裁判").strip().splitlines()[0]) if md_section(rep_text, "裁判").strip() else None,
            "total_note": strip_md(md_section(rep_text, "大小分").strip()),
            "game_info": md_bullets(md_section(rep_text, "比赛信息")),
            "note": "这份是早上 08:19 PT 的第二版报告（当时对 DK -6.5）；页面顶部结论以 16:56 PT 第五版锁定为准。",
        }
    out_games.append(game)

out_games.sort(key=lambda x: (x["tip_pt"] or "", x["espn_id"]))
FEATURED = "401909974" if any(x["espn_id"] == "401909974" for x in out_games) else (out_games[0]["espn_id"] if out_games else None)

# 记分板上有、但账本没有锁定的比赛
unlocked = []
for gid, s in sb.items():
    if gid not in games:
        ab = list(s["records"].keys())
        unlocked.append({"espn_id": gid, "teams": "、".join(cn(x) for x in ab), "tip_pt": s.get("tip_pt")})

# ---------------- 7. 情报流 ----------------
feed = []
locks = sorted({r["lock_time"] for r in ledger})
for lt in locks:
    models = sorted({r["model"] for r in ledger if r["lock_time"] == lt})
    n = len({r["espn_id"] for r in ledger if r["lock_time"] == lt})
    feed.append({"time": lt, "tag": "模型锁定", "text": f"赛前锁定 {n} 场：{'、'.join(models)}", "source": "live_ledger.csv"})
if tpt_time:
    feed.append({"time": tpt_time, "tag": "电脑分", "text": f"ThePredictionTracker 快照：{len(tpt)} 场 Massey / Sagarin / ESPN FPI 与美盘初盘、现盘", "source": os.path.basename(tpt_files[-1])})
today_mu = {(GD, g["away"], g["home"]) for g in out_games}
prev = None
for v in inj_versions:
    cur = {(mu, x["name"]): x["status"] for mu, lst in v["data"].items() if mu in today_mu for x in lst}
    if prev is None:
        txt = f"官方伤病报告 {v['et']:%I:%M %p} ET：今日已锁定 {len(today_mu)} 场共列出 {len(cur)} 人"
    else:
        diff = [k for k in set(cur) | set(prev) if cur.get(k) != prev.get(k)]
        txt = f"官方伤病报告 {v['et']:%I:%M %p} ET：今日已锁定场次 " + (f"有 {len(diff)} 处状态变化" if diff else "与上一版相比无变化")
        if 0 < len(diff) <= 5:
            txt += "：" + "；".join(f"{cn(k[0][1])}@{cn(k[0][2])} {name_cn_order(k[1])} {STATUS_CN.get(prev.get(k), ('未列',))[0]}→{STATUS_CN.get(cur.get(k), ('未列',))[0]}" for k in sorted(diff))
    feed.append({"time": f"{v['pt']:%Y-%m-%d %H:%M} PT", "tag": "官方伤病", "text": txt, "source": v["file"]})
    prev = cur
if rep_text:
    for kw, tag in [("Matchup Predictor", "ESPN 胜率"), ("盘口信号", "变盘"), ("分歧：", "伤病分歧")]:
        for ln in rep_text.splitlines():
            if kw in ln:
                feed.append({"time": "2026-11-11 08:19 PT", "tag": tag, "text": "勇士@火箭：" + strip_md(ln.strip().lstrip("- ")), "source": os.path.basename(rep_v2)})
                break
    ref = md_section(rep_text, "裁判").strip()
    if ref:
        feed.append({"time": "2026-11-11 08:19 PT", "tag": "裁判", "text": "勇士@火箭：" + strip_md(ref.splitlines()[0]), "source": os.path.basename(rep_v2)})
if mon_lines:
    feed.append({"time": pst_to_pt(mon_lines.get("updated_at_pt")), "tag": "监控", "text": "盘口监控刷新：" + "；".join(
        f"{x['source']} {x.get('note', '')}" for x in mon_lines.get("sources", []) if x.get("source") in ("pinnacle", "espn_core_odds", "tpt")), "source": "monitor/lines.json"})
TAGS = {"injury_status": "伤病变动", "line_move": "变盘", "high_conf_gap": "高把握差距"}
today_games_s = {f"{g['away']}@{g['home']}" for g in out_games}
n_alert = 0
for e in (mon_alerts or {}).get("events", []):
    if e.get("game") not in today_games_s:
        continue
    if e.get("type") == "injury_status" and e.get("role") == "gleague" and not e.get("is_key_player"):
        continue
    txt = e.get("note") or ""
    if e.get("type") == "injury_status" and e.get("reason"):
        txt += f"（{reason_cn(e['reason'])}）"
    src = "monitor/alerts.json · " + str(e.get("source", "")) + (f" · 报告 {e['report_version']}" if e.get("report_version") else "") + (f" · 盘口快照 {pst_to_pt(e['lines_snap'])}" if e.get("type") != "injury_status" and e.get("lines_snap") else "")
    feed.append({"time": pst_to_pt(e.get("ts_pt")) or "时间缺", "tag": TAGS.get(e.get("type"), e.get("type") or "事件") + ("·主力" if e.get("is_key_player") else ""),
                 "text": txt, "source": src})
    n_alert += 1
if inj_versions and not inj_versions[-1].get("monitor"):
    lv = inj_versions[-1]
    feed.append({"time": f"{lv['pt']:%Y-%m-%d %H:%M} PT", "tag": "缺", "text": f"{lv['et']:%I:%M %p} ET 之后的官方伤病报告本地没有下载，之后的状态变化缺", "source": "raw/inj/"})
feed.sort(key=lambda x: x["time"], reverse=True)

# ---------------- 8. 历史命中率（只看方向） ----------------
def wl(arr, label, note=""):
    w, l, pu = arr
    n = w + l
    return {"label": label, "w": w, "l": l, "p": pu, "pct": round(100 * w / n, 1) if n else None, "note": note}

history = {"groups": []}
if LATEST_V and LATEST_V >= 6:
    vm = p(f"v{LATEST_V}", f"v{LATEST_V}_metrics.json")
    if os.path.exists(vm):
        add_source(f"{ver_cn(LATEST_V)}回测指标", vm, "")
        try:
            d = json.load(open(vm))
            sel = d.get("selection", {})
            for mkt, title in [("sp_open", "让分"), ("t_open", "大小分")]:
                chosen = sel.get(mkt, {}).get("chosen")
                for hold, desc in [("holdB", "本季样本外，对 DraftKings 初盘"), ("holdA", "2025-26 整季留出，对美盘初盘")]:
                    res = d.get("results", {}).get(mkt, {}).get(hold)
                    if not res:
                        continue
                    ms = res.get("models", {})
                    order = [chosen] + [k for k in ["espn", "stack", "espn_t", "stack_t", "linemassey", "linesag"] if k != chosen]
                    nm = {"espn": "ESPN FPI", "stack": "第五版融合 stack", "espn_t": "ESPN 总分", "stack_t": "第五版融合 stack_t",
                          "linemassey": "Massey", "linesag": "Sagarin"}
                    rows = [wl(ms[k]["all"], (f"{ver_cn(LATEST_V)} {k}（主结论）" if k == chosen else nm.get(k, k))) for k in order if k in ms]
                    if rows:
                        history["groups"].append({"title": f"{ver_cn(LATEST_V)} · {title} · {'本季样本外' if hold == 'holdB' else '上季整季留出'}",
                                                  "desc": f"{res.get('n', '')} 场，{desc}", "rows": rows})
        except Exception as ex:
            missing.append(f"{ver_cn(LATEST_V)}回测指标读取失败：{ex}")
v5m = p("v5", "v5_metrics.json")
if os.path.exists(v5m):
    add_source("第五版回测指标", v5m, "")
    d = json.load(open(v5m))
    names = {"espn": "冻结选定 ESPN FPI", "stack": "融合版 stack", "play": "自建球员模型", "v4": "第四版",
             "linemassey": "Massey", "linesag": "Sagarin", "lineespn": "ESPN FPI（TPT 存档）"}
    hb = d.get("holdB", {}).get("sp_open", {}).get("models", {})
    rows = [wl(hb[k]["all"], names[k]) for k in ["espn", "stack", "play", "v4"] if k in hb]
    rows += [{"label": "Massey", "w": None, "l": None, "p": None, "pct": None, "note": "缺：本季没有赛前存档"},
             {"label": "Sagarin", "w": None, "l": None, "p": None, "pct": None, "note": "缺：本季没有赛前存档"}]
    history["groups"].append({"title": "第五版 · 本季样本外 · 让分", "desc": "2026-10-20 至 11-10 共 160 场，对 DraftKings 初盘",
                              "rows": rows})
    hbh = [wl(hb[k]["high"], names[k] + "（高把握）") for k in ["espn", "stack", "play", "v4"] if k in hb]
    history["groups"].append({"title": "第五版 · 本季样本外 · 只看高把握", "desc": "各模型与初盘差 ≥3 分的场次", "rows": hbh})
    ha = d.get("holdA", {}).get("sp_open", {}).get("models", {})
    rows = [wl(ha[k]["all"], names[k]) for k in ["stack", "v4", "play", "espn", "linesag", "linemassey"] if k in ha]
    history["groups"].append({"title": "第五版 · 上季整季留出 · 让分", "desc": "2025-26 整季 1296 场，对美盘初盘，含 Massey / Sagarin", "rows": rows})
    tb = d.get("holdB", {}).get("t_open", {}).get("models", {})
    tn = {"espn_t": "冻结选定 ESPN 总分", "stack_t": "融合版 stack_t", "play_t": "自建球员总分"}
    rows = [wl(tb[k]["all"], tn[k]) for k in ["espn_t", "stack_t", "play_t"] if k in tb]
    history["groups"].append({"title": "第五版 · 本季样本外 · 大小分", "desc": "160 场，对 DraftKings 初盘", "rows": rows})
v2m = p("out", "v2_metrics.json")
if os.path.exists(v2m):
    add_source("第二版回测指标", v2m, "")
    d = json.load(open(v2m))
    rows = [wl([v["W"], v["L"], v["P"]], k) for k, v in d.get("hold", {}).items() if "DEV-Ridge" not in k]
    history["groups"].append({"title": "第二版独立验证集 · 让分", "desc": "25 场，样本很小，只作参考", "rows": rows})
v3m = p("out", "v3_metrics.json")
if os.path.exists(v3m):
    add_source("第三版回测指标", v3m, "")
    d = json.load(open(v3m))
    n3 = {"ridge3": "第三版 Ridge", "espn": "ESPN FPI", "massey": "Massey", "sagarin": "Sagarin"}
    rows = [wl([d["hold_scores"][k]["W"], d["hold_scores"][k]["L"], d["hold_scores"][k]["P"]], v) for k, v in n3.items() if k in d.get("hold_scores", {})]
    history["groups"].append({"title": "对收盘 · 让分", "desc": "2025-26 整季对收盘线：所有模型都在五成上下", "rows": rows})
for f in ["selected_model_v5.json", "v4_metrics.json", "v5_report.md", "v4_report.md", "v3_report.md", "v2_report.md"]:
    fp = p("v5" if f == "v5_metrics.json" else "out", f)
    if os.path.exists(fp):
        add_source(f, fp, "")
graded = [r for r in ledger if r.get("result")]
gw = sum(1 for r in graded if r["result"].upper().startswith("W"))
gl_ = sum(1 for r in graded if r["result"].upper().startswith("L"))
history["live"] = {"graded_rows": len(graded), "w": gw, "l": gl_,
                   "pct": round(100 * gw / (gw + gl_), 1) if gw + gl_ else None,
                   "note": "账本里还没有赛后对错（今晚比赛结束后才会填）" if not graded else "账本已赛场次（全部模型行）"}
v5sel = p("out", "selected_model_v5.json")
history["is_first"] = False
history["is_first_note"] = "第五版报告结论：冻结规则选出的是 ESPN 本身，自建模型没有赢过 ESPN；所有模型对收盘都在五成左右。"

# ---------------- 9. 缺失清单 ----------------
missing += [
    "皇冠盘口：全部场次缺（需在雷速网页用浏览器读取）",
    "雷速 12 家中位数：缺（只能走浏览器）",
    "官方首发：缺（报告没有列首发）",
    ("最新官方伤病报告版本：" + (f"{inj_versions[-1]['et']:%m-%d %I:%M %p} ET" if inj_versions else "缺") + "；之后的版本要等下一轮监控"),
    "裁判：只有勇士@火箭有名单，其余场次缺；裁判历史倾向全部缺",
    ("平博：未开赛场次全部有盘，已计入多家中位数" if PIN_FULL else "平博：没有覆盖全部未开赛场次，未计入中位数"),
    "已开赛场次：盘口停在赛前锁定时（监控不收滚球盘）",
    "本季 Massey / Sagarin 历史对比：缺（没有赛前存档）",
    "今晚赛后对错：比赛结束后才有",
]
for g in out_games:
    if LATEST_V and g["version"] != LATEST_V:
        missing.append(f"{g['away_cn']}@{g['home_cn']}：{ver_cn(LATEST_V)}没有锁定这场，结论沿用{g['version_cn']}")
    if g["injuries"]["not_submitted"]:
        missing.append(f"{g['away_cn']}@{g['home_cn']}：{('、'.join(g['injuries']['not_submitted']))} 截至最新官方报告仍“未提交”伤病名单")
    if g["market"]["spread_range"] is not None and g["market"]["spread_range"] >= 3:
        missing.append(f"注意 {g['away_cn']}@{g['home_cn']}：各家现盘最多相差 {g['market']['spread_range']:g} 分（{'、'.join(g['market']['median_books'])}），公司分歧大")

selected_note = None
vsel = p("out", f"selected_model_v{LATEST_V}.json") if LATEST_V else ""
if vsel and os.path.exists(vsel):
    try:
        js = json.load(open(vsel))
        selected_note = "该版本冻结规则文件写的是：" + str(js.get("spread_selected_on_train") or js.get("official_spread") or "")[:160]
    except Exception:
        pass

for m_ in (mon_lines or {}).get("missing", []):
    if "皇冠" not in m_ and "雷速" not in m_:
        missing.append("盘口监控：" + m_)

now = datetime.now(PT)
data = {
    "generated_at": now.strftime("%Y-%m-%d %H:%M:%S PT"),
    "generated_at_iso": now.isoformat(),
    "game_date": ledger[0]["game_date"] if ledger else None,
    "last_lock": locks[-1] if locks else None,
    "featured": FEATURED,
    "model_version": {
        "version": LATEST_V, "version_cn": ver_cn(LATEST_V) if LATEST_V else "缺",
        "versions_in_ledger": ledger_versions,
        "main_spread_model": MAIN_SP, "main_spread_label": model_label(MAIN_SP), "spread_line_type": SP_CUR,
        "main_total_model": MAIN_TO, "main_total_label": model_label(MAIN_TO), "total_line_type": TO_CUR,
        "record_spread": grade(MAIN_SP, SP_CUR), "record_total": grade(MAIN_TO, TO_CUR),
        "rule": "自动取台账里版本号最大的模型；同版本内按 " + " > ".join(MAIN_PREF) + " 选主结论",
        "note": selected_note,
    },
    "games": out_games,
    "unlocked_games": unlocked,
    "feed": feed,
    "history": history,
    "missing": missing,
    "sources": sources,
    "rules": ["只用赛前锁定的数据，不用赛后信息", "伤病只认 NBA 官方报告", "主盘口用多家中位数，皇冠单独列", "只看方向命中率"],
}
tmp = args.out + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
os.replace(tmp, args.out)
print(f"wrote {args.out}: {len(out_games)} games, {len(feed)} feed items, {len(missing)} missing notes")
