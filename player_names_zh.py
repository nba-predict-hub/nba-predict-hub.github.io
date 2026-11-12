#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build / incrementally update player_names_zh.json.

Maps ESPN player IDs to reliable Chinese names. Sources, in order:
  1) NBA China official public JSON (china.nba.cn/stats2/league/playerlist.json)
  2) Hupu public team roster pages (nba.hupu.com/players/<team>)
  3) Tencent Sports public cube/player APIs, if they respond

Existing entries in the output file are kept (en / zh / source are not overwritten).
zh_short is recomputed after every run so same-surname teammates stay unambiguous.

Players that cannot be matched confidently are omitted; the site falls back to English.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from html.parser import HTMLParser
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "player_names_zh.json")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

ESPN_TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams"
ESPN_ROSTER_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster"
)

# The endpoint the china.nba.cn player-index page itself calls
# (see res.nba.cn/scripts/custom.min.js FEEDS_CONFIG.playerList).
CHINA_PLAYERLIST_URLS = [
    "https://china.nba.cn/stats2/league/playerlist.json?locale=zh_CN",
    "https://m.china.nba.cn/stats2/league/playerlist.json?locale=zh_CN",
]

# ESPN abbreviations -> Hupu roster slugs (nba.hupu.com/players/<slug>)
ESPN_TO_HUPU = {
    "ATL": "hawks",
    "BOS": "celtics",
    "BKN": "nets",
    "CHA": "hornets",
    "CHI": "bulls",
    "CLE": "cavaliers",
    "DAL": "mavericks",
    "DEN": "nuggets",
    "DET": "pistons",
    "GS": "warriors",
    "HOU": "rockets",
    "IND": "pacers",
    "LAC": "clippers",
    "LAL": "lakers",
    "MEM": "grizzlies",
    "MIA": "heat",
    "MIL": "bucks",
    "MIN": "timberwolves",
    "NO": "pelicans",
    "NY": "knicks",
    "OKC": "thunder",
    "ORL": "magic",
    "PHI": "76ers",
    "PHX": "suns",
    "POR": "blazers",
    "SAC": "kings",
    "SA": "spurs",
    "TOR": "raptors",
    "UTAH": "jazz",
    "WSH": "wizards",
}

# China official / Hupu / Tencent team codes -> ESPN abbreviation
TEAM_CODE_TO_ESPN = {
    "hawks": "ATL",
    "atlanta hawks": "ATL",
    "atl": "ATL",
    "celtics": "BOS",
    "boston celtics": "BOS",
    "bos": "BOS",
    "nets": "BKN",
    "brooklyn nets": "BKN",
    "bkn": "BKN",
    "hornets": "CHA",
    "charlotte hornets": "CHA",
    "cha": "CHA",
    "bulls": "CHI",
    "chicago bulls": "CHI",
    "chi": "CHI",
    "cavaliers": "CLE",
    "cleveland cavaliers": "CLE",
    "cle": "CLE",
    "mavericks": "DAL",
    "dallas mavericks": "DAL",
    "dal": "DAL",
    "nuggets": "DEN",
    "denver nuggets": "DEN",
    "den": "DEN",
    "pistons": "DET",
    "detroit pistons": "DET",
    "det": "DET",
    "warriors": "GS",
    "golden state warriors": "GS",
    "gsw": "GS",
    "gs": "GS",
    "rockets": "HOU",
    "houston rockets": "HOU",
    "hou": "HOU",
    "pacers": "IND",
    "indiana pacers": "IND",
    "ind": "IND",
    "clippers": "LAC",
    "la clippers": "LAC",
    "los angeles clippers": "LAC",
    "lac": "LAC",
    "lakers": "LAL",
    "la lakers": "LAL",
    "los angeles lakers": "LAL",
    "lal": "LAL",
    "grizzlies": "MEM",
    "memphis grizzlies": "MEM",
    "mem": "MEM",
    "heat": "MIA",
    "miami heat": "MIA",
    "mia": "MIA",
    "bucks": "MIL",
    "milwaukee bucks": "MIL",
    "mil": "MIL",
    "timberwolves": "MIN",
    "minnesota timberwolves": "MIN",
    "min": "MIN",
    "pelicans": "NO",
    "new orleans pelicans": "NO",
    "nop": "NO",
    "no": "NO",
    "knicks": "NY",
    "new york knicks": "NY",
    "nyk": "NY",
    "ny": "NY",
    "thunder": "OKC",
    "oklahoma city thunder": "OKC",
    "okc": "OKC",
    "magic": "ORL",
    "orlando magic": "ORL",
    "orl": "ORL",
    "76ers": "PHI",
    "sixers": "PHI",
    "philadelphia 76ers": "PHI",
    "phi": "PHI",
    "suns": "PHX",
    "phoenix suns": "PHX",
    "phx": "PHX",
    "pho": "PHX",
    "blazers": "POR",
    "trail blazers": "POR",
    "portland trail blazers": "POR",
    "por": "POR",
    "kings": "SAC",
    "sacramento kings": "SAC",
    "sac": "SAC",
    "spurs": "SA",
    "san antonio spurs": "SA",
    "sas": "SA",
    "sa": "SA",
    "raptors": "TOR",
    "toronto raptors": "TOR",
    "tor": "TOR",
    "jazz": "UTAH",
    "utah jazz": "UTAH",
    "uta": "UTAH",
    "utah": "UTAH",
    "wizards": "WSH",
    "washington wizards": "WSH",
    "was": "WSH",
    "wsh": "WSH",
}

# Standalone generational suffixes. "Jrue" is a first name, not a suffix.
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

HAS_CJK = re.compile(r"[\u4e00-\u9fff]")


class FetchError(Exception):
    pass


def log(msg: str) -> None:
    print(msg, flush=True)


def http_get(url: str, *, timeout: int = 25, headers: Optional[dict] = None, retries: int = 3) -> bytes:
    hdrs = {
        "User-Agent": UA,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if headers:
        hdrs.update(headers)
    last: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001 — network errors are retried
            last = exc
            time.sleep(0.6 * (attempt + 1))
    raise FetchError(f"GET {url} failed after {retries} tries: {last}") from last


def load_json_bytes(data: bytes) -> dict:
    return json.loads(data.decode("utf-8"))


# ---------------------------------------------------------------------------
# Name normalization and Chinese typography
# ---------------------------------------------------------------------------

def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def fold_english(name: str) -> str:
    """Lowercase English name with punctuation/accents removed."""
    text = _strip_accents(name or "")
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    text = text.replace(".", "").replace("'", "").replace("`", "")
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    text = text.replace("-", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def drop_suffixes(folded: str) -> str:
    parts = [p for p in folded.split() if p not in SUFFIXES]
    return " ".join(parts) if parts else folded


def name_keys(english: str) -> List[str]:
    """Candidate lookup keys for an English name, most specific first."""
    folded = fold_english(english)
    if not folded:
        return []
    keys: List[str] = []
    compact = folded.replace(" ", "")
    no_suf = drop_suffixes(folded)
    compact_no_suf = no_suf.replace(" ", "")
    for key in (folded, no_suf, compact, compact_no_suf):
        if key and key not in keys:
            keys.append(key)
    # Hyphenated given names: "Karl Anthony Towns" already covered by fold.
    return keys


def normalize_zh(name: str) -> str:
    """Keep the source translation; only normalize the foreign-name separator."""
    text = (name or "").strip()
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    # Hupu uses ASCII hyphen as the mid-dot between Chinese syllables.
    text = text.replace("•", "·").replace("・", "·").replace("．", "·")
    text = re.sub(r"(?<=[A-Za-z0-9\u4e00-\u9fff])-(?=[A-Za-z0-9\u4e00-\u9fff])", "·", text)
    text = re.sub(r"·+", "·", text)
    return text.strip(" ·")


def zh_surname(zh: str) -> str:
    parts = [p for p in zh.split("·") if p]
    if len(parts) >= 2:
        return parts[-1]
    return zh


def looks_like_chinese_name(zh: str) -> bool:
    return bool(zh) and bool(HAS_CJK.search(zh))


# ---------------------------------------------------------------------------
# ESPN rosters
# ---------------------------------------------------------------------------

def fetch_espn_rosters() -> Tuple[List[dict], Dict[str, str]]:
    """Return (players, team_id -> espn abbreviation). Each player:
    {id, en, first, last, team, team_name}
    """
    log("Fetching ESPN team list…")
    raw = http_get(ESPN_TEAMS_URL, headers={"Referer": "https://www.espn.com/nba/"})
    payload = load_json_bytes(raw)
    teams = payload["sports"][0]["leagues"][0]["teams"]
    players: List[dict] = []
    team_ids: Dict[str, str] = {}
    for entry in teams:
        team = entry["team"]
        tid = str(team["id"])
        abbr = team["abbreviation"]
        team_name = team.get("displayName") or abbr
        team_ids[tid] = abbr
        url = ESPN_ROSTER_URL.format(tid=tid)
        try:
            roster = load_json_bytes(http_get(url, headers={"Referer": "https://www.espn.com/nba/"}))
        except FetchError as exc:
            log(f"  WARN ESPN roster {abbr} failed: {exc}")
            continue
        athletes = roster.get("athletes") or []
        # Some payloads nest athletes in position groups with an "items" list.
        flat: List[dict] = []
        for item in athletes:
            if isinstance(item, dict) and "items" in item and isinstance(item["items"], list):
                flat.extend(item["items"])
            else:
                flat.append(item)
        for ath in flat:
            pid = str(ath.get("id") or "")
            en = ath.get("displayName") or ath.get("fullName") or ""
            if not pid or not en:
                continue
            players.append(
                {
                    "id": pid,
                    "en": en,
                    "first": ath.get("firstName") or "",
                    "last": ath.get("lastName") or "",
                    "team": abbr,
                    "team_name": team_name,
                }
            )
        log(f"  ESPN {abbr}: {len(flat)} players")
        time.sleep(0.12)
    log(f"ESPN total: {len(players)} players on {len(team_ids)} teams")
    return players, team_ids


# ---------------------------------------------------------------------------
# NBA China official player list
# ---------------------------------------------------------------------------

def fetch_china_playerlist() -> List[dict]:
    """Official Chinese + English names. Empty list if the public API is down."""
    for url in CHINA_PLAYERLIST_URLS:
        log(f"Trying NBA China official API: {url}")
        try:
            raw = http_get(
                url,
                timeout=20,
                retries=2,
                headers={
                    "Referer": "https://china.nba.cn/players/",
                    "Accept": "application/json, text/plain, */*",
                },
            )
        except FetchError as exc:
            log(f"  failed: {exc}")
            continue
        if not raw.strip():
            log("  empty body, skipping")
            continue
        try:
            payload = load_json_bytes(raw)
        except Exception as exc:  # noqa: BLE001
            log(f"  not JSON ({exc}), skipping")
            continue
        rows = ((payload.get("payload") or {}).get("players")) or []
        if not rows:
            log("  JSON had no players, skipping")
            continue
        out: List[dict] = []
        for row in rows:
            profile = row.get("playerProfile") or {}
            team = row.get("teamProfile") or {}
            zh = normalize_zh(
                profile.get("displayName")
                or profile.get("name")
                or ""
            )
            en = (
                profile.get("displayNameEn")
                or " ".join(
                    p for p in (profile.get("firstNameEn"), profile.get("lastNameEn")) if p
                )
            ).strip()
            if not looks_like_chinese_name(zh) or not en:
                continue
            team_code = (team.get("code") or team.get("displayAbbr") or team.get("nameEn") or "").strip()
            espn_team = resolve_team(team_code) or resolve_team(team.get("nameEn") or "") or resolve_team(team.get("cityEn") or "")
            out.append(
                {
                    "en": en,
                    "zh": zh,
                    "team": espn_team,
                    "source": "NBA中国官网",
                    "nba_id": str(profile.get("playerId") or profile.get("id") or ""),
                }
            )
        log(f"  NBA China official: {len(out)} named players")
        return out
    log("NBA China official API unavailable (no bypass). Falling back.")
    return []


def resolve_team(code: str) -> Optional[str]:
    if not code:
        return None
    key = fold_english(code)
    if not key:
        return None
    return TEAM_CODE_TO_ESPN.get(key) or TEAM_CODE_TO_ESPN.get(code.strip().lower())


# ---------------------------------------------------------------------------
# Hupu roster pages
# ---------------------------------------------------------------------------

class _HupuRosterParser(HTMLParser):
    """Extract (zh, en) pairs from a Hupu team roster table."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: List[dict] = []
        self._in_table = False
        self._in_td = False
        self._in_a = False
        self._in_p = False
        self._in_b = False
        self._td_depth = 0
        self._zh_parts: List[str] = []
        self._en_parts: List[str] = []
        self._capture_zh = False
        self._capture_en = False
        self._current_zh = ""
        self._current_en = ""
        self._td_text: List[str] = []
        self._seen_header = False

    def handle_starttag(self, tag: str, attrs: Sequence[Tuple[str, Optional[str]]]) -> None:
        ad = dict(attrs)
        cls = ad.get("class") or ""
        if tag == "table" and "players_table" in cls:
            self._in_table = True
        if not self._in_table:
            return
        if tag == "tr":
            self._current_zh = ""
            self._current_en = ""
        if tag == "td":
            self._in_td = True
            self._td_depth += 1
            self._td_text = []
        if tag == "a" and self._in_td and not self._current_zh:
            self._capture_zh = True
            self._zh_parts = []
        if tag == "p" and self._in_td:
            self._in_p = True
        if tag == "b" and self._in_p:
            self._capture_en = True
            self._en_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "table" and self._in_table:
            self._in_table = False
        if not self._in_table:
            return
        if tag == "a" and self._capture_zh:
            self._current_zh = "".join(self._zh_parts).strip()
            self._capture_zh = False
        if tag == "b" and self._capture_en:
            self._current_en = "".join(self._en_parts).strip()
            self._capture_en = False
        if tag == "p":
            self._in_p = False
        if tag == "td":
            self._td_depth = max(0, self._td_depth - 1)
            if self._td_depth == 0:
                self._in_td = False
        if tag == "tr":
            zh = self._current_zh
            en = self._current_en
            if zh and en:
                self.rows.append({"zh": zh, "en": en})

    def handle_data(self, data: str) -> None:
        if self._capture_zh:
            self._zh_parts.append(data)
        if self._capture_en:
            self._en_parts.append(data)


def parse_hupu_roster_html(html: str) -> List[dict]:
    parser = _HupuRosterParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        pass
    out: List[dict] = []
    if parser.rows:
        for row in parser.rows:
            zh = normalize_zh(row["zh"])
            en = row["en"].strip()
            # Drop leftover parentheses if any
            en = en.strip("()（） ").strip()
            if looks_like_chinese_name(zh) and fold_english(en):
                out.append({"zh": zh, "en": en})
        return out
    # Regex fallback if the table markup changes slightly
    pattern = re.compile(
        r">([^<>]*[\u4e00-\u9fff][^<>]*)<[^>]*>\s*</b>\s*<p>\s*\(\s*<b>([^<]+)</b>\s*\)",
        re.S,
    )
    for zh, en in pattern.findall(html):
        zh = normalize_zh(zh)
        en = en.strip("()（） ").strip()
        if looks_like_chinese_name(zh) and fold_english(en):
            out.append({"zh": zh, "en": en})
    return out


def fetch_hupu_rosters() -> List[dict]:
    out: List[dict] = []
    for abbr, slug in ESPN_TO_HUPU.items():
        url = f"https://nba.hupu.com/players/{slug}"
        log(f"Fetching Hupu roster {abbr} ({slug})…")
        try:
            raw = http_get(
                url,
                headers={"Referer": "https://nba.hupu.com/players"},
                retries=3,
            )
        except FetchError as exc:
            log(f"  WARN {abbr} failed: {exc}")
            continue
        html = raw.decode("utf-8", errors="replace")
        rows = parse_hupu_roster_html(html)
        for row in rows:
            out.append(
                {
                    "en": row["en"],
                    "zh": row["zh"],
                    "team": abbr,
                    "source": "虎扑",
                }
            )
        log(f"  Hupu {abbr}: {len(rows)} players")
        time.sleep(0.2)
    log(f"Hupu total: {len(out)} named players")
    return out


# ---------------------------------------------------------------------------
# Tencent Sports (optional fallback)
# ---------------------------------------------------------------------------

TENCENT_CANDIDATE_URLS = [
    # Historical official data cube; kept in case it comes back.
    "https://ziliaoku.sports.qq.com/cube/index?cubeId=10&dimId=52&from=sportsdatabase&order=t70&params=t2:2025|t3:1|&limit=0,500",
    "https://ziliaoku.sports.qq.com/cube/index?cubeId=10&dimId=52&from=sportsdatabase&order=t70&params=t2:2026|t3:1|&limit=0,500",
]


def fetch_tencent_players() -> List[dict]:
    out: List[dict] = []
    for url in TENCENT_CANDIDATE_URLS:
        log(f"Trying Tencent Sports API: {url}")
        try:
            raw = http_get(
                url,
                timeout=15,
                retries=2,
                headers={"Referer": "https://nba.stats.qq.com/"},
            )
        except FetchError as exc:
            log(f"  failed: {exc}")
            continue
        try:
            payload = load_json_bytes(raw)
        except Exception:
            log("  not JSON, skipping")
            continue
        data = payload.get("data") or {}
        # Known historical shape: data.nbaPlayerSeasonStatRank is a list
        rows = None
        if isinstance(data, dict):
            for key, val in data.items():
                if isinstance(val, list) and val and isinstance(val[0], dict):
                    sample = val[0]
                    if any(k in sample for k in ("cnName", "cnname", "playerName", "name")):
                        rows = val
                        break
        if not rows:
            log("  no player list in payload, skipping")
            continue
        for row in rows:
            zh = normalize_zh(row.get("cnName") or row.get("cnname") or row.get("name") or "")
            en = (
                row.get("enName")
                or row.get("engName")
                or row.get("playerEnName")
                or row.get("en_name")
                or ""
            ).strip()
            team = resolve_team(row.get("teamName") or row.get("teamEnName") or row.get("team") or "")
            if not looks_like_chinese_name(zh) or not en:
                continue
            out.append({"en": en, "zh": zh, "team": team, "source": "腾讯体育"})
        if out:
            log(f"  Tencent Sports: {len(out)} named players")
            return out
    log("Tencent Sports public list not available.")
    return out


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def index_espn(players: List[dict]) -> Tuple[dict, dict, dict]:
    """Build lookup indexes.

    by_id: espn_id -> player
    by_team_key: (team, key) -> [players]
    by_key: key -> [players]   (league-wide)
    """
    by_id = {p["id"]: p for p in players}
    by_team_key: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    by_key: Dict[str, List[dict]] = defaultdict(list)
    for p in players:
        seen = set()
        for key in name_keys(p["en"]):
            if key in seen:
                continue
            seen.add(key)
            by_team_key[(p["team"], key)].append(p)
            by_key[key].append(p)
    return by_id, by_team_key, by_key


def unique_players(cands: List[dict]) -> List[dict]:
    seen = set()
    out = []
    for p in cands:
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        out.append(p)
    return out


def match_one(
    src: dict,
    by_team_key: dict,
    by_key: dict,
) -> Optional[dict]:
    """Return a single ESPN player if the match is unambiguous, else None."""
    keys = name_keys(src["en"])
    if not keys:
        return None
    team = src.get("team")

    def search(scope_team: Optional[str]) -> Optional[dict]:
        # Try keys from most specific to loosest; accept only a unique hit.
        for key in keys:
            if scope_team:
                cands = unique_players(by_team_key.get((scope_team, key), []))
            else:
                cands = unique_players(by_key.get(key, []))
            if len(cands) == 1:
                return cands[0]
            if len(cands) > 1:
                # Ambiguous at this key. A more specific earlier key would have
                # already returned; do not guess among these.
                return None
        return None

    if team:
        hit = search(team)
        if hit:
            return hit
    # Name is unique league-wide (covers mid-season team disagreements).
    hit = search(None)
    return hit


def apply_matches(
    sources: List[dict],
    espn_players: List[dict],
    mapping: Dict[str, dict],
    used_ids: set,
) -> Tuple[int, int]:
    """Match source rows onto ESPN IDs. Does not overwrite existing IDs.

    Returns (added, skipped_ambiguous_or_unmatched).
    """
    _, by_team_key, by_key = index_espn(espn_players)
    added = 0
    skipped = 0
    for src in sources:
        hit = match_one(src, by_team_key, by_key)
        if not hit:
            skipped += 1
            continue
        pid = hit["id"]
        if pid in mapping or pid in used_ids:
            # Already filled from a higher-priority source (or earlier row).
            continue
        mapping[pid] = {
            "en": hit["en"],
            "zh": src["zh"],
            "zh_short": "",  # filled later
            "source": src["source"],
        }
        used_ids.add(pid)
        added += 1
    return added, skipped


def fill_zh_short(mapping: Dict[str, dict], espn_players: List[dict]) -> None:
    id_to_team = {p["id"]: p["team"] for p in espn_players}
    # Group current-roster teammates that we successfully named.
    by_team: Dict[str, List[str]] = defaultdict(list)
    for pid, row in mapping.items():
        team = id_to_team.get(pid)
        if team:
            by_team[team].append(pid)
        row["zh_short"] = zh_surname(row["zh"]) or row["zh"]

    for team, pids in by_team.items():
        surname_counts: Dict[str, int] = defaultdict(int)
        for pid in pids:
            surname_counts[mapping[pid]["zh_short"]] += 1
        for pid in pids:
            short = mapping[pid]["zh_short"]
            if surname_counts[short] > 1:
                mapping[pid]["zh_short"] = mapping[pid]["zh"]


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def load_existing(path: str) -> Dict[str, dict]:
    if not os.path.isfile(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return {}
    cleaned: Dict[str, dict] = {}
    for pid, row in data.items():
        if not isinstance(row, dict):
            continue
        zh = str(row.get("zh") or "").strip()
        en = str(row.get("en") or "").strip()
        if not pid or not looks_like_chinese_name(zh):
            continue
        cleaned[str(pid)] = {
            "en": en,
            "zh": zh,
            "zh_short": str(row.get("zh_short") or ""),
            "source": str(row.get("source") or ""),
        }
    return cleaned


def save_mapping(path: str, mapping: Dict[str, dict]) -> None:
    ordered = {k: mapping[k] for k in sorted(mapping, key=lambda x: int(x) if x.isdigit() else x)}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(ordered, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def report(
    mapping: Dict[str, dict],
    espn_players: List[dict],
    source_counts: Dict[str, int],
) -> None:
    total = len(espn_players)
    covered = sum(1 for p in espn_players if p["id"] in mapping)
    missing = [p for p in espn_players if p["id"] not in mapping]
    log("")
    log(f"Coverage: {covered}/{total} current-roster players have a Chinese name")
    log("Sources used:")
    for src, n in source_counts.items():
        log(f"  {src}: {n}")
    # On-roster extras in the file (kept from earlier runs, no longer on a roster)
    extra = [pid for pid in mapping if pid not in {p["id"] for p in espn_players}]
    if extra:
        log(f"Kept {len(extra)} previously mapped player(s) not on this season's ESPN rosters")

    # Sample: prefer Warriors / Rockets well-known names
    wanted = [
        ("Stephen Curry", "GS"),
        ("Draymond Green", "GS"),
        ("Al Horford", "GS"),
        ("Jimmy Butler III", "GS"),
        ("Alperen Sengun", "HOU"),
        ("Jabari Smith Jr.", "HOU"),
        ("Amen Thompson", "HOU"),
        ("Luka Doncic", "LAL"),
        ("Nikola Jokic", "DEN"),
        ("Shai Gilgeous-Alexander", "OKC"),
    ]
    log("")
    log("Spot checks:")
    shown = 0
    id_index = {(p["en"], p["team"]): p for p in espn_players}
    for en, team in wanted:
        p = id_index.get((en, team))
        if not p:
            # try loose
            cands = [x for x in espn_players if x["en"] == en]
            p = cands[0] if len(cands) == 1 else None
        if not p:
            log(f"  {en} ({team}): not on ESPN roster")
            continue
        row = mapping.get(p["id"])
        if not row:
            log(f"  {en} ({team}, ESPN {p['id']}): NOT COVERED")
            continue
        log(
            f"  ESPN {p['id']}: {row['en']} -> {row['zh']} / {row['zh_short']}  [{row['source']}]"
        )
        shown += 1
    # Pad to ~10 with more Warriors / Rockets if needed
    if shown < 10:
        for p in espn_players:
            if p["team"] not in {"GS", "HOU"}:
                continue
            if p["id"] not in mapping:
                continue
            if any(p["en"] == en for en, _ in wanted):
                continue
            row = mapping[p["id"]]
            log(
                f"  ESPN {p['id']}: {row['en']} -> {row['zh']} / {row['zh_short']}  [{row['source']}]"
            )
            shown += 1
            if shown >= 10:
                break

    log("")
    log(f"Uncovered this run: {len(missing)} players")
    if missing:
        by_team: Dict[str, List[str]] = defaultdict(list)
        for p in missing:
            by_team[p["team"]].append(p["en"])
        for team in sorted(by_team):
            names = ", ".join(by_team[team])
            log(f"  {team} ({len(by_team[team])}): {names}")


def main() -> int:
    existing = load_existing(OUTPUT_PATH)
    log(f"Existing entries: {len(existing)} ({OUTPUT_PATH})")

    espn_players, _ = fetch_espn_rosters()
    if not espn_players:
        log("ERROR: could not load ESPN rosters")
        return 1

    mapping: Dict[str, dict] = dict(existing)
    used_ids = set(mapping.keys())

    # Priority 1: official NBA China list
    china = fetch_china_playerlist()
    added_china, _ = apply_matches(china, espn_players, mapping, used_ids)
    log(f"Added from NBA China official: {added_china}")

    # Priority 2: Hupu
    hupu = fetch_hupu_rosters()
    added_hupu, skipped_hupu = apply_matches(hupu, espn_players, mapping, used_ids)
    log(f"Added from Hupu: {added_hupu} (Hupu rows not uniquely matched: {skipped_hupu})")

    # Priority 3: Tencent, only for remaining gaps
    if any(p["id"] not in mapping for p in espn_players):
        tencent = fetch_tencent_players()
        added_tx, _ = apply_matches(tencent, espn_players, mapping, used_ids)
        log(f"Added from Tencent Sports: {added_tx}")
    else:
        log("No gaps left for Tencent Sports fallback.")

    fill_zh_short(mapping, espn_players)
    save_mapping(OUTPUT_PATH, mapping)

    source_counts: Dict[str, int] = defaultdict(int)
    espn_ids = {p["id"] for p in espn_players}
    for pid, row in mapping.items():
        if pid in espn_ids:
            source_counts[row.get("source") or "未知"] += 1
    report(mapping, espn_players, source_counts)
    log(f"\nWrote {OUTPUT_PATH} ({len(mapping)} entries).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
