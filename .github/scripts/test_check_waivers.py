#!/usr/bin/env python3
"""Guard of the guard: a registry line counts only while valid and unexpired."""
import datetime
import importlib.util
import pathlib
import sys

sys.dont_write_bytecode = True  # no __pycache__ in .github/scripts

spec = importlib.util.spec_from_file_location('w', pathlib.Path(__file__).with_name('check-waivers.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

today = datetime.date(2026, 11, 11)
allow, errors, notes = w.allowed('\n'.join([
    '# expires;file;pattern;count;reason',
    '2027-05-11;a.yml;noqa;2;valid',
    '2027-05-11;a.yml;noqa;1;adds up',
    '2026-11-10;b.sh;|| true;1;expired yesterday',
    '2028-01-01;c.py;noqa;1;too far ahead',
    '2027-01-01;c.py;nope;1;unknown pattern',
    '2027-01-01;c.py;noqa;x;bad count',
    '2027-01-01;c.py;noqa;1; ',
    '2027-01-01;c.py;noqa',
]), today)
assert allow == {('noqa', 'a.yml'): 3}, allow
assert len(notes) == 1 and 'expired' in notes[0], notes
assert len(errors) == 5, errors
print('OK: test of the waiver registry.')
