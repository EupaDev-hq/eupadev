# Schemathesis hooks of the kit (mounted by argsSchemathesis): the core's upload bodies are raw bytes of
# application/pdf, image/png or image/jpeg (src/contract.js TYPES_UPLOAD), which Schemathesis cannot serialize alone.
import unicodedata

import schemathesis


@schemathesis.serializer("application/pdf", "image/png", "image/jpeg")
def raw_file(ctx, value):
    if isinstance(value, bytes):
        return value
    return str(value).encode("utf-8")


# The core strips invisible characters from request strings before validating again (src/validation.js
# cleanText), a rule the contract cannot state: a generated text that loses characters may fall under its
# minLength and earn a 400 for data the schema accepts. Such cases are left to the core's own tests (INJ-5).
def _invisible(c):
    return unicodedata.category(c) == "Cf" or (unicodedata.category(c) == "Cc" and c not in "\t\n")


def _has_invisible(v):
    if isinstance(v, str):
        return any(_invisible(c) for c in v)
    if isinstance(v, dict):
        return any(_has_invisible(x) for x in v.values())
    if isinstance(v, list):
        return any(_has_invisible(x) for x in v)
    return False


@schemathesis.hook
def filter_case(ctx, case):
    return not (_has_invisible(case.body) or _has_invisible(case.query))
