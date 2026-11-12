#!/usr/bin/env bash
# 定时运行：重新导出 data.json，并在有变化时推送到 GitHub Pages。
# 例：crontab  */10 * * * *  /workspace/nba_site/update.sh >> /tmp/nba_site_update.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
python3 export.py
# 雷速 ID：最多每 30 分钟跑一次；失败不影响其他导出
STAMP=.leisu_last_run
if [ ! -f "$STAMP" ] || [ $(( $(date +%s) - $(stat -c %Y "$STAMP") )) -ge 1800 ]; then
  touch "$STAMP"
  timeout 120 python3 leisu_ids.py || echo "leisu_ids.py 失败（忽略）" >&2
fi
# 球员中文名：每天最多跑一次（增量），失败不影响其他导出
NSTAMP=.names_last_run
if [ -f player_names_zh.py ] && { [ ! -f "$NSTAMP" ] || [ $(( $(date +%s) - $(stat -c %Y "$NSTAMP") )) -ge 86400 ]; }; then
  touch "$NSTAMP"
  timeout 600 python3 player_names_zh.py >/dev/null 2>&1 || echo "player_names_zh.py 失败（忽略）" >&2
fi
# NBA 官方头像编号：每天最多跑一次，失败不影响其他导出
ISTAMP=.nbaids_last_run
if [ -f nba_ids.py ] && [ -f player_names_zh.json ] && { [ ! -f "$ISTAMP" ] || [ $(( $(date +%s) - $(stat -c %Y "$ISTAMP") )) -ge 86400 ]; }; then
  touch "$ISTAMP"
  timeout 180 python3 nba_ids.py >/dev/null 2>&1 || echo "nba_ids.py 失败（忽略）" >&2
fi
if [ -d .git ]; then
  git add data.json leisu_ids.json
  [ -f player_names_zh.json ] && git add player_names_zh.json
  [ -f nba_ids.json ] && git add nba_ids.json
  if ! git diff --cached --quiet; then
    git commit -m "data: $(date '+%Y-%m-%d %H:%M %Z')" && git push
  fi
fi
