#!/usr/bin/env python3
"""Trial package of the forge's registry (verify-forge.yml, cleanup).

Standard library only. Parameters as JSON on standard input (password
included), result as JSON on standard output (no secret).

Pushes `builds` builds into `package`, as BuildKit then cosign 3 do: a
multi-platform index tagged `trial-<n>` that references a linux/amd64 image
and an attestation (unknown/unknown), pushed by digest; then the signature:
a "bundle" manifest (subject = the index), pushed by digest, and the
fallback index `sha256-<digest>` that references it. One second between two
builds (distinct dates).
"""
import base64
import hashlib
import json
import sys
import time
import urllib.request

INDEX = "application/vnd.oci.image.index.v1+json"
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
CONFIG = "application/vnd.oci.image.config.v1+json"
LAYER = "application/vnd.oci.image.layer.v1.tar"


def main(p):
    root, repo = p["root"].rstrip("/"), f"{p['org']}/{p['package']}"
    basic = "Basic " + base64.b64encode(f"{p['user']}:{p['password']}".encode()).decode()
    with urllib.request.urlopen(urllib.request.Request(root + "/v2/token", headers={"Authorization": basic})) as r:
        token = "Bearer " + json.load(r)["token"]

    def send(method, url, body=b"", type_=None):
        headers = {"Authorization": token}
        if type_:
            headers["Content-Type"] = type_
        req = urllib.request.Request(url if url.startswith("http") else root + url, data=body, method=method, headers=headers)
        with urllib.request.urlopen(req) as r:
            return r.headers

    def blob(content, type_):
        digest = "sha256:" + hashlib.sha256(content).hexdigest()
        location = send("POST", f"/v2/{repo}/blobs/uploads/")["Location"]
        send("PUT", f"{location}{'&' if '?' in location else '?'}digest={digest}", content, "application/octet-stream")
        return {"mediaType": type_, "digest": digest, "size": len(content)}

    def manifest(obj, ref=None):
        body = json.dumps(obj).encode()
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        send("PUT", f"/v2/{repo}/manifests/{ref or digest}", body, obj["mediaType"])
        return {"mediaType": obj["mediaType"], "digest": digest, "size": len(body)}

    def image(text):
        layer = blob(text.encode(), LAYER)
        config = blob(json.dumps({"architecture": "amd64", "os": "linux", "config": {},
                                  "rootfs": {"type": "layers", "diff_ids": [layer["digest"]]}}).encode(), CONFIG)
        return manifest({"schemaVersion": 2, "mediaType": MANIFEST, "config": config, "layers": [layer]})

    result, mark = [], time.time_ns()
    for n in range(1, p["builds"] + 1):
        platform = image(f"trial {mark} build {n}")
        attestation = image(f"attestation {mark} build {n}")
        index = manifest({"schemaVersion": 2, "mediaType": INDEX, "manifests": [
            dict(platform, platform={"architecture": "amd64", "os": "linux"}),
            dict(attestation, platform={"architecture": "unknown", "os": "unknown"},
                 annotations={"vnd.docker.reference.type": "attestation-manifest",
                              "vnd.docker.reference.digest": platform["digest"]})]}, f"trial-{n}")
        empty = blob(b"{}", "application/vnd.oci.empty.v1+json")
        bundle = manifest({"schemaVersion": 2, "mediaType": MANIFEST,
                           "artifactType": "application/vnd.dev.sigstore.bundle.v0.3+json",
                           "config": empty, "subject": index,
                           "layers": [blob(json.dumps({"trial": n, "mark": mark}).encode(),
                                           "application/vnd.dev.sigstore.bundle.v0.3+json")]})
        signature = "sha256-" + index["digest"].split(":")[1]
        manifest({"schemaVersion": 2, "mediaType": INDEX, "manifests": [
            dict(bundle, artifactType="application/vnd.dev.sigstore.bundle.v0.3+json")]}, signature)
        result.append({"tag": f"trial-{n}", "digest": index["digest"],
                       "versions": [f"trial-{n}", signature, platform["digest"], attestation["digest"], bundle["digest"]]})
        time.sleep(1.1)
    return result


if __name__ == "__main__":
    print(json.dumps(main(json.load(sys.stdin))))
