#!/usr/bin/env python3
"""Public flows of Keycloak, seen from an outside client (verify-keycloak.yml).

Standard library only. Parameters in JSON on standard input (secrets
included: never as arguments), result in JSON on standard output; no token
nor secret appears in it, only findings.

Modes:
  full      discovery, service accounts, redirects (D15), sign-in by
            code + PKCE of a test user, tokens (D7, D8), replay of a
            refresh token (D8).
  failures  n wrong passwords then the right one (D13): does the sign-in succeed?
  sign_in   the right password: does the sign-in succeed?
  console   sign-in to the admin console of master through the tunnel: where does
            the right password lead (code received, OTP enrolment required, refusal)?
  tool      realm tools (R8): sign-in by code + PKCE to the confidential client
            of a tool, exchange with its secret, ID token summary; no PKCE and
            another redirect refused.
  page      chat step 6 (verify-engine-chat.yml): sign-in through the engine's
            page over HTTPS (/auth/login?lang=fr → Keycloak in French →
            /auth/callback → session cookie), GET /requests with the cookie,
            then sign-out (the cookie no longer works).
"""
import base64
import hashlib
import html
import http.cookiejar
import json
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http_client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())


def call(opener, url, data=None, headers=None):
    """(status, headers, body) without following redirects."""
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    try:
        r = opener.open(urllib.request.Request(url, data=body, headers=headers or {}), timeout=30)
        return r.status, r.headers, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode(errors="replace")


def decode(jwt):
    def part(m):
        return json.loads(base64.urlsafe_b64decode(m + "=" * (-len(m) % 4)))
    header, payload, _ = jwt.split(".")
    return part(header), part(payload)


def access_summary(token):
    header, c = decode(token)
    return {
        "typ": header.get("typ"),
        "alg": header.get("alg"),
        "iss": c.get("iss"),
        "aud": c.get("aud") if isinstance(c.get("aud"), list) else [c.get("aud")],
        "duration": c["exp"] - c["iat"],
        "api_roles": sorted(c.get("resource_access", {}).get("eupadev-api", {}).get("roles", [])),
        "realm_roles": sorted(c.get("realm_access", {}).get("roles", [])),
        "other_clients": sorted(k for k in c.get("resource_access", {}) if k != "eupadev-api"),
        "scope": c.get("scope", ""),
        "has_sub": bool(c.get("sub")),
    }


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def url_auth(p, redirect, challenge=None, scope="openid"):
    q = {"client_id": "eupadev-cli", "response_type": "code", "scope": scope,
         "redirect_uri": redirect, "state": secrets.token_urlsafe(8)}
    if challenge:
        q.update(code_challenge=challenge, code_challenge_method="S256")
    return f"{p['base']}/realms/eupadev/protocol/openid-connect/auth?" + urllib.parse.urlencode(q)


def sign_in(p, opener, password, scope="openid"):
    """Code + PKCE; returns (code or None, verifier, redirect, detail)."""
    redirect = f"http://127.0.0.1:{50000 + secrets.randbelow(10000)}/callback"
    verifier, challenge = pkce()
    st, _, page = call(opener, url_auth(p, redirect, challenge, scope))
    m = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', page) or re.search(r'action="([^"]+login-actions/authenticate[^"]*)"', page)
    if st != 200 or not m:
        return None, verifier, redirect, f"no sign-in page ({st})"
    st, headers, page = call(opener, html.unescape(m.group(1)),
                            {"username": p["user"], "password": password, "credentialId": ""})
    location = headers.get("Location", "") if headers else ""
    if st == 302 and location.startswith(redirect):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
        if "code" in q:
            return q["code"][0], verifier, redirect, "code received"
        return None, verifier, redirect, "error: " + q.get("error", ["?"])[0]
    error = re.search(r'id="input-error[^"]*"[^>]*>\s*([^<]+)', page)
    return None, verifier, redirect, f"refused ({st}): " + (error.group(1).strip() if error else "?")


def token(p, data):
    st, _, body = call(http_client(), f"{p['base']}/realms/eupadev/protocol/openid-connect/token", data)
    return st, json.loads(body) if body.startswith("{") else {"raw": body[:200]}


def full(p):
    r = {}
    opener = http_client()
    st, _, body = call(opener, f"{p['base']}/realms/eupadev/.well-known/openid-configuration")
    r["issuer"] = json.loads(body)["issuer"] if st == 200 else f"HTTP {st}"

    # Service accounts (D7); offline_access requested (D8).
    for client in ("check-requester", "check-admin"):
        st, j = token(p, {"grant_type": "client_credentials", "client_id": client,
                          "client_secret": p["secrets"][client]})
        r[client] = access_summary(j["access_token"]) if st == 200 else {"error": st, "detail": j}
        st, j = token(p, {"grant_type": "client_credentials", "client_id": client,
                          "client_secret": p["secrets"][client], "scope": "offline_access"})
        r[client + "_offline"] = {"status": st, "error": j.get("error"),
                                  "scope": access_summary(j["access_token"])["scope"] if st == 200 else None,
                                  "has_refresh_token": "refresh_token" in j}

    # Redirects (D15): free port accepted, other path refused, PKCE required.
    _, challenge = pkce()
    r["redirects"] = {
        "port_50001": call(http_client(), url_auth(p, "http://127.0.0.1:50001/callback", challenge))[0],
        "port_50002": call(http_client(), url_auth(p, "http://127.0.0.1:50002/callback", challenge))[0],
        "other_path": call(http_client(), url_auth(p, "http://127.0.0.1:9/evil", challenge))[0],
        "other_host": call(http_client(), url_auth(p, "http://evil.example/callback", challenge))[0],
    }
    st, headers, _ = call(http_client(), url_auth(p, "http://127.0.0.1:50003/callback"))
    location = headers.get("Location", "") if headers else ""
    r["without_pkce"] = {"status": st, "error": urllib.parse.parse_qs(urllib.parse.urlparse(location).query).get("error", [None])[0]}

    # offline_access requested by the terminal client (D8): refused outright.
    st, headers, _ = call(http_client(), url_auth(p, "http://127.0.0.1:50005/callback", challenge, "openid offline_access"))
    location = headers.get("Location", "") if headers else ""
    r["cli_offline"] = {"status": st, "error": urllib.parse.parse_qs(urllib.parse.urlparse(location).query).get("error", [None])[0]}

    # Sign-in of a person (code + PKCE).
    code, verifier, redirect, detail = sign_in(p, opener, p["password"])
    r["sign_in"] = detail
    if not code:
        return r
    st, j = token(p, {"grant_type": "authorization_code", "client_id": "eupadev-cli", "code": code,
                      "redirect_uri": redirect, "code_verifier": verifier})
    if st != 200:
        r["code_exchange"] = {"status": st, "detail": j}
        return r
    r["cli"] = access_summary(j["access_token"])
    r["cli"]["response_scope"] = j.get("scope", "")
    r["cli"]["refresh_typ"] = decode(j["refresh_token"])[1].get("typ")

    # Replay of a refresh token (D8; open question: effect on the
    # session). A → B, then A replayed, then B, then SSO sign-in.
    a = j["refresh_token"]
    st, j2 = token(p, {"grant_type": "refresh_token", "client_id": "eupadev-cli", "refresh_token": a})
    r["refresh_1"] = st
    b = j2.get("refresh_token")
    st, j3 = token(p, {"grant_type": "refresh_token", "client_id": "eupadev-cli", "refresh_token": a})
    r["replay_a"] = {"status": st, "error": j3.get("error"), "description": j3.get("error_description")}
    st, j4 = token(p, {"grant_type": "refresh_token", "client_id": "eupadev-cli", "refresh_token": b})
    r["after_replay_b"] = {"status": st, "error": j4.get("error"), "description": j4.get("error_description")}
    verifier, challenge = pkce()
    st, headers, _ = call(opener, url_auth(p, "http://127.0.0.1:50004/callback", challenge))
    location = headers.get("Location", "") if headers else ""
    r["after_replay_sso"] = "code without password (SSO session alive)" if "code=" in location else f"sign-in page ({st})"
    return r


def console(p):
    """Sign-in to the admin console of master through the tunnel (http://127.0.0.1:8180).

    Keycloak sets `Secure` cookies there; a browser sends them back over
    http://127.0.0.1 (loopback origin = secure context), urllib does not:
    the same rule is given to urllib here."""
    jar = http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("https", "http")))
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())
    redirect = f"{p['base']}/admin/master/console/"
    _, challenge = pkce()
    q = {"client_id": "security-admin-console", "response_type": "code", "scope": "openid",
         "redirect_uri": redirect, "state": secrets.token_urlsafe(8),
         "code_challenge": challenge, "code_challenge_method": "S256"}
    st, _, page = call(opener, f"{p['base']}/realms/master/protocol/openid-connect/auth?" + urllib.parse.urlencode(q))
    m = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', page)
    if st != 200 or not m:
        return {"result": f"no sign-in page ({st})"}
    st, headers, page = call(opener, html.unescape(m.group(1)),
                            {"username": p["user"], "password": p["password"], "credentialId": ""})
    location = headers.get("Location", "") if headers else ""
    # Required action: Keycloak redirects to its own page (which the browser follows).
    for _ in range(3):
        if st != 302 or not location.startswith(f"{p['base']}/realms/master/login-actions/"):
            break
        st, headers, page = call(opener, location)
        location = headers.get("Location", "") if headers else ""
    if st == 302 and location.startswith(redirect) and "code=" in location:
        return {"result": "code received"}
    if st == 200 and 'id="kc-totp-settings-form"' in page:
        return {"result": "OTP enrolment required"}
    error = re.search(r'id="input-error[^"]*"[^>]*>\s*([^<]+)', page)
    title = re.search(r'<h1[^>]*id="kc-page-title"[^>]*>\s*([^<]+)', page)
    return {"result": f"other ({st})", "to": urllib.parse.urlparse(location).path, "error": error.group(1).strip() if error else None,
            "title": title.group(1).strip() if title else None}


def tool(p):
    """Realm tools: like the core of a tool (code + PKCE + nonce, client secret)."""
    r = {}
    root = f"{p['base']}/realms/{p['realm']}"
    nonce = secrets.token_urlsafe(16)
    st, _, body = call(http_client(), f"{root}/.well-known/openid-configuration")
    r["issuer"] = json.loads(body)["issuer"] if st == 200 else f"HTTP {st}"

    def auth(redirect, challenge):
        q = {"client_id": p["client"], "response_type": "code", "scope": "openid", "redirect_uri": redirect,
             "state": secrets.token_urlsafe(8), "nonce": nonce}
        if challenge:
            q.update(code_challenge=challenge, code_challenge_method="S256")
        return f"{root}/protocol/openid-connect/auth?" + urllib.parse.urlencode(q)

    st, headers, _ = call(http_client(), auth(p["redirect"], None))
    location = headers.get("Location", "") if headers else ""
    r["without_pkce"] = urllib.parse.parse_qs(urllib.parse.urlparse(location).query).get("error", [None])[0]
    _, challenge = pkce()
    r["other_redirect"] = call(http_client(), auth(p["redirect"] + "-elsewhere", challenge))[0]

    opener = http_client()
    verifier, challenge = pkce()
    st, _, page = call(opener, auth(p["redirect"], challenge))
    m = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', page)
    if st != 200 or not m:
        r["sign_in"] = f"no sign-in page ({st})"
        return r
    st, headers, _ = call(opener, html.unescape(m.group(1)),
                         {"username": p["user"], "password": p["password"], "credentialId": ""})
    location = headers.get("Location", "") if headers else ""
    code = urllib.parse.parse_qs(urllib.parse.urlparse(location).query).get("code", [None])[0] if location.startswith(p["redirect"]) else None
    r["sign_in"] = "code received" if code else f"refused ({st})"
    if not code:
        return r
    st, _, body = call(http_client(), f"{root}/protocol/openid-connect/token",
                         {"grant_type": "authorization_code", "code": code, "redirect_uri": p["redirect"],
                          "code_verifier": verifier, "client_id": p["client"], "client_secret": p["secret"]})
    if st != 200:
        r["code_exchange"] = st
        return r
    _, c = decode(json.loads(body)["id_token"])
    r["id_token"] = {"iss": c.get("iss"), "aud": c.get("aud"), "nonce_ok": c.get("nonce") == nonce,
                     "sid": bool(c.get("sid")), "sub": bool(c.get("sub")),
                     "email": bool(c.get("email")), "name": bool(c.get("name")),
                     "clients": sorted(c.get("resource_access", {})),
                     "roles": sorted(c.get("resource_access", {}).get(p["client"], {}).get("roles", [])),
                     "realm_roles": sorted(c.get("realm_access", {}).get("roles", []))}
    return r


def page(p):
    """Chat step 6: what a browser does on the engine's page (code + PKCE run by the engine, cookie session)."""
    r = {}
    opener = http_client()
    api = {"X-EupaDev": "1"}
    st, headers, _ = call(opener, f"{p['page']}/auth/login?lang=fr")
    location = headers.get("Location", "") if headers else ""
    r["login"] = {"status": st, "to_idp": location.startswith(f"{p['base']}/realms/eupadev/protocol/openid-connect/auth?"),
                  "ui_locales": urllib.parse.parse_qs(urllib.parse.urlparse(location).query).get("ui_locales", [None])[0]}
    st, _, html_page = call(opener, location)
    m = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', html_page)
    r["idp_page"] = {"status": st, "lang": (re.search(r'<html[^>]*lang="([^"]+)"', html_page) or [None, None])[1]}
    if st != 200 or not m:
        return r
    st, headers, _ = call(opener, html.unescape(m.group(1)),
                         {"username": p["user"], "password": p["password"], "credentialId": ""})
    location = headers.get("Location", "") if headers else ""
    r["return"] = {"status": st, "to_callback": location.startswith(f"{p['page']}/auth/callback?")}
    if not r["return"]["to_callback"]:
        return r
    st, headers, _ = call(opener, location)
    r["callback"] = {"status": st, "to": headers.get("Location") if headers else None}
    st, _, body = call(opener, f"{p['page']}/requests", headers=api)
    r["requests"] = {"status": st, "roles": json.loads(body)["me"]["roles"] if st == 200 else body[:200]}
    st, headers, _ = call(opener, f"{p['page']}/auth/logout", {})
    location = headers.get("Location", "") if headers else ""
    r["logout"] = {"status": st, "to_idp": location.startswith(f"{p['base']}/realms/eupadev/protocol/openid-connect/logout")}
    r["after_logout"] = call(opener, f"{p['page']}/requests", headers=api)[0]
    return r


def main():
    p = json.load(sys.stdin)
    if p["mode"] == "full":
        r = full(p)
    elif p["mode"] == "page":
        r = page(p)
    elif p["mode"] == "console":
        r = console(p)
    elif p["mode"] == "tool":
        r = tool(p)
    else:
        opener = http_client()
        failures = []
        for _ in range(p.get("failures", 0)):
            failures.append(sign_in(p, opener, "wrong-" + secrets.token_urlsafe(8))[3])
        code, _, _, detail = sign_in(p, http_client(), p["password"])
        r = {"failures": failures, "good_password": detail, "signed_in": bool(code)}
    json.dump(r, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
