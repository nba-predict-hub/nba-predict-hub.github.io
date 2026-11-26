#!/usr/bin/env python3
"""V9 开盘锁定前向测试账本 -> 网站 openlock.json（只读、不编造；失败写空）。"""
import csv, json, os, sys
from datetime import datetime, timedelta, timezone
PT=timezone(timedelta(hours=-8)); ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC="/workspace/nba_model/v9p/open_lock_ledger.csv"; OUT=os.path.join(ROOT,"openlock.json")
sys.path.insert(0,"/workspace/nba_model")
try: from teams import ABBR_TO_CN
except Exception: ABBR_TO_CN={}
REASON={"quote_is_logger_baseline_not_true_open":"记录器刚启动，这条盘口不是真正的开盘价",
 "logger_gap_not_true_open":"记录器中断过，首次看到的盘口不是真正开盘价",
 "tip_already_passed_before_lock":"发现盘口时已经开赛",
 "game_not_in_ids_file":"比赛编号表里没有这场",
 "features_missing_or_open_mismatch":"特征缺失或开盘价对不上",
 "rapm_inputs_missing_asof":"球员影响数据缺失",
 "pipeline_failed_4_attempts":"计算连续失败 4 次"}
def cn(t): return ABBR_TO_CN.get(t,t)
def why(r):
    s=r.get("skip_reason","")
    if s.startswith("data_build_after_quote"): return "数据在盘口出现之后才更新，防偷看，跳过"
    return REASON.get(s,s or "")
def main():
    rows=[]
    if os.path.exists(SRC):
        for r in csv.DictReader(open(SRC,newline="",encoding="utf-8-sig")):
            flags=r.get("risk_flags","")
            rows.append(dict(game_date=r.get("game_date",""),game=f"{cn(r['away'])} @ {cn(r['home'])}",status=r.get("status",""),
              reason=why(r),tier=r.get("tier",""),pick=cn(r.get("pick_team","")),line=r.get("pick_line",""),lock_time=r.get("lock_time_pt",""),
              guard_info=("GUARD_B_WOULD_SKIP_INFO" in flags),flags=flags))
    locked=sum(1 for r in rows if r["status"]=="LOCKED")
    json.dump(dict(generated_at=datetime.now(PT).strftime("%Y-%m-%d %H:%M:%S PT"),exists=os.path.exists(SRC),locked=locked,skipped=len(rows)-locked,rows=rows[-30:][::-1]),
      open(OUT+".tmp","w",encoding="utf-8"),ensure_ascii=False,indent=1); os.replace(OUT+".tmp",OUT)
if __name__=="__main__":
    try: main()
    except Exception as ex: print("openlock 同步失败：",ex,file=sys.stderr)
