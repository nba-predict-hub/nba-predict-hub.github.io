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
if [ -d .git ]; then
  git add data.json leisu_ids.json
  if ! git diff --cached --quiet; then
    git commit -m "data: $(date '+%Y-%m-%d %H:%M %Z')" && git push
  fi
fi
