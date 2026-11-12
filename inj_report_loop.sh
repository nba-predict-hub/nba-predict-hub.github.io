#!/usr/bin/env bash
# 每 60 秒探测 NBA 官方伤病报告新版；有新版就生成 injury_report.json 并只提交这个文件。
# 和 update.sh 共用 .git_push.lock（flock），避免同时 git 提交冲突。日志：/tmp/inj_report_loop.log
cd /workspace/nba_site || exit 1
while true; do
  python3 nba_injury_report.py >> /tmp/inj_report_loop.log 2>&1
  rc=$?
  if [ "$rc" = "10" ]; then
    (
      flock -w 120 9 || exit 0
      git add injury_report.json
      if ! git diff --cached --quiet -- injury_report.json; then
        git commit -q -m "injury report: $(date '+%H:%M:%S %Z')" -- injury_report.json && git push -q && echo "$(date '+%H:%M:%S') 已推送 injury_report.json" >> /tmp/inj_report_loop.log
      fi
    ) 9>/workspace/nba_site/.git_push.lock
  fi
  sleep 60
done
