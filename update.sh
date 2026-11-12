#!/usr/bin/env bash
# 定时运行：重新导出 data.json，并在有变化时推送到 GitHub Pages。
# 例：crontab  */10 * * * *  /workspace/nba_site/update.sh >> /tmp/nba_site_update.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
python3 export.py
if [ -d .git ]; then
  git add data.json leisu_ids.json
  if ! git diff --cached --quiet; then
    git commit -m "data: $(date '+%Y-%m-%d %H:%M %Z')" && git push
  fi
fi
