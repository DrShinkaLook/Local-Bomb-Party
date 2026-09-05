#!/usr/bin/env python3
"""
Expand a Hunspell .dic/.aff pair into a flat word list.

Source dictionary: SCOWL (Spell Checker Oriented Word Lists) en_US, by Kevin
Atkinson. Distributed under a permissive "use, copy, modify, distribute and
sell" grant requiring only that the copyright notice be preserved. See
data/LICENSE-DICTIONARY.txt for the full notice.

This is a *stem + affix* expansion, not a scrape of anyone's service. It is the
same transformation `unmunch(1)` performs, reimplemented here so the build has
no external tool dependency.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field


@dataclass
class Rule:
    strip: str
    add: str
    condition: str
    regex: re.Pattern | None


@dataclass
class RuleSet:
    cross_product: bool = False
    rules: list[Rule] = field(default_factory=list)


def parse_aff(path: str) -> tuple[dict[str, RuleSet], dict[str, RuleSet]]:
    prefixes: dict[str, RuleSet] = {}
    suffixes: dict[str, RuleSet] = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()

    i = 0
    while i < len(lines):
        parts = lines[i].split()
        i += 1
        if not parts or parts[0] not in ("PFX", "SFX"):
            continue
        kind, flag = parts[0], parts[1]
        # Header line: PFX flag cross_product count
        if len(parts) < 4:
            continue
        cross = parts[2].upper() == "Y"
        try:
            count = int(parts[3])
        except ValueError:
            continue
        target = prefixes if kind == "PFX" else suffixes
        rs = target.setdefault(flag, RuleSet(cross_product=cross))
        rs.cross_product = cross

        for _ in range(count):
            if i >= len(lines):
                break
            body = lines[i].split()
            i += 1
            if len(body) < 4 or body[0] != kind or body[1] != flag:
                continue
            strip = "" if body[2] == "0" else body[2]
            add = "" if body[3] == "0" else body[3].split("/")[0]
            cond = body[4] if len(body) > 4 else "."
            regex = compile_condition(cond, kind)
            rs.rules.append(Rule(strip=strip, add=add, condition=cond, regex=regex))
    return prefixes, suffixes


def compile_condition(cond: str, kind: str) -> re.Pattern | None:
    if cond == ".":
        return None
    try:
        return re.compile(cond + "$" if kind == "SFX" else "^" + cond)
    except re.error:
        return None


def apply_suffix(stem: str, rule: Rule) -> str | None:
    if rule.regex is not None and not rule.regex.search(stem):
        return None
    if rule.strip and not stem.endswith(rule.strip):
        return None
    base = stem[: len(stem) - len(rule.strip)] if rule.strip else stem
    if not base:
        return None
    return base + rule.add


def apply_prefix(stem: str, rule: Rule) -> str | None:
    if rule.regex is not None and not rule.regex.search(stem):
        return None
    if rule.strip and not stem.startswith(rule.strip):
        return None
    base = stem[len(rule.strip):] if rule.strip else stem
    if not base:
        return None
    return rule.add + base


WORD_RE = re.compile(r"^[a-z]+$")


def expand(dic_path: str, aff_path: str, min_len: int) -> set[str]:
    prefixes, suffixes = parse_aff(aff_path)
    out: set[str] = set()

    with open(dic_path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read().splitlines()

    # First line is the (approximate) entry count.
    entries = raw[1:] if raw and raw[0].strip().isdigit() else raw

    def emit(word: str) -> None:
        w = word.lower()
        if len(w) >= min_len and WORD_RE.match(w):
            out.add(w)

    for line in entries:
        line = line.split("\t")[0].strip()
        if not line or line.startswith("#"):
            continue
        if "/" in line:
            stem, flags = line.split("/", 1)
            flags = flags.split()[0] if flags.split() else ""
        else:
            stem, flags = line, ""
        stem = stem.strip()
        if not stem:
            continue
        emit(stem)

        pfx_forms: list[str] = []
        sfx_forms: list[str] = []

        for flag in flags:
            if flag in prefixes:
                for rule in prefixes[flag].rules:
                    res = apply_prefix(stem, rule)
                    if res:
                        emit(res)
                        if prefixes[flag].cross_product:
                            pfx_forms.append(res)
            if flag in suffixes:
                for rule in suffixes[flag].rules:
                    res = apply_suffix(stem, rule)
                    if res:
                        emit(res)
                        if suffixes[flag].cross_product:
                            sfx_forms.append(res)

        # Cross product: prefix applied to each suffixed form.
        for flag in flags:
            if flag not in prefixes or not prefixes[flag].cross_product:
                continue
            for rule in prefixes[flag].rules:
                for sf in sfx_forms:
                    res = apply_prefix(sf, rule)
                    if res:
                        emit(res)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dic", default="/usr/share/hunspell/en_US.dic")
    ap.add_argument("--aff", default="/usr/share/hunspell/en_US.aff")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-len", type=int, default=2)
    args = ap.parse_args()

    words = expand(args.dic, args.aff, args.min_len)
    ordered = sorted(words)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(ordered))
        fh.write("\n")
    print(f"expanded {len(ordered)} words -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
