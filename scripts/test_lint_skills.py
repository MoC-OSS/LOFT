import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import lint_skills  # noqa: E402
from lint_skills import lint_plugin  # noqa: E402

GOOD_SKILL = """---
name: demo
description: Demonstrates things. Use when testing the linter.
---
# Demo

Body.
"""


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def make_plugin(root: Path, skill: str = GOOD_SKILL, version: str = "1.0.0") -> Path:
    p = root / "plugins" / "demo-plugin"
    write(p / ".claude-plugin" / "plugin.json", json.dumps({"name": "demo-plugin", "version": version}))
    write(p / "skills" / "demo" / "SKILL.md", skill)
    write(p / "references" / "long.md", "# Long\n" + "line\n" * 5)
    return p


def codes(findings):
    return [f.code for f in findings]


def skill_with(desc="Does X. Use when Y.", name="demo", extra="", body="# Demo\n"):
    return f"---\nname: {name}\ndescription: {desc}\n{extra}---\n{body}"


def test_valid_plugin_no_findings(tmp_path):
    p = make_plugin(tmp_path)
    assert lint_plugin(p, "1.0.0") == []


def test_sk001_no_frontmatter(tmp_path):
    p = make_plugin(tmp_path, skill="# no frontmatter\n")
    assert "SK001" in codes(lint_plugin(p, "1.0.0"))


def test_sk005_unknown_key(tmp_path):
    p = make_plugin(tmp_path, skill_with(extra="tools: Read\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["SK005"]


def test_sk002_name_mismatch(tmp_path):
    p = make_plugin(tmp_path, skill_with(name="other"))
    assert codes(lint_plugin(p, "1.0.0")) == ["SK002"]


def test_sk002_reserved_word(tmp_path):
    p = make_plugin(tmp_path)
    (p / "skills" / "demo" / "SKILL.md").unlink()
    write(p / "skills" / "my-claude-thing" / "SKILL.md", skill_with(name="my-claude-thing"))
    assert codes(lint_plugin(p, "1.0.0")) == ["SK002"]


def test_sk003_long_description(tmp_path):
    p = make_plugin(tmp_path, skill_with(desc="a" * 1025))
    assert "SK003" in codes(lint_plugin(p, "1.0.0"))


def test_sk003_tag_in_description(tmp_path):
    p = make_plugin(tmp_path, skill_with(desc="Does X for <slug>. Use when Y."))
    assert "SK003" in codes(lint_plugin(p, "1.0.0"))


def test_sk003_empty_description(tmp_path):
    p = make_plugin(tmp_path, "---\nname: demo\n---\n# x\n")
    assert "SK003" in codes(lint_plugin(p, "1.0.0"))


def test_sk004_combined_length(tmp_path):
    p = make_plugin(tmp_path, skill_with(desc="a" * 1000, extra="when_to_use: " + "b" * 600 + "\n"))
    assert "SK004" in codes(lint_plugin(p, "1.0.0"))


def test_sk006_long_body(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="line\n" * 501))
    assert "SK006" in codes(lint_plugin(p, "1.0.0"))


def test_sk006_boundary_499_ok(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="line\n" * 499))
    assert "SK006" not in codes(lint_plugin(p, "1.0.0"))


def test_sk007_first_person_warning(tmp_path):
    p = make_plugin(tmp_path, skill_with(desc="I can do X. Use when Y."))
    f = lint_plugin(p, "1.0.0")
    assert codes(f) == ["SK007"] and f[0].level == "warning"


def test_pa001_missing_plugin_root_path(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ${CLAUDE_PLUGIN_ROOT}/references/missing.md\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA001"]


def test_pa001_existing_ok_and_line_suffix(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ${CLAUDE_PLUGIN_ROOT}/references/long.md:12-20\n"))
    assert lint_plugin(p, "1.0.0") == []


def test_pa001_skill_dir(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ${CLAUDE_SKILL_DIR}/references/nope.md\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA001"]


def test_pa002_bare_path_from_skill(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Read references/long.md first\n"))
    f = lint_plugin(p, "1.0.0")
    assert codes(f) == ["PA002"]
    assert "${CLAUDE_PLUGIN_ROOT}/" in f[0].message


def test_bare_path_relative_to_file_ok(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Read references/local.md\n"))
    write(p / "skills" / "demo" / "references" / "local.md", "# L\n")
    assert lint_plugin(p, "1.0.0") == []


def test_bare_path_nowhere_ignored(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Write to scripts/user-thing.py in your project\n"))
    assert lint_plugin(p, "1.0.0") == []


def test_pa003_claude_scripts(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Run .claude/scripts/x.sh\n"))
    assert "PA003" in codes(lint_plugin(p, "1.0.0"))


def test_placeholder_path_ignored(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Use ${CLAUDE_PLUGIN_ROOT}/references/<slug>.md and references/*.md\n"))
    assert lint_plugin(p, "1.0.0") == []


def test_path_checks_in_commands_and_agents(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "commands" / "c.md", "---\ndescription: d\n---\n${CLAUDE_PLUGIN_ROOT}/references/gone.md\n")
    write(p / "agents" / "a.md", "---\nname: a\ndescription: d\n---\nreferences/long.md\n")
    assert sorted(codes(lint_plugin(p, "1.0.0"))) == ["PA001", "PA002"]


def test_evals_and_docs_not_scanned(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "evals" / "x.md", "${CLAUDE_PLUGIN_ROOT}/references/gone.md\n")
    write(p / "docs" / "x.md", "${CLAUDE_PLUGIN_ROOT}/references/gone.md\n")
    write(p / "README.md", "${CLAUDE_PLUGIN_ROOT}/references/gone.md\n")
    assert lint_plugin(p, "1.0.0") == []


def test_rf001_long_reference_without_toc(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "references" / "big.md", "# Big\n" + "line\n" * 120)
    f = lint_plugin(p, "1.0.0")
    assert codes(f) == ["RF001"] and f[0].level == "warning"


def test_rf001_with_toc_ok(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "references" / "big.md", "# Big\n\n## Contents\n- a\n" + "line\n" * 120)
    assert lint_plugin(p, "1.0.0") == []


@pytest.mark.parametrize("rel", ["references/x-template.md", "references/templates/a.md",
                                 "references/my-example.md", "references/styling/a.md"])
def test_rf001_exemptions(tmp_path, rel):
    p = make_plugin(tmp_path)
    write(p / rel, "# T\n" + "line\n" * 120)
    assert lint_plugin(p, "1.0.0") == []


def test_rf001_skill_local_reference(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "skills" / "demo" / "references" / "big.md", "# Big\n" + "line\n" * 120)
    assert codes(lint_plugin(p, "1.0.0")) == ["RF001"]


def test_cm001_command_without_description(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "commands" / "c.md", "---\nargument-hint: x\n---\nbody\n")
    assert codes(lint_plugin(p, "1.0.0")) == ["CM001"]


def test_ag001_agent_without_name(tmp_path):
    p = make_plugin(tmp_path)
    write(p / "agents" / "a.md", "---\ndescription: d\n---\nbody\n")
    assert codes(lint_plugin(p, "1.0.0")) == ["AG001"]


def test_vs001_version_mismatch(tmp_path):
    p = make_plugin(tmp_path, version="1.1.0")
    assert codes(lint_plugin(p, "1.0.0")) == ["VS001"]


def test_vs001_skipped_when_none(tmp_path):
    p = make_plugin(tmp_path, version="1.1.0")
    assert lint_plugin(p, None) == []


def make_repo(tmp_path, skill):
    p = make_plugin(tmp_path, skill)
    write(tmp_path / ".claude-plugin" / "marketplace.json", json.dumps(
        {"plugins": [{"name": "demo", "version": "1.0.0", "source": "./plugins/demo-plugin"}]}))
    return p


def test_cli_strict_turns_warning_into_exit_1(tmp_path, capsys):
    make_repo(tmp_path, skill_with(desc="I can do X. Use when Y."))
    assert lint_skills.main([], root=tmp_path) == 0
    assert lint_skills.main(["--strict"], root=tmp_path) == 1
    assert "SK007" in capsys.readouterr().out


def test_cli_error_exit_1_and_clean_exit_0(tmp_path):
    make_repo(tmp_path, skill_with(extra="tools: x\n"))
    assert lint_skills.main([], root=tmp_path) == 1
    make_repo(tmp_path, GOOD_SKILL)
    assert lint_skills.main(["--strict"], root=tmp_path) == 0


def test_cli_unknown_plugin_exit_2(tmp_path, capsys):
    make_repo(tmp_path, GOOD_SKILL)
    assert lint_skills.main(["--plugin", "nope"], root=tmp_path) == 2
    assert "nope" in capsys.readouterr().err


def test_cli_exclude(tmp_path):
    make_repo(tmp_path, skill_with(extra="tools: x\n"))
    assert lint_skills.main(["--exclude", "demo"], root=tmp_path) == 0


def test_cli_output_format_and_sorting(tmp_path, capsys):
    p = make_repo(tmp_path, skill_with(body="x\nRun .claude/scripts/a.sh\n", extra="tools: x\n"))
    lint_skills.main([], root=tmp_path)
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines[0].endswith("error SK005 unknown frontmatter key 'tools'")
    assert ": error PA003" in lines[1]
    assert lines[1].split(":")[1] == "7"


def test_pa001_prefixed_arbitrary_first_dir(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ${CLAUDE_PLUGIN_ROOT}/skills/foo/scripts/x.py now\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA001"]


def test_prefixed_arbitrary_first_dir_existing_ok(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ${CLAUDE_PLUGIN_ROOT}/skills/demo/scripts/x.py and ${CLAUDE_SKILL_DIR}/scripts/x.py\n"))
    write(p / "skills" / "demo" / "scripts" / "x.py", "pass\n")
    assert lint_plugin(p, "1.0.0") == []


def test_skill_dir_arbitrary_first_dir_missing(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ${CLAUDE_SKILL_DIR}/assets/nope.json\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA001"]


@pytest.mark.parametrize("wrapped", ["*references/long.md*", "_references/long.md_", "**references/long.md**"])
def test_emphasis_does_not_hide_bare_path(tmp_path, wrapped):
    p = make_plugin(tmp_path, skill_with(body=f"Read {wrapped} first\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA002"]


def test_emphasis_on_prefixed_missing(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="**${CLAUDE_PLUGIN_ROOT}/scripts/next_id.py**\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA001"]


def test_underscore_inside_filename_kept(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Run ${CLAUDE_PLUGIN_ROOT}/scripts/next_id.py\n"))
    write(p / "scripts" / "next_id.py", "pass\n")
    assert lint_plugin(p, "1.0.0") == []


def test_relative_path_resolves_ok(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ../../references/long.md\n"))
    assert lint_plugin(p, "1.0.0") == []


def test_relative_path_broken_pa001(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="See ../../references/gone.md and ./nope.md\n"))
    f = lint_plugin(p, "1.0.0")
    assert codes(f) == ["PA001", "PA001"]
    assert "relative path does not resolve" in f[0].message


def test_non_string_description_message(tmp_path):
    p = make_plugin(tmp_path, "---\nname: demo\ndescription: 123\n---\n# x\n")
    f = lint_plugin(p, "1.0.0")
    assert codes(f) == ["SK003"] and "must be a string" in f[0].message


def test_vs001_missing_plugin_json(tmp_path):
    p = make_plugin(tmp_path)
    (p / ".claude-plugin" / "plugin.json").unlink()
    f = lint_plugin(p, "1.0.0")
    assert codes(f) == ["VS001"] and "plugin.json missing" in f[0].message


def test_sk007_you_cant_not_flagged(tmp_path):
    p = make_plugin(tmp_path, skill_with(desc="Does X so that you can't forget. Use when Y."))
    assert lint_plugin(p, "1.0.0") == []


def test_folded_description_length_on_resolved_string(tmp_path):
    folded = "---\nname: demo\ndescription: >\n" + "".join("  " + "a" * 60 + "\n" for _ in range(17)) + "---\n# x\n"
    # raw text ~1100 chars with indentation, resolved string is 17*60+16 = 1036 -> over limit
    p = make_plugin(tmp_path, folded)
    assert "SK003" in codes(lint_plugin(p, "1.0.0"))
    ok = "---\nname: demo\ndescription: >\n" + "".join("  " + "a" * 60 + "\n" for _ in range(16)) + "---\n# x\n"
    # resolved 16*60+15 = 975 (<=1024) although raw text lines exceed it with indent/newlines
    p2 = make_plugin(tmp_path / "b", ok)
    assert "SK003" not in codes(lint_plugin(p2, "1.0.0"))


def test_bare_path_with_line_suffix(tmp_path):
    p = make_plugin(tmp_path, skill_with(body="Read references/long.md:10-20 first\n"))
    assert codes(lint_plugin(p, "1.0.0")) == ["PA002"]


def test_cli_plugin_filter_only_lints_that_plugin(tmp_path):
    make_repo(tmp_path, GOOD_SKILL)
    other = tmp_path / "plugins" / "other"
    write(other / ".claude-plugin" / "plugin.json", json.dumps({"name": "other", "version": "1.0.0"}))
    write(other / "skills" / "bad" / "SKILL.md", "# no frontmatter\n")
    mp = tmp_path / ".claude-plugin" / "marketplace.json"
    mp.write_text(json.dumps({"plugins": [
        {"name": "demo", "version": "1.0.0", "source": "./plugins/demo-plugin"},
        {"name": "other", "version": "1.0.0", "source": "./plugins/other"}]}))
    assert lint_skills.main([], root=tmp_path) == 1
    assert lint_skills.main(["--plugin", "demo"], root=tmp_path) == 0
