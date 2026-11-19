#!/usr/bin/env python3
"""把 /workspace/nba_model/leaderboard/leaderboard.json 同步成网站根目录 leaderboard.json。
源文件不存在或读失败时：保留网站上已有文件；没有旧文件才写空结构 []。不报错、不编造数据。
"""
from __future__ import annotations
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("LEADERBOARD_SRC") or "/workspace/nba_model/leaderboard/leaderboard.json"
OUT = os.environ.get("LEADERBOARD_OUT") or os.path.join(ROOT, "leaderboard.json")
EMPTY = []


def write(obj):
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, OUT)


def keep_or_empty(reason):
    if os.path.exists(OUT) and os.path.getsize(OUT) > 0:
        print("leaderboard.json：%s，保留网站现有文件" % reason, file=sys.stderr)
        return
    write(EMPTY)
    print("leaderboard.json：%s，已写空结构" % reason, file=sys.stderr)


def main():
    if not os.path.exists(SRC):
        keep_or_empty("源文件不存在")
        return 0
    try:
        if os.path.getsize(SRC) == 0:
            keep_or_empty("源文件为空")
            return 0
        with open(SRC, encoding="utf-8-sig") as f:
            data = json.load(f)
        if not isinstance(data, (list, dict)):
            keep_or_empty("源文件格式不对")
            return 0
        write(data)
    except Exception as ex:
        print("leaderboard.json 读取失败（保留旧文件或写空）：", ex, file=sys.stderr)
        keep_or_empty("读取失败")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:
        print("leaderboard 同步失败（忽略）：", ex, file=sys.stderr)
        try:
            keep_or_empty("同步失败")
        except Exception:
            pass
        sys.exit(0)
