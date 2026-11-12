#!/usr/bin/env python3
"""NBA 官方伤病报告（公开 PDF，约每 15 分钟一版）→ injury_report.json。
地址：https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMPM.pdf（时间是美东）。
先用 HEAD 探最新一版（从现在往回，到上次已处理的版本为止），有新版才下载、pdftotext -layout 解析。
解析复用同事的 /workspace/nba_model/monitor/snapshot_injuries.parse_official_text（只读调用）。
没有新版时不改文件，退出码 0；有新版写文件后退出码 10（给循环脚本判断是否提交）。"""
import json, os, re, subprocess, sys, tempfile, urllib.request
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/workspace/nba_model/monitor")
from snapshot_injuries import parse_official_text  # noqa: E402
ET, PT = ZoneInfo("America/New_York"), ZoneInfo("America/Los_Angeles")
BASE = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_{d}_{s}.pdf"
OUT = os.path.join(HERE, "injury_report.json")
STATE = os.path.join(HERE, ".injury_report_state.json")
UA = {"User-Agent": "Mozilla/5.0"}

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


WORDS = sorted(dict(list(WORDS) + [("Sore", "酸痛"), ("Reconditioning", "复出适应")]).items(), key=lambda kv: len(kv[0]), reverse=True)


def slot_name(dt):
    h = dt.hour % 12 or 12
    return f"{h:02d}_{dt.minute:02d}{'AM' if dt.hour < 12 else 'PM'}"


def head(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=10)
        return r.status, r.headers.get("Last-Modified")
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


def main():
    st = json.load(open(STATE)) if os.path.exists(STATE) else {}
    now = datetime.now(ET)
    t = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0)
    last = st.get("version_dt")
    last_dt = datetime.fromisoformat(last) if last else None
    found = None
    for i in range(0, 16):  # 往回最多 4 小时
        dt = t - timedelta(minutes=15 * i)
        if last_dt and dt <= last_dt:
            break
        url = BASE.format(d=dt.strftime("%Y-%m-%d"), s=slot_name(dt))
        code, lm = head(url)
        if code == 200:
            found = (dt, url, lm)
            break
    if not found:
        print(datetime.now(PT).strftime("%H:%M:%S"), "没有新版", "当前", st.get("version", "无"))
        return 0
    dt, url, lm = found
    pdf = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
    if not pdf.startswith(b"%PDF"):
        print("不是 PDF，跳过"); return 0
    with tempfile.TemporaryDirectory() as td:
        pp = os.path.join(td, "r.pdf"); open(pp, "wb").write(pdf)
        subprocess.run(["pdftotext", "-layout", pp, os.path.join(td, "r.txt")], check=True, capture_output=True)
        text = open(os.path.join(td, "r.txt"), errors="replace").read()
    version = f"{dt.strftime('%Y-%m-%d')}_{slot_name(dt)}_ET"
    rows = parse_official_text(text, version)
    games = {}
    for r in rows:
        if not r.get("player") or not r.get("matchup"):
            continue
        stc = STATUS_CN.get(r.get("status") or "", (r.get("status") or "", ""))
        games.setdefault(r["matchup"], []).append({
            "team": r.get("team"), "name": name_cn_order(r["player"]), "status": r.get("status"), "status_cn": stc[0], "cls": stc[1],
            "reason_raw": r.get("reason") or "", "reason_cn": reason_cn(r.get("reason") or ""), "g_league": bool(r.get("is_gleague"))})
    pub = parsedate_to_datetime(lm).astimezone(PT) if lm else None
    seen = datetime.now(PT)
    out = {"source": "NBA 官方伤病报告", "url": url, "version": version, "version_pt": dt.astimezone(PT).strftime("%H:%M"),
           "version_et": dt.strftime("%H:%M"), "published_pt": pub.strftime("%Y-%m-%d %H:%M:%S") if pub else "",
           "fetched_pt": seen.strftime("%Y-%m-%d %H:%M:%S"), "games": games}
    tmp = OUT + ".tmp"; json.dump(out, open(tmp, "w"), ensure_ascii=False, separators=(",", ":")); os.replace(tmp, OUT)
    json.dump({"version": version, "version_dt": dt.isoformat()}, open(STATE, "w"))
    lag = (seen - pub).total_seconds() if pub else None
    print(seen.strftime("%H:%M:%S"), "新版", version, "球员", sum(len(v) for v in games.values()), "场次", len(games),
          "官方发布(Last-Modified)", out["published_pt"], "发布→生成 %.0f 秒" % lag if lag is not None else "")
    return 10


if __name__ == "__main__":
    sys.exit(main())
