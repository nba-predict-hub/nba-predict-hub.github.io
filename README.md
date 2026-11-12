# NBA 智能预测 · 静态网站

纯 HTML/CSS/JS，可直接放 GitHub Pages。页面每 60 秒拉一次 `data.json?t=时间戳` 自动刷新。

- `export.py`：从 `/workspace/nba_model` 的真实输出生成 `data.json`（只读，不改模型输出；缺的字段写 null 并在 `missing` 里写“缺”）。
  - 自动识别 `live_ledger.csv` 里的模型版本号（`v5_…`、`v6_…`），取最大版本；同版本内按 `MAIN_MODEL_PREF`（默认 `stack,fusion,融合,selected`）选主结论。
  - 本版本真实对错只来自台账 `result` 列；为空就显示“缺”。
- `update.sh`：重新导出并（若本目录是 git 仓库）提交、推送 `data.json`。
- 本地预览：`python3 -m http.server 8000`，打开 http://localhost:8000/

数据来源见页面最下方“数据来源”。页面不含任何个人信息。
