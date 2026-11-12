#!/bin/sh
# 按静态资源内容自动生成版本号，写进 index.html 的 ?v=，避免新页面配旧脚本（缓存不一致）。
# 作为 git pre-commit 钩子运行：用“将要提交的”文件内容算哈希，同时改暂存区和工作区的 index.html。
cd "$(git rev-parse --show-toplevel)" || exit 0
FILES="style.css app.js pbp.js anim.js voice.js"
git diff --cached --name-only | grep -qE '^(style\.css|app\.js|pbp\.js|anim\.js|voice\.js|index\.html|sw\.js|manifest\.json|icons/.*)$' || exit 0
# 图标、启动图也算进版本号：换图后链接的 ?v= 跟着变，绕过 iOS / 浏览器对旧图的缓存
V=$( (for f in $FILES; do git show ":$f" 2>/dev/null; done; git ls-files -s icons | cut -d' ' -f2; for f in index.html manifest.json; do git show ":$f" | sed -E "s/\?v=[A-Za-z0-9]+\"/\"/g"; done) | sha1sum | cut -c1-10)
blob=$(git show :index.html | sed -E "s/\?v=[A-Za-z0-9]+\"/?v=$V\"/g" | git hash-object -w --stdin)
git update-index --cacheinfo 100644,"$blob",index.html
sed -i -E "s/\?v=[A-Za-z0-9]+\"/?v=$V\"/g" index.html
# manifest.json 里的图标地址同样带版本号
if git show :manifest.json >/dev/null 2>&1; then
  mblob=$(git show :manifest.json | sed -E "s/\?v=[A-Za-z0-9]+\"/?v=$V\"/g" | git hash-object -w --stdin)
  git update-index --cacheinfo 100644,"$mblob",manifest.json
  sed -i -E "s/\?v=[A-Za-z0-9]+\"/?v=$V\"/g" manifest.json
fi
# 每个本地脚本/样式都必须带版本号
if git show :index.html | grep -E '(src|href)="(style\.css|app\.js|pbp\.js|anim\.js|voice\.js)"' >/dev/null; then
  echo "index.html 里有没带 ?v= 的脚本或样式，拒绝提交" >&2; exit 1
fi
# 页面每分钟读 version.json，发现网站代码有新版本就在空闲时自动刷新（数据文件更新不会改这个文件）
printf '{"v":"%s"}\n' "$V" > version.json
git add version.json
# Service Worker 带同一个版本号：文件内容变了，浏览器会立刻装新的 SW（它会 skipWaiting 立即接管）
sed -i -E "s/^var VER = \"[^\"]*\";/var VER = \"$V\";/" sw.js
git add sw.js
echo "版本号 v=$V"
