#!/usr/bin/env python3
"""PreToolUse hook: block git commits that carry a Co-Authored-By trailer.

Reads the Bash tool call from stdin. Exit 2 blocks the call and sends stderr
back to Claude; exit 0 lets it through.
"""
import json
import re
import shlex
import sys

# Trailer syntax only ("Co-Authored-By: ..." or --trailer "co-authored-by=..."),
# so a message that merely mentions the phrase is not blocked.
TRAILER = re.compile(r"co-authored-by\s*[:=]", re.IGNORECASE)
GIT_COMMIT = re.compile(r"\bgit\b[^\n]*\bcommit\b")


def message_files(command):
    """Paths passed to `git commit -F/--file`, so file-based messages are checked too."""
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        return []
    paths = []
    for i, tok in enumerate(tokens):
        if tok in ("-F", "--file") and i + 1 < len(tokens):
            paths.append(tokens[i + 1])
        elif tok.startswith("--file="):
            paths.append(tok.split("=", 1)[1])
        elif tok.startswith("-F") and len(tok) > 2:
            paths.append(tok[2:])
    return [p for p in paths if p != "-"]


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not GIT_COMMIT.search(command):
        return 0

    found = bool(TRAILER.search(command))
    for path in message_files(command):
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                found = found or bool(TRAILER.search(f.read()))
        except OSError:
            pass

    if found:
        print(
            "Blocked: commits in this repo must not include a Co-Authored-By trailer "
            "(see CLAUDE.md). Remove the trailer and commit again.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
