#!/bin/sh
# 按静态资源内容自动生成版本号，写进 index.html 的 ?v=，避免新页面配旧脚本（缓存不一致）。
# 作为 git pre-commit 钩子运行：用“将要提交的”文件内容算哈希，同时改暂存区和工作区的 index.html。
cd "$(git rev-parse --show-toplevel)" || exit 0
FILES="style.css app.js pbp.js anim.js voice.js"
git diff --cached --name-only | grep -qE '^(style\.css|app\.js|pbp\.js|anim\.js|voice\.js|index\.html)$' || exit 0
V=$(for f in $FILES; do git show ":$f" 2>/dev/null; done | sha1sum | cut -c1-10)
blob=$(git show :index.html | sed -E "s/\?v=[A-Za-z0-9]+\"/?v=$V\"/g" | git hash-object -w --stdin)
git update-index --cacheinfo 100644,"$blob",index.html
sed -i -E "s/\?v=[A-Za-z0-9]+\"/?v=$V\"/g" index.html
# 每个本地脚本/样式都必须带版本号
if git show :index.html | grep -E '(src|href)="(style\.css|app\.js|pbp\.js|anim\.js|voice\.js)"' >/dev/null; then
  echo "index.html 里有没带 ?v= 的脚本或样式，拒绝提交" >&2; exit 1
fi
echo "版本号 v=$V"
