#!/usr/bin/env python3
"""Every pnpm pin of the repository names the same version.

pnpm is pinned in many files (golden image, packageManager fields, lockfiles,
CI checks, Ansible recipes); corepack runs offline in the golden image, so one
pin left behind breaks installs, and one forgotten upgrade keeps a vulnerable
pnpm. Usage: check-pnpm-version.py (from the repository root). Notes under
docs/ record past trials and are not pins.
"""
import re
import subprocess
import sys

PATTERNS = [
    re.compile(r"pnpm@(\d+\.\d+\.\d+)"),
    re.compile(r"PNPM_VERSION=(\d+\.\d+\.\d+)"),
    re.compile(r"check_pnpm: (\d+\.\d+\.\d+)"),
    re.compile(r"name: pnpm, version: (\d+\.\d+\.\d+)"),
]


def pins(paths):
    found = {}
    for path in paths:
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        for number, line in enumerate(text.splitlines(), 1):
            for pattern in PATTERNS:
                for version in pattern.findall(line):
                    found.setdefault(version, []).append(f"{path}:{number}")
    return found


def main():
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    found = pins(f for f in files if not f.startswith("docs/"))
    if len(found) == 1:
        version, where = next(iter(found.items()))
        print(f"OK: pnpm {version} everywhere ({len(where)} pins).")
        return 0
    print("FAILED: several pnpm versions are pinned:")
    for version, where in sorted(found.items()):
        print(f"  {version}: {', '.join(where)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
