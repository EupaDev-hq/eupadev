#!/usr/bin/env python3
"""Every commit of a pull request carries a Developer Certificate of Origin sign-off.

The sign-off line (`git commit -s`) must name the commit's author:
"Signed-off-by: <author name> <author email>". Merge commits are skipped.
Usage: check-dco.py BASE HEAD (commits reachable from HEAD and not from BASE).
"""
import subprocess
import sys

SEP = '\x1f'
END = '\x1e'


def commits(base, head):
    out = subprocess.run(['git', 'log', '--no-merges', f'--format=%H{SEP}%an{SEP}%ae{SEP}%B{END}', f'{base}..{head}'],
                         capture_output=True, text=True, check=True).stdout
    for record in out.split(END):
        if record.strip():
            sha, name, email, body = record.strip('\n').split(SEP, 3)
            yield sha, name, email, body


def signed(name, email, body):
    expected = f'signed-off-by: {name} <{email}>'.lower()
    return any(line.strip().lower() == expected for line in body.splitlines())


def main(base, head):
    faults = [f'{sha[:12]} ({name} <{email}>)' for sha, name, email, body in commits(base, head)
              if not signed(name, email, body)]
    if faults:
        print('FAILED: commits without a sign-off matching their author (use `git commit -s`, '
              'see CONTRIBUTING.md):')
        print('\n'.join(f'  {f}' for f in faults))
        return 1
    print('OK: every commit is signed off.')
    return 0


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        assert signed('Ann Lee', 'ann@x.org', 'Fix\n\nSigned-off-by: Ann Lee <ann@x.org>\n')
        assert signed('Ann Lee', 'ann@x.org', 'Fix\n\nsigned-off-by: ann lee <ANN@x.org>')
        assert not signed('Ann Lee', 'ann@x.org', 'Fix\n\nSigned-off-by: Bob <bob@x.org>')
        assert not signed('Ann Lee', 'ann@x.org', 'Fix: Signed-off-by: Ann Lee <ann@x.org> later')
        assert not signed('Ann Lee', 'ann@x.org', 'Fix')
        print('self-test OK')
        sys.exit(0)
    sys.exit(main(sys.argv[1], sys.argv[2]))
