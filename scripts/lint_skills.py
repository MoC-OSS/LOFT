#!/usr/bin/env python3
"""Lint plugin skills, commands, agents and path references in this marketplace.

Usage: python3 scripts/lint_skills.py [--plugin NAME ...] [--exclude NAME ...] [--strict]
Plugin names are the marketplace names from .claude-plugin/marketplace.json.
Exit codes: 0 clean, 1 errors (or warnings with --strict), 2 usage/setup problem.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import NamedTuple

try:
    import yaml
except ImportError:
    print("PyYAML is required: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

ALLOWED_KEYS = {
    "name", "description", "when_to_use", "argument-hint", "arguments",
    "disable-model-invocation", "user-invocable", "allowed-tools", "disallowed-tools",
    "model", "effort", "context", "agent", "background", "hooks", "paths", "shell",
    "metadata", "license", "compatibility",
}
NAME_RE = re.compile(r"^[a-z0-9-]{1,64}$")
RESERVED = ("anthropic", "claude")
TAG_RE = re.compile(r"<[A-Za-z][^<>]*>")
PERSON_RE = re.compile(r"\bI can\b|\byou can\b(?!')|^You ", re.IGNORECASE | re.MULTILINE)
_EXT = r"\.(?:md|py|sh|json|ya?ml|mjs|css|html|txt)"
_BODY = r"[A-Za-z0-9_./-]+"
_LB = r"(?<![A-Za-z0-9./${}-])"
# Alternatives: ${VAR}/<any path>, ./ or ../ relative path, bare references|agents|scripts|templates path.
# '*' and '_' are boundaries (markdown emphasis); '_' inside a file name is still part of the token.
PATH_RE = re.compile(
    r"(?:\$\{CLAUDE_(?P<var>PLUGIN_ROOT|SKILL_DIR)\}/(?P<pre>" + _BODY + _EXT + r")"
    r"|" + _LB + r"(?P<rel>\.{1,2}/" + _BODY + _EXT + r")"
    r"|" + _LB + r"(?P<bare>(?:references|agents|scripts|templates)/" + _BODY + _EXT + r"))"
    r"(?![A-Za-z0-9<{])"
)
TOC_RE = re.compile(r"^##\s+(Contents|Table of contents)\b", re.IGNORECASE)


class Finding(NamedTuple):
    path: Path
    line: int
    level: str
    code: str
    message: str


def split_frontmatter(text: str) -> tuple[dict | None, int]:
    """Return (frontmatter dict or None, number of file lines the frontmatter occupies)."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, 0
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            try:
                data = yaml.safe_load("\n".join(lines[1:i]))
            except yaml.YAMLError:
                return None, 0
            if not isinstance(data, dict):
                return None, 0
            return data, i + 1
    return None, 0


def key_line(text: str, key: str) -> int:
    for n, line in enumerate(text.split("\n"), 1):
        if line.startswith(f"{key}:"):
            return n
        if n > 1 and line.strip() == "---":
            break
    return 1


def body_lines(text: str, fm_len: int) -> list[str]:
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    return lines[fm_len:]


def lint_skill(skill_md: Path) -> list[Finding]:
    out: list[Finding] = []
    text = skill_md.read_text(encoding="utf-8")
    fm, fm_len = split_frontmatter(text)
    if fm is None:
        return [Finding(skill_md, 1, "error", "SK001", "missing or unparseable YAML frontmatter")]
    dirname = skill_md.parent.name
    name = fm.get("name")
    nline = key_line(text, "name")
    if not isinstance(name, str) or not NAME_RE.match(name):
        out.append(Finding(skill_md, nline, "error", "SK002", f"invalid name {name!r} (need ^[a-z0-9-]{{1,64}}$)"))
    elif name != dirname:
        out.append(Finding(skill_md, nline, "error", "SK002", f"name {name!r} does not match directory {dirname!r}"))
    elif any(r in name for r in RESERVED):
        out.append(Finding(skill_md, nline, "error", "SK002", f"name {name!r} contains a reserved word"))
    desc = fm.get("description")
    dline = key_line(text, "description")
    desc_s = desc if isinstance(desc, str) else ""
    if desc is not None and not isinstance(desc, str):
        out.append(Finding(skill_md, dline, "error", "SK003", "description must be a string"))
    elif not desc_s.strip():
        out.append(Finding(skill_md, dline, "error", "SK003", "description is empty"))
    else:
        if len(desc_s) > 1024:
            out.append(Finding(skill_md, dline, "error", "SK003", f"description is {len(desc_s)} chars (max 1024)"))
        if TAG_RE.search(desc_s):
            out.append(Finding(skill_md, dline, "error", "SK003", "description contains an XML-like <tag>"))
        if PERSON_RE.search(desc_s):
            out.append(Finding(skill_md, dline, "warning", "SK007", "description uses first/second person; use third person or imperative"))
    wtu = fm.get("when_to_use")
    combined = len(desc_s) + (len(wtu) if isinstance(wtu, str) else 0)
    if combined > 1536:
        out.append(Finding(skill_md, dline, "error", "SK004", f"description + when_to_use is {combined} chars (max 1536)"))
    for key in fm:
        if key not in ALLOWED_KEYS:
            out.append(Finding(skill_md, key_line(text, str(key)), "error", "SK005", f"unknown frontmatter key '{key}'"))
    n_body = len(body_lines(text, fm_len))
    if n_body >= 500:
        out.append(Finding(skill_md, fm_len + 1, "error", "SK006", f"body is {n_body} lines (must be < 500)"))
    return out


def lint_simple_frontmatter(path: Path, required: tuple[str, ...], code: str) -> list[Finding]:
    fm, _ = split_frontmatter(path.read_text(encoding="utf-8"))
    fm = fm or {}
    missing = [k for k in required if not (isinstance(fm.get(k), str) and fm[k].strip())]
    if missing:
        return [Finding(path, 1, "error", code, f"missing frontmatter {', '.join(missing)}")]
    return []


def enclosing_skill_dir(path: Path, plugin_dir: Path) -> Path:
    rel = path.relative_to(plugin_dir).parts
    if len(rel) >= 3 and rel[0] == "skills":
        return plugin_dir / "skills" / rel[1]
    return path.parent


def lint_paths(path: Path, plugin_dir: Path) -> list[Finding]:
    out: list[Finding] = []
    skill_dir = enclosing_skill_dir(path, plugin_dir)
    for n, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if ".claude/scripts/" in line:
            out.append(Finding(path, n, "error", "PA003", "references .claude/scripts/ (not available in an installed plugin)"))
        for m in PATH_RE.finditer(line):
            if m.group("var"):
                base = plugin_dir if m.group("var") == "PLUGIN_ROOT" else skill_dir
                rel = m.group("pre")
                if not (base / rel).exists():
                    out.append(Finding(path, n, "error", "PA001", f"${{CLAUDE_{m.group('var')}}}/{rel} does not exist"))
            elif m.group("rel"):
                rel = m.group("rel")
                if not (path.parent / rel).exists():
                    out.append(Finding(path, n, "error", "PA001", f"relative path does not resolve: {rel}"))
            else:
                rel = m.group("bare")
                if not (path.parent / rel).exists() and (plugin_dir / rel).exists():
                    out.append(Finding(path, n, "error", "PA002", f"bare path '{rel}' does not resolve from this file; prefix with ${{CLAUDE_PLUGIN_ROOT}}/"))
    return out


def toc_exempt(path: Path, plugin_dir: Path) -> bool:
    rel = path.relative_to(plugin_dir)
    if any(p in ("templates", "styling") for p in rel.parts[:-1]):
        return True
    low = path.name.lower()
    return "template" in low or "example" in low


def lint_reference(path: Path, plugin_dir: Path) -> list[Finding]:
    if toc_exempt(path, plugin_dir):
        return []
    text = path.read_text(encoding="utf-8")
    _, fm_len = split_frontmatter(text)
    lines = body_lines(text, fm_len)
    if len(lines) <= 100:
        return []
    if any(TOC_RE.match(line) for line in lines[:40]):
        return []
    return [Finding(path, fm_len + 1, "warning", "RF001", f"{len(lines)} lines without '## Contents' in the first 40 lines")]


def lint_plugin(plugin_dir: Path, marketplace_version: str | None) -> list[Finding]:
    plugin_dir = Path(plugin_dir)
    out: list[Finding] = []
    scanned: list[Path] = []

    for f in sorted(plugin_dir.glob("skills/*/SKILL.md")):
        out += lint_skill(f)
        scanned.append(f)
    refs = sorted(
        set(plugin_dir.glob("skills/*/references/**/*.md")) | set(plugin_dir.glob("references/**/*.md"))
    )
    for f in refs:
        out += lint_reference(f, plugin_dir)
        scanned.append(f)
    for f in sorted(plugin_dir.glob("commands/*.md")):
        out += lint_simple_frontmatter(f, ("description",), "CM001")
        scanned.append(f)
    for f in sorted(plugin_dir.glob("agents/*.md")):
        out += lint_simple_frontmatter(f, ("name", "description"), "AG001")
        scanned.append(f)
    for f in scanned:
        out += lint_paths(f, plugin_dir)

    pj = plugin_dir / ".claude-plugin" / "plugin.json"
    if not pj.exists():
        out.append(Finding(pj, 1, "error", "VS001", "plugin.json missing"))
    elif marketplace_version is not None:
        try:
            version = json.loads(pj.read_text(encoding="utf-8")).get("version")
        except json.JSONDecodeError:
            version = None
        if version != marketplace_version:
            out.append(Finding(pj, 1, "error", "VS001", f"plugin.json version {version!r} != marketplace.json version {marketplace_version!r}"))
    return sorted(out, key=lambda f: (str(f.path), f.line, f.code))


def main(argv: list[str] | None = None, root: Path | None = None) -> int:
    root = Path(root) if root else Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--plugin", nargs="+", default=[], metavar="NAME", help="only these marketplace plugin names")
    ap.add_argument("--exclude", nargs="+", default=[], metavar="NAME", help="skip these marketplace plugin names")
    ap.add_argument("--strict", action="store_true", help="warnings fail the run")
    args = ap.parse_args(argv)

    mp = root / ".claude-plugin" / "marketplace.json"
    try:
        entries = json.loads(mp.read_text(encoding="utf-8"))["plugins"]
    except (OSError, KeyError, json.JSONDecodeError) as e:
        print(f"cannot read {mp}: {e}", file=sys.stderr)
        return 2
    known = {e["name"] for e in entries}
    unknown = [n for n in args.plugin + args.exclude if n not in known]
    if unknown:
        print(f"unknown plugin name(s): {', '.join(unknown)}; known: {', '.join(sorted(known))}", file=sys.stderr)
        return 2

    findings: list[Finding] = []
    for e in entries:
        if (args.plugin and e["name"] not in args.plugin) or e["name"] in args.exclude:
            continue
        pdir = root / e["source"]
        if not pdir.is_dir():
            print(f"plugin directory missing: {pdir}", file=sys.stderr)
            return 2
        findings += lint_plugin(pdir, e.get("version"))
    findings.sort(key=lambda f: (str(f.path), f.line, f.code))

    for f in findings:
        try:
            shown = f.path.relative_to(root)
        except ValueError:
            shown = f.path
        print(f"{shown}:{f.line}: {f.level} {f.code} {f.message}")
    errors = sum(f.level == "error" for f in findings)
    warnings = len(findings) - errors
    print(f"{errors} error(s), {warnings} warning(s)", file=sys.stderr)
    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
