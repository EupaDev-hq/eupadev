#!/usr/bin/python3 -I
"""eupadev-deployer: the engine's only entry point on a target VM (ADR-014).

Run by the engine's SSH key (forced command, `restrict,from=`), through a single
sudo rule without arguments: the requested command arrives in
SSH_ORIGINAL_COMMAND (kept by sudo, `env_keep`). Nothing is passed to a
shell: the line is split on single spaces and every argument is validated by
a strict pattern BEFORE any action. Output: one JSON line.
Codes: 0 = answer (even "nothing to do"), 2 = request refused, 1 = error.

E5d: `deploy preview` runs a signed image in the platform Compose model
(plain-template mode). E5e: `deploy mockup` reads the scoping commit's tar.gz
archive on stdin and serves its `web/` folder as static files (ADR-009,
ADR-022). E5g: `deploy prod` switches side by side, traffic only once healthy.
Core mode (ADR-022): an image labelled `eupadev.core` needs its Gate 1 entry
(register-tools.yml), gets the tools database and the egress proxy on its
network, its migration run once by the same image before any traffic, and the
core variables; the Prod purge command runs the purge of the served version
(daily timer). Python standard library only. A Preview deploy of a NEW digest
of a core tool empties its database first: the acceptance suite starts from
what `migrate` builds.
"""
import base64
import hashlib
import io
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import syslog
import tarfile
import time

CONFIGURATION = "/etc/eupadev/deployer.json"
LOCKS = "/run/eupadev/locks"
REGISTRY = "/run/eupadev/registry"  # + -<env>-<slug>: registry login, for the time of one call
MODEL = "/etc/eupadev/tool.compose.yml"
CORE_MODEL = "/etc/eupadev/core-tool.compose.yml"  # merged over the base model for a core image (d5)
TOOLS = "/etc/eupadev/tools"  # <slug>.json: Gate 1 entry of a core tool
TOOL_SECRETS = "/run/eupadev/tools"  # tool-<slug>-<x>: decrypted at boot by a systemd unit
CORE_SECRETS = ("db-owner", "db-app", "db-purge", "oidc")
DB = "tools-db"  # PostgreSQL of the core tools
SMOKESCREEN = "deployer-smokescreen-1"  # egress proxy of the core tools: identity provider only
TOOLS_KEY = "/etc/eupadev/cosign-tools.pub"
TOKEN_FILE = "/etc/eupadev/credstore.encrypted/deployer_registry_token"
DOCKER = "/usr/bin/docker"
COSIGN = "/usr/local/bin/cosign"
CURL = "/usr/bin/curl"
SYSTEMD_CREDS = "/usr/bin/systemd-creds"
CADDY = "deployer-caddy-1"  # Compose project "deployer" (infra/compose/deployer)
MOCKUPS = "/srv/eupadev/mockups"  # <sha256>/: one served mock-up, read by Caddy
MOCKUP_INDEX = "/var/lib/eupadev/mockups"  # <slug>.json: {cycle, digests}, written under the lock
BYTES_CAP = 50 * 1024 * 1024  # ADR-009 caps, archive and unpacked content
FILES_CAP = 2000
MAX_LENGTH = 512
SLUG = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")  # same pattern as the engine (orchestrator.ts)
CYCLE = re.compile(r"[1-9][0-9]{0,17}")
SHA256 = re.compile(r"[0-9a-f]{64}")
RETENTION = re.compile(r"RETENTION_[A-Z][A-Z0-9_]*")  # same patterns as register-tools.yml
DURATION = re.compile(r"[1-9][0-9]{0,5} (minutes|hours|days|months|years)")
ARITY = {"served": 2, "purge": 2, "stop": 3, "remove": 3, "deploy": 4}


class Refusal(Exception):
    """Request refused (code 2), with its reason."""


def parse(line, conf):
    """Splits and validates the command; returns (command, env, slug, cycle|None, image|None) or raises Refusal."""
    if not line:
        raise Refusal("no command (interactive session refused)")
    if len(line) > MAX_LENGTH:
        raise Refusal("command too long")
    parts = line.split(" ")
    command = parts[0]
    if command not in ARITY:
        raise Refusal("unknown command")
    if len(parts) != 1 + ARITY[command] or "" in parts:
        raise Refusal("wrong number of arguments")
    env, slug = parts[1], parts[2]
    if env not in conf["envs"]:
        raise Refusal("environment not served by this VM")
    if not SLUG.fullmatch(slug) or len(slug) > conf["slug_max"]:
        raise Refusal("invalid tool name")
    if slug in conf["reserved"]:
        raise Refusal("reserved tool name")
    cycle = image = None
    if ARITY[command] >= 3:
        if not CYCLE.fullmatch(parts[3]):
            raise Refusal("invalid cycle")
        cycle = parts[3]
    if command == "deploy":
        image = parts[4]
        if env == "mockup":
            if not SHA256.fullmatch(image):
                raise Refusal("invalid mock-up digest")
        else:
            pattern = re.escape(conf["registry"]) + "/eupadev/" + re.escape(slug) + r"@sha256:[0-9a-f]{64}"
            if not re.fullmatch(pattern, image):
                raise Refusal("image refused: the platform registry and a sha256 digest are required")
    return command, env, slug, cycle, image


def launch(argv, env=None, timeout=300):
    """Every external command goes through here: an argv list, never a shell."""
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False, env=env)


def docker(*args):
    r = launch([DOCKER, *args], timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"docker {args[0]}: {r.stderr.strip()[:300]}")
    return r.stdout


def containers(env, slug):
    """Containers of this (environment, tool), found by their labels: the state lives in Docker."""
    ids = docker("ps", "-aq", "--filter", f"label=eupadev.env={env}",
                 "--filter", f"label=eupadev.tool={slug}").split()
    return json.loads(docker("inspect", *ids)) if ids else []


def serves(c, slug):
    """Prod: the container that holds the alias prod-<slug> is the one Caddy sends the traffic to."""
    network = (c.get("NetworkSettings", {}).get("Networks") or {}).get(f"prod-{slug}") or {}
    return f"prod-{slug}" in (network.get("Aliases") or []) + (network.get("DNSNames") or [])


def served(conf, env, slug):
    running = [c for c in containers(env, slug) if c["State"]["Running"] and (env != "prod" or serves(c, slug))]
    if not running:
        return None
    if len(running) > 1:
        raise RuntimeError("several running containers for this tool")
    c = running[0]
    # The REAL digest (M5): the one of the container's image, not a tag.
    image = json.loads(docker("image", "inspect", c["Image"]))[0]
    prefix = f"{conf['registry']}/eupadev/{slug}@"
    digests = [d[len(prefix):] for d in image.get("RepoDigests") or [] if d.startswith(prefix)]
    return {"digest": digests[0] if digests else None,
            "cycle": int(c["Config"]["Labels"].get("eupadev.cycle", "0"))}


def remove_network(name):
    """Caddy (and the core's database and proxy) unplugged, then the tool network removed; all may already be gone."""
    for c in (CADDY, DB, SMOKESCREEN):
        launch([DOCKER, "network", "disconnect", "-f", name, c], timeout=60)
    launch([DOCKER, "network", "rm", name], timeout=60)


def act(env, slug, cycle, action):
    """stop / remove: only what THIS cycle deployed (G4, enforced on the target)."""
    found = containers(env, slug)
    if not found:
        if action == "remove":
            remove_network(f"{env}-{slug}")  # left by a call killed mid-way, owned by nobody
        return {"done": False, "reason": "nothing to " + action}
    others = {c["Config"]["Labels"].get("eupadev.cycle") for c in found} - {cycle}
    if others:
        return {"done": False, "reason": "owned by cycle " + ",".join(sorted(others))}
    ids = [c["Id"] for c in found]
    if action == "stop":
        docker("stop", *ids)
    else:
        docker("rm", "-f", *ids)
        remove_network(f"{env}-{slug}")
        for image in {c["Config"]["Image"] for c in found}:
            launch([DOCKER, "image", "rm", image], timeout=120)  # kept if another container still uses it
    return {"done": True}


def host(conf, env, slug):
    return f"{slug}.preview.{conf['domain']}" if env == "preview" else f"{slug}.{conf['domain']}"


def healthy(conf, env, slug):
    """GET /health THROUGH Caddy (what a user reaches), certificate checked against the system CAs."""
    h = host(conf, env, slug)
    r = launch([CURL, "-fsS", "-o", "/dev/null", "--max-time", "5", "--resolve", f"{h}:443:127.0.0.1",
                f"https://{h}/health"], timeout=30)
    return r.returncode == 0


def healthy_direct(name):
    """Prod: /health of one container by its own name, from the Caddy container, before it gets any traffic."""
    return launch([DOCKER, "exec", CADDY, "wget", "-q", "-O", "/dev/null", "-T", "5", f"http://{name}:3000/health"], timeout=30).returncode == 0


def wait(check, delay=60):
    deadline = time.monotonic() + delay
    while not check():
        if time.monotonic() > deadline:
            return False
        time.sleep(2)
    return True


def verify_and_pull(conf, env, slug, image):
    """cosign with the TOOLS key, then pull by digest. The read token of svc-deployment is decrypted in
    memory and written to a 0700 folder in /run for this call only."""
    creds = launch([SYSTEMD_CREDS, "decrypt", "--newline=no", "--name=deployer_registry_token", TOKEN_FILE, "-"], timeout=30)
    if creds.returncode != 0 or not creds.stdout:
        raise RuntimeError("registry token unreadable")
    folder = f"{REGISTRY}-{env}-{slug}"
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, mode=0o700)
    try:
        auth = base64.b64encode(f"svc-deployment:{creds.stdout}".encode()).decode()
        with open(os.open(os.path.join(folder, "config.json"), os.O_WRONLY | os.O_CREAT, 0o600), "w") as f:
            json.dump({"auths": {conf["registry"]: {"auth": auth}}}, f)
        environment = {"PATH": "/usr/bin:/bin", "HOME": "/root", "DOCKER_CONFIG": folder}
        v = launch([COSIGN, "verify", "--key", TOOLS_KEY, "--insecure-ignore-tlog=true", image], env=environment)
        if v.returncode != 0:
            raise Refusal("signature refused (tools key): " + v.stderr.strip()[-300:])
        p = launch([DOCKER, "pull", "-q", image], env=environment)
        if p.returncode != 0:
            raise RuntimeError("docker pull: " + p.stderr.strip()[:300])
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def create_network(env, network, core=False):
    """The tool network, internal and without the bridge address; Caddy plugged in (both may already exist).
    Core tool: the database and the egress proxy too (label eupadev.core: plugged back after a recreation)."""
    if launch([DOCKER, "network", "inspect", network], timeout=30).returncode != 0:
        docker("network", "create", "--internal", "-o", "com.docker.network.bridge.inhibit_ipv4=true",
               "--label", f"eupadev.env={env}", *(["--label", "eupadev.core=1"] if core else []), network)
    for c in (CADDY, DB, SMOKESCREEN) if core else (CADDY,):
        launch([DOCKER, "network", "connect", network, c], timeout=60)


def is_core(image):
    """d5: the platform's fixed Dockerfile labels a core tool image (agents cannot write it)."""
    infos = json.loads(docker("image", "inspect", image))[0]
    return "eupadev.core" in ((infos.get("Config") or {}).get("Labels") or {})


def entry(slug):
    """Gate 1 entry written by register-tools.yml (root only): fail-closed without it."""
    try:
        with open(os.path.join(TOOLS, f"{slug}.json"), encoding="utf-8") as f:
            e = json.load(f)
    except FileNotFoundError:
        raise Refusal("core tool not registered at Gate 1: paste the entry shown on the tool's Gate 1 page into "
                      "infra/ansible/group_vars/all/core-tools.yml, then run ansible-playbook register-tools.yml") from None
    retentions = e.get("retentions") or {}
    if not isinstance(e.get("client_id"), str) or not SLUG.fullmatch(e["client_id"]) or not all(
            RETENTION.fullmatch(k) and isinstance(v, str) and DURATION.fullmatch(v) for k, v in retentions.items()):
        raise RuntimeError("invalid Gate 1 entry")
    missing = [x for x in CORE_SECRETS if not os.path.isfile(os.path.join(TOOL_SECRETS, f"tool-{slug}-{x}"))]
    if missing:
        raise RuntimeError("tool secrets missing (" + ",".join(missing) + "): rerun register-tools.yml")
    return e


def subnet(network):
    """Subnet of the tool network: only Caddy sends requests there, so it is the trusted proxy (TRUST_PROXY)."""
    return json.loads(docker("network", "inspect", network))[0]["IPAM"]["Config"][0]["Subnet"]


def compose_files(e):
    return ["-f", MODEL, *(["-f", CORE_MODEL] if e else [])]


def variables(conf, env, slug, cycle, image, name, network, e=None):
    """The only input of the Compose model, built from validated values (and the root-owned Gate 1 entry)."""
    v = {"PATH": "/usr/bin:/bin", "HOME": "/root", "IMAGE": image, "NAME": name, "NETWORK": network,
         "ENV": env, "TOOL": slug, "CYCLE": cycle}
    if e:
        v.update({"HOST": host(conf, env, slug), "ISSUER": conf["issuer"], "CLIENT": e["client_id"],
                  "TRUST_PROXY": subnet(network)})
    return v


def compose_run(service, conf, env, slug, cycle, image, name, network, e):
    """One-shot service of the core model (migrate, seed), same image as the tool."""
    return launch([DOCKER, "compose", "-p", name, *compose_files(e), "run", "--rm", service],
                  env=variables(conf, env, slug, cycle, image, name, network, e), timeout=600)


def migrate(conf, env, slug, cycle, image, name, network, e):
    return compose_run("migrate", conf, env, slug, cycle, image, name, network, e)


def seed(conf, env, slug, cycle, image, name, network, e):
    """Demo data of the Preview (ADR-032): the tool's db/seed/demo.sql, applied by the platform's seed.mjs with the
    owner account (same privileges as the migration, never the superuser of empty_db). Nothing to do without the file."""
    return compose_run("seed", conf, env, slug, cycle, image, name, network, e)


def empty_db(slug):
    """Preview only: schema app dropped and recreated empty (one transaction), both migration ledgers with it.
    The slug is validated ([a-z0-9-]): safe inside a quoted identifier."""
    r = launch([DOCKER, "exec", DB, "psql", "-U", "postgres", "-d", slug, "-v", "ON_ERROR_STOP=1", "-c",
                f'DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA app AUTHORIZATION "{slug}_owner"'], timeout=60)
    if r.returncode != 0:
        raise RuntimeError("Preview database reset failed: " + r.stderr.strip()[-300:])


def prepare_core(conf, env, slug, cycle, image, name, network, empty=False):
    """d5, before any traffic change: a core image needs its Gate 1 entry, then its migration runs once with the
    same image (owner account), on an emptied database when `empty` (new digest on Preview), which then gets the
    tool's demo data (ADR-032: seed only where the schema was just emptied, so never on Prod). Returns (entry or
    None, failure answer or None); on failure nothing else moved."""
    if not is_core(image):
        return None, None
    e = entry(slug)
    create_network(env, network, core=True)
    if empty:
        empty_db(slug)
    steps = [("migration", migrate)] + ([("demo seed", seed)] if empty else [])
    for step, run in steps:
        r = run(conf, env, slug, cycle, image, name, network, e)
        if r.returncode != 0:
            return e, {"digest": image.split("@", 1)[1], "url": f"https://{host(conf, env, slug)}", "health": "failed",
                       "reason": (f"{step} failed: " + (r.stdout + r.stderr).strip())[-500:]}
    return e, None


def compose_up(conf, env, slug, cycle, image, name, network, e=None):
    return launch([DOCKER, "compose", "-p", name, *compose_files(e), "up", "-d", "--wait", "--wait-timeout", "120"],
                  env=variables(conf, env, slug, cycle, image, name, network, e), timeout=180)


def failure(name, image, url, up):
    """Failure answer: attempted digest, end of the container's logs."""
    logs = launch([DOCKER, "logs", "--tail", "20", name], timeout=30)
    reason = (up.stderr.strip() if up.returncode else "") + " " + (logs.stdout + logs.stderr).strip()
    return {"digest": image.split("@", 1)[1], "url": url, "health": "failed", "reason": reason.strip()[-500:]}


def deploy_prod(conf, slug, cycle, image):
    """Prod (ADR-022): the new version starts beside the old one and gets the alias prod-<slug> only once healthy;
    on failure it is removed and the old one never stopped serving. Rollback = deploying the previous digest."""
    env, network, url = "prod", f"prod-{slug}", f"https://{host(conf, 'prod', slug)}"
    found = containers(env, slug)
    serving = [c for c in found if c["State"]["Running"] and serves(c, slug)]
    if any(c["Config"]["Image"] == image for c in serving) and healthy(conf, env, slug):
        return {**answer(conf, env, slug, url), "health": "ok"}  # already done: nothing touched
    name = f"prod-{slug}-{image.split(':')[-1][:12]}"
    for c in found:  # left by an interrupted call: never got traffic
        if c not in serving and c["Name"] != "/" + name:
            launch([DOCKER, "rm", "-f", c["Id"]], timeout=60)
    verify_and_pull(conf, env, slug, image)
    create_network(env, network)
    e, failed = prepare_core(conf, env, slug, cycle, image, name, network)
    if failed:
        return failed  # failed migration: nothing started, the old version never stopped serving
    up = compose_up(conf, env, slug, cycle, image, name, network, e)
    if up.returncode != 0 or not wait(lambda: healthy_direct(name)):
        r = failure(name, image, url, up)
        if not any(c["Name"] == "/" + name for c in serving):
            launch([DOCKER, "rm", "-f", name], timeout=60)
        return r
    # Traffic: alias to the new one, then off the old ones, which are removed a few seconds later.
    launch([DOCKER, "network", "disconnect", network, name], timeout=60)
    docker("network", "connect", "--alias", network, network, name)
    old = [c for c in serving if c["Name"] != "/" + name]
    for c in old:
        launch([DOCKER, "network", "disconnect", network, c["Id"]], timeout=60)
    if old:
        time.sleep(5)
        launch([DOCKER, "rm", "-f", *[c["Id"] for c in old]], timeout=120)
    if wait(lambda: healthy(conf, env, slug), 30):
        return {**answer(conf, env, slug, url), "health": "ok"}
    return failure(name, image, url, up)


def deploy(conf, env, slug, cycle, image):
    """Preview: plain replacement (ADR-014). Convergent: replaying after a crash ends in the same state."""
    if env == "prod":
        return deploy_prod(conf, slug, cycle, image)
    name = f"{env}-{slug}"
    url = f"https://{host(conf, env, slug)}"
    found = containers(env, slug)
    others = {c["Config"]["Labels"].get("eupadev.cycle") for c in found} - {cycle}
    if others:
        raise Refusal("owned by cycle " + ",".join(sorted(others)))  # G4: never replace another cycle
    if any(c["State"]["Running"] and c["Config"]["Image"] == image for c in found):
        launch([DOCKER, "network", "connect", name, CADDY], timeout=60)  # Caddy recreated since: plug again
        if healthy(conf, env, slug):
            return {**answer(conf, env, slug, url), "health": "ok"}  # already done: nothing touched
    other_tools = set(docker("ps", "-a", "--filter", f"label=eupadev.env={env}",
                             "--format", '{{.Label "eupadev.tool"}}').split()) - {slug}
    if len(other_tools) >= conf["quota"]:
        raise Refusal(f"quota reached: {len(other_tools)} Previews on this VM (cap {conf['quota']})")
    verify_and_pull(conf, env, slug, image)
    create_network(env, name)
    new_digest = all(c["Config"]["Image"] != image for c in found)  # same digest (stopped, unhealthy): data kept
    e, failed = prepare_core(conf, env, slug, cycle, image, name, name, empty=new_digest)
    if failed:
        # Failed migration: the running Preview keeps serving, on its own schema rebuilt by its own image.
        old = [c["Config"]["Image"] for c in found if c["State"]["Running"]]
        if e and new_digest and old and is_core(old[0]):
            migrate(conf, env, slug, cycle, old[0], name, name, e)
        return failed
    up = compose_up(conf, env, slug, cycle, image, name, name, e)
    if up.returncode == 0 and wait(lambda: healthy(conf, env, slug)):
        return {**answer(conf, env, slug, url), "health": "ok"}
    # Failure: container stopped (kept for diagnosis), attempted digest returned with the end of its logs.
    r = failure(name, image, url, up)
    launch([DOCKER, "stop", name], timeout=60)
    return r


# ── Mock-up (E5e, ADR-009) ─────────────────────────────────────────────────
def extract(data, destination):
    """Only `<top>/web/` of a forge archive, into a new folder renamed in place. The WHOLE archive is refused,
    before any write, for a link, a special file, an absolute or `..` path, or beyond the caps."""
    total, kept = 0, []
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for n, m in enumerate(archive, 1):  # headers read one by one: a bomb hits the caps before it is unpacked
                total += m.size
                if n > FILES_CAP or total > BYTES_CAP:
                    raise Refusal("archive beyond the caps")
                parts = m.name.split("/")
                if m.name.startswith("/") or ".." in parts:
                    raise Refusal('absolute or ".." path in the archive')
                if not (m.isfile() or m.isdir()):
                    raise Refusal("link or special file in the archive")
                sub = [x for x in parts[2:] if x not in ("", ".")]
                if len(parts) > 2 and parts[1] == "web" and sub:
                    kept.append((m, "/".join(sub)))
            if not any(m.isfile() for m, _ in kept):
                raise Refusal("no file in web/")
            temporary = f"{destination}.tmp-{os.getpid()}"
            shutil.rmtree(temporary, ignore_errors=True)
            os.makedirs(temporary, mode=0o755)
            for m, path in kept:
                target = os.path.join(temporary, path)
                if m.isdir():
                    os.makedirs(target, mode=0o755, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(target), mode=0o755, exist_ok=True)
                with open(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644), "wb") as f:
                    shutil.copyfileobj(archive.extractfile(m), f)
            os.rename(temporary, destination)
    except (tarfile.TarError, EOFError, OSError, ValueError) as e:
        raise Refusal(f"unreadable archive: {e}") from None


def mockup_index(slug):
    try:
        with open(os.path.join(MOCKUP_INDEX, f"{slug}.json"), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def deploy_mockup(conf, slug, cycle, digest, stdin):
    index = mockup_index(slug)
    if index and index["cycle"] != cycle:
        raise Refusal("owned by cycle " + index["cycle"])  # G4
    destination = os.path.join(MOCKUPS, digest)
    if not os.path.isdir(destination):  # content-addressed: the same digest twice is already done
        data = stdin.read(BYTES_CAP + 1)
        if len(data) > BYTES_CAP:
            raise Refusal("archive beyond the caps")
        if hashlib.sha256(data).hexdigest() != digest:
            raise Refusal("archive digest differs from the requested one")
        os.makedirs(MOCKUPS, mode=0o755, exist_ok=True)
        extract(data, destination)
    digests = [e for e in (index or {}).get("digests", []) if e != digest] + [digest]
    os.makedirs(MOCKUP_INDEX, mode=0o700, exist_ok=True)
    path = os.path.join(MOCKUP_INDEX, f"{slug}.json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump({"cycle": cycle, "digests": digests}, f)
    os.replace(path + ".tmp", path)
    return {"digest": "sha256:" + digest, "url": f"https://mockup.{conf['domain']}/{digest}/", "health": "ok"}


def served_mockup(slug):
    """The last mock-up of the slug, only if its folder is really in place."""
    index = mockup_index(slug)
    if not index or not os.path.isdir(os.path.join(MOCKUPS, index["digests"][-1])):
        return None
    return {"digest": "sha256:" + index["digests"][-1], "cycle": int(index["cycle"])}


def remove_mockup(slug, cycle):
    index = mockup_index(slug)
    if not index:
        return {"done": False, "reason": "nothing to remove"}
    if index["cycle"] != cycle:
        return {"done": False, "reason": "owned by cycle " + index["cycle"]}
    for e in index["digests"]:
        shutil.rmtree(os.path.join(MOCKUPS, e), ignore_errors=True)
    os.remove(os.path.join(MOCKUP_INDEX, f"{slug}.json"))
    return {"done": True}


def purge(conf, slug):
    """S7: purge of the version served in Prod (bin/purge.js of the core, purge account, retentions of the Gate 1
    entry), called by the daily timer eupadev-purge.timer. Exit code 1 on failure: the unit fails visibly."""
    serving = [c for c in containers("prod", slug) if c["State"]["Running"] and serves(c, slug)]
    if not serving:
        return {"done": False, "reason": "nothing served"}
    c = serving[0]
    if not is_core(c["Config"]["Image"]):
        return {"done": False, "reason": "not a core tool"}
    e = entry(slug)
    name = c["Name"].lstrip("/")
    durations = [x for k, v in sorted(e["retentions"].items()) for x in ("-e", f"{k}={v}")]
    r = launch([DOCKER, "compose", "-p", name, *compose_files(e), "run", "--rm", *durations, "purge"],
               env=variables(conf, "prod", slug, c["Config"]["Labels"].get("eupadev.cycle", "0"), c["Config"]["Image"],
                             name, f"prod-{slug}", e), timeout=900)
    if r.returncode != 0:
        raise RuntimeError("purge failed: " + (r.stdout + r.stderr).strip()[-400:])
    return {"done": True, "output": r.stdout.strip()[-400:]}


def answer(conf, env, slug, url):
    s = served(conf, env, slug)
    return {"digest": s["digest"] if s else None, "url": url}


def lock(env, slug):
    """flock per (environment, tool): released by the kernel if the process dies."""
    os.makedirs(LOCKS, mode=0o700, exist_ok=True)
    f = open(os.path.join(LOCKS, f"{env}-{slug}"), "w")  # kept open until the end: the caller closes it
    deadline = time.monotonic() + 300
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return f
        except BlockingIOError:
            if time.monotonic() > deadline:
                raise RuntimeError("lock held for more than 300 s") from None
            time.sleep(1)


def execute(line, conf):
    command, env, slug, cycle, image = parse(line, conf)
    if command == "purge":
        if env != "prod":
            raise Refusal("purge in Prod only (Preview data is disposable)")
        with lock(env, slug):
            return purge(conf, slug)
    if command == "served" and env != "mockup":
        return served(conf, env, slug)
    if env == "mockup":
        if command == "served":
            return served_mockup(slug)
        with lock(env, slug):
            if command == "deploy":
                return deploy_mockup(conf, slug, cycle, image, sys.stdin.buffer)
            return remove_mockup(slug, cycle)  # stop = remove: static files, redeployed from the archive
    with lock(env, slug):
        if command == "deploy":
            return deploy(conf, env, slug, cycle, image)
        return act(env, slug, cycle, command)


def main():
    line = os.environ.get("SSH_ORIGINAL_COMMAND", "")
    caller = (os.environ.get("SSH_CONNECTION") or "local").split(" ")[0]
    syslog.openlog("eupadev-deployer", 0, syslog.LOG_AUTH)
    try:
        with open(CONFIGURATION, encoding="utf-8") as f:
            conf = json.load(f)
        result, code = execute(line, conf), 0
    except Refusal as e:
        result, code = {"refusal": str(e)}, 2
    except Exception as e:  # noqa: BLE001 (any error becomes a JSON answer and code 1)
        result, code = {"error": str(e)[:500]}, 1
    output = json.dumps(result, ensure_ascii=False)
    # json.dumps of the command: a control character cannot forge a log line.
    syslog.syslog(syslog.LOG_NOTICE if code == 0 else syslog.LOG_WARNING,
                  f"caller={caller} command={json.dumps(line[:MAX_LENGTH])} code={code} result={output[:500]}")
    print(output)
    return code


if __name__ == "__main__":
    sys.exit(main())
