#!/usr/bin/env python3
"""Cleanup of the forge's image registry (tasks/registry-cleanup.yml).

Standard library only. Parameters as JSON on standard input (password
included: never as an argument; without `password`, it is read from the
systemd credential `password`, LoadCredential= of the unit
eupadev-registry-cleanup@), result as JSON on standard output (no
secret).

Gitea's official API only: packages API (/api/v1/packages) and registry API
(/v2, reading manifests).

Kept, per package:
  - the digests in service (`in_service`: `host/org/name@sha256:…`) and the
    build designated by the movable tags (`movable_tags`:
    `host/org/name:tag`);
  - the last `keep` builds of each variant (a build = a digest, whatever the
    number of tags that designate it; variant = the movable tag that one of
    its tags extends, e.g. `build-24-20261014` → `build-24`, otherwise a
    single variant per package);
  - every tag of a kept build, its signature `sha256-<digest>` and the
    untagged manifests they reference (per-platform image, BuildKit
    attestation, signature).
Erased: the rest (tags, orphan signatures, untagged manifests that nothing
references any more, pushed more than `grace_minutes` ago); the
`throwaway_prefix*` packages entirely. Gitea 28 never removes an untagged
manifest by itself: its housekeeping (cron.cleanup_packages) only erases
expired upload data, empty packages and unreferenced blobs; it is run at the
end (apply mode) to free the space.

Refuses to erase anything if an image in service or a movable tag cannot be
found, or if a manifest cannot be read.
"""
import base64
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
SIGNATURE = re.compile(r"^sha256-([0-9a-f]{64})(\..+)?$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


class Failure(Exception):
    pass


class Forge:
    def __init__(self, p):
        self.root = p["root"].rstrip("/")
        self.org = p["org"]
        password = p.get("password")
        if password is None:  # systemd unit (LoadCredential=)
            with open(os.path.join(os.environ["CREDENTIALS_DIRECTORY"], "password")) as f:
                password = f.read()
        self.basic = "Basic " + base64.b64encode(
            f"{p['user']}:{password}".encode()).decode()
        self.token = None

    def call(self, method, path, auth=None, accept="application/json"):
        req = urllib.request.Request(self.root + path, method=method, headers={
            "Authorization": auth or self.basic, "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                return r.status, dict(r.headers), (json.loads(body) if body else None)
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), None

    def api(self, method, path, expected=(200,)):
        status, headers, body = self.call(method, "/api/v1" + path)
        if status not in expected:
            raise Failure(f"{method} {path}: {status}")
        return status, headers, body

    def versions(self):
        """Every container version of the organisation, per package."""
        packages, page = {}, 1
        while True:
            _, _, batch = self.api("GET", f"/packages/{self.org}?type=container&limit=50&page={page}")
            if not batch:
                return packages
            for v in batch:
                packages.setdefault(v["name"], []).append({"version": v["version"], "date": v["created_at"]})
            page += 1

    def manifest(self, package, ref):
        """(digest, children [(digest, is_index)]) of a tag or digest."""
        if self.token is None:
            _, _, body = self.call("GET", "/v2/token")
            if not body or "token" not in body:
                raise Failure("registry token refused")
            self.token = "Bearer " + body["token"]
        status, headers, body = self.call(
            "GET", f"/v2/{self.org}/{package}/manifests/{ref}", auth=self.token, accept=ACCEPT)
        if status != 200:
            raise Failure(f"manifest {package}:{ref} unreadable ({status})")
        digest = {k.lower(): v for k, v in headers.items()}.get("docker-content-digest", "")
        if not DIGEST.match(digest):
            raise Failure(f"manifest {package}:{ref} without digest")
        children = [(m["digest"], "index" in m.get("mediaType", "") or "list" in m.get("mediaType", ""))
                    for m in body.get("manifests", [])]
        return digest, children

    def files(self, package, version):
        _, _, body = self.api("GET", f"/packages/{self.org}/container/{package}/{urllib.parse.quote(version, safe='')}/files")
        return {f["sha256"]: f["size"] for f in body}


def sort_package(forge, package, versions, in_service, movable, keep, cutoff):
    """Decides, for one package, what is kept and what is erased (reason)."""
    tags, signatures, untagged = [], [], []
    for v in versions:
        name = v["version"]
        if DIGEST.match(name):
            untagged.append(v)
        elif SIGNATURE.match(name):
            signatures.append(v)
        else:
            tags.append(v)

    # Tag → digest; build = digest, dated by its last tag.
    digest_of, date_of = {}, {}
    for v in tags:
        e, _ = forge.manifest(package, v["version"])
        digest_of[v["version"]] = e
        date_of[e] = max(date_of.get(e, ""), v["date"])
    builds = sorted(date_of, key=date_of.get, reverse=True)
    known = set(builds) | {v["version"] for v in untagged}

    missing = [e for e in in_service if e not in known] + [t for t in movable if t not in digest_of]
    if missing:
        raise Failure(f"{package}: in service but not found in the registry: {missing}")

    # Last `keep` builds per variant: a build with a tag that extends a movable
    # tag (`build-24-20261014` → `build-24`) belongs to its variant; the others
    # form a single variant.
    def variant(e):
        return next((m for m in sorted(movable) for t, x in digest_of.items()
                     if x == e and (t == m or t.startswith(m + "-"))), None)
    by_variant = {}
    for e in builds:
        by_variant.setdefault(variant(e), []).append(e)
    kept_builds = set(in_service) | {digest_of[t] for t in movable} | {
        e for batch in by_variant.values() for e in batch[:keep]}
    kept_signatures = [v["version"] for v in signatures if "sha256:" + SIGNATURE.match(v["version"]).group(1) in kept_builds]

    # Everything a kept version references (recursive: index of indexes).
    reached, to_read = set(kept_builds), [(e, True) for e in kept_builds] + [(s, True) for s in kept_signatures]
    while to_read:
        ref, is_index = to_read.pop()
        if not is_index:
            continue
        _, children = forge.manifest(package, ref)
        for e, idx in children:
            if e not in reached:
                reached.add(e)
                to_read.append((e, idx))

    erased, kept = [], []
    for v in tags:
        e = digest_of[v["version"]]
        (kept if e in kept_builds else erased).append(
            {"version": v["version"], "digest": e, "reason": "kept build" if e in kept_builds else "old build"})
    for v in signatures:
        ok = v["version"] in kept_signatures
        (kept if ok else erased).append(
            {"version": v["version"], "reason": "signature of a kept build" if ok else "signature of an erased or missing build"})
    for v in untagged:
        if v["version"] in reached:
            kept.append({"version": v["version"], "reason": "referenced by a kept version"})
        elif datetime.datetime.fromisoformat(v["date"]) > cutoff:
            # A build in progress pushes its manifests before the index that references them.
            kept.append({"version": v["version"], "reason": "untagged, too recent"})
        else:
            erased.append({"version": v["version"], "reason": "untagged, no longer referenced"})
    return kept, erased


def main(p):
    forge = Forge(p)
    keep = int(p.get("keep", 3))
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=int(p.get("grace_minutes", 60)))
    prefix = p.get("throwaway_prefix", "check-")
    wanted = set(p.get("packages") or [])
    in_service = {}
    for image in p.get("in_service", []):
        m = re.match(r"^[^/]+/([^/]+)/([^@:]+)(?::[^@]+)?@(sha256:[0-9a-f]{64})$", image)
        if not m or m.group(1) != forge.org:
            raise Failure(f"unreadable image in service: {image}")
        in_service.setdefault(m.group(2), set()).add(m.group(3))
    movable = {}
    for image in p.get("movable_tags", []):
        m = re.match(r"^[^/]+/([^/]+)/([^@:]+):([^@:]+)$", image)
        if not m or m.group(1) != forge.org:
            raise Failure(f"unreadable movable tag: {image}")
        movable.setdefault(m.group(2), []).append(m.group(3))

    everything = forge.versions()
    packages = {n: v for n, v in everything.items() if not wanted or n in wanted}
    for n in list(in_service) + list(movable):
        if (not wanted or n in wanted) and n not in packages:
            raise Failure(f"package in service missing from the registry: {n}")

    result = {}
    for name in sorted(packages):
        if name.startswith(prefix):
            kept, erased = [], [{"version": v["version"], "reason": "trial package"} for v in packages[name]]
        else:
            kept, erased = sort_package(forge, name, packages[name], in_service.get(name, set()), movable.get(name, []), keep, cutoff)
        result[name] = {"kept": kept, "erased": erased}

    # Freed space (estimate): blobs of the erased versions that no kept version
    # uses (Gitea shares a blob between packages).
    kept_blobs, erased_blobs = {}, {}
    for name, r in result.items():
        for v in r["kept"]:
            kept_blobs.update(forge.files(name, v["version"]))
        for v in r["erased"]:
            f = forge.files(name, v["version"])
            erased_blobs.update(f)
            r.setdefault("_blobs", {}).update(f)
    for r in result.values():
        blobs = r.pop("_blobs", {})
        r["freed_bytes"] = sum(t for h, t in blobs.items() if h not in kept_blobs)
    total = sum(t for h, t in erased_blobs.items() if h not in kept_blobs)

    if p.get("apply"):
        for name, r in result.items():
            if name.startswith(prefix):
                forge.api("DELETE", f"/packages/{forge.org}/container/{name}", expected=(204,))
                continue
            # Tags and signatures first, then the manifests they referenced.
            for v in sorted(r["erased"], key=lambda v: bool(DIGEST.match(v["version"]))):
                forge.api("DELETE", f"/packages/{forge.org}/container/{name}/{urllib.parse.quote(v['version'], safe='')}",
                          expected=(204,))
        # Official housekeeping: unreferenced blobs and empty packages.
        forge.api("POST", "/admin/cron/cleanup_packages", expected=(204,))

    return {"applied": bool(p.get("apply")), "freed_bytes": total, "packages": result}


if __name__ == "__main__":
    try:
        r = main(json.load(sys.stdin))
        print(json.dumps(r, ensure_ascii=False))
        # One-line summary for the journal (the JSON line may exceed LineMax).
        print(f"{'erased' if r['applied'] else 'trial mode, to erase'}: "
              f"{sum(len(v['erased']) for v in r['packages'].values())} versions, "
              f"{r['freed_bytes'] / 1073741824:.2f} GiB", file=sys.stderr)
    except Failure as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
