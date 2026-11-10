"""Input validation of eupadev-deployer and decisions of `deploy` (no Docker, no VM):
python3 infra/ansible/roles/deployer/files/test_deployer.py"""
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deployer  # noqa: E402
from deployer import Refusal, parse  # noqa: E402

REG = "git.example.test"
CONF_CI = {"envs": ["mockup", "preview"], "registry": REG, "slug_max": 40, "reserved": ["git", "mockup", "preview"],
           "domain": "example.test", "quota": 3}
CONF_PROD = {**CONF_CI, "envs": ["prod"]}
DIGEST = "a" * 64
IMAGE = f"{REG}/eupadev/leave@sha256:{DIGEST}"


class Validation(unittest.TestCase):
    def test_accepted(self):
        self.assertEqual(parse("served preview leave", CONF_CI), ("served", "preview", "leave", None, None))
        self.assertEqual(parse("remove preview leave 12", CONF_CI)[3], "12")
        self.assertEqual(parse("stop prod my-tool 3", CONF_PROD)[0], "stop")
        self.assertEqual(parse(f"deploy preview leave 4 {IMAGE}", CONF_CI)[4], IMAGE)
        self.assertEqual(parse(f"deploy mockup leave 4 {DIGEST}", CONF_CI)[4], DIGEST)

    def test_refused(self):
        refused = [
            "", "bash", "sh -c id", "served preview leave; id", "served preview $(id)", "served preview `id`",
            "served preview ../x", "served  preview leave", "served preview leave ", "served preview",
            "served preview Leave", "served preview leave\n", "remove preview leave 1\n", "served preview -x", "served preview leave extra", "served prod leave",
            "served preview git", "served preview " + "a" * 41, "remove preview leave 0", "remove preview leave -1",
            "remove preview leave 1e3", "remove preview leave\n1", "scp -t /tmp/x", "internal-sftp", "sftp",
            f"deploy preview leave 4 {REG}/eupadev/leave:latest",
            f"deploy preview leave 4 {REG}/eupadev/leave@{DIGEST}",
            f"deploy preview leave 4 elsewhere.test/eupadev/leave@sha256:{DIGEST}",
            f"deploy preview leave 4 {REG}/eupadev/other@sha256:{DIGEST}",
            f"deploy preview leave 4 {REG}/eupadev/leave@sha256:{DIGEST}A",
            f"deploy mockup leave 4 {DIGEST[:-1]}", "x" * 600,
        ]
        for line in refused:
            with self.subTest(line=line), self.assertRaises(Refusal):
                parse(line, CONF_CI)

    def test_length_limit(self):
        parse("served preview " + "a" * 40, CONF_CI)


class FakeVM:
    """Stands in for `launch`: records every argv and answers like Docker, cosign, curl and systemd-creds would."""

    def __init__(self, containers=(), other_tools=(), signature=0, health=0, up=0, core=False, migration=0):
        self.containers, self.other_tools = list(containers), list(other_tools)
        self.signature, self.health, self.up = signature, health, up
        self.core, self.migration = core, migration
        self.calls = []

    def __call__(self, argv, env=None, timeout=300):
        self.calls.append((argv, env))
        output, code = "", 0
        if argv[:3] == [deployer.DOCKER, "ps", "-aq"]:
            output = "\n".join(c["Id"] for c in self.containers)
        elif argv[:2] == [deployer.DOCKER, "inspect"]:
            output = json.dumps(self.containers)
        elif argv[:3] == [deployer.DOCKER, "ps", "-a"]:
            output = "\n".join(self.other_tools)
        elif argv[:3] == [deployer.DOCKER, "image", "inspect"]:
            output = json.dumps([{"RepoDigests": [IMAGE], "Config": {"Labels": {"eupadev.core": "0.1.0"} if self.core else {}}}])
        elif argv[:3] == [deployer.DOCKER, "network", "inspect"]:
            output = json.dumps([{"IPAM": {"Config": [{"Subnet": "172.30.5.0/24"}]}}])
        elif argv[0] == deployer.SYSTEMD_CREDS:
            output = "test-token"
        elif argv[0] == deployer.COSIGN:
            code = self.signature
        elif argv[0] == deployer.CURL:
            code = self.health
        elif argv[:2] == [deployer.DOCKER, "compose"] and "run" in argv:
            code = self.migration
        elif argv[:2] == [deployer.DOCKER, "compose"]:
            code = self.up
            if code == 0:
                self.containers = [container(cycle=env["CYCLE"], image=env["IMAGE"])]
        return subprocess.CompletedProcess(argv, code, output, "")

    def commands(self):
        return [a[0][1] if a[0][0] == deployer.DOCKER else os.path.basename(a[0][0]) for a in self.calls]


def container(cycle="4", image=IMAGE, running=True):
    return {"Id": "c1", "Image": "sha256:" + "b" * 64, "State": {"Running": running},
            "Config": {"Image": image, "Labels": {"eupadev.cycle": cycle}}}


class Deployer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (deployer.launch, deployer.REGISTRY, deployer.LOCKS, deployer.time.sleep)
        deployer.REGISTRY = os.path.join(self.tmp.name, "registry")
        deployer.LOCKS = os.path.join(self.tmp.name, "locks")
        deployer.time.sleep = lambda _s: None

    def tearDown(self):
        deployer.launch, deployer.REGISTRY, deployer.LOCKS, deployer.time.sleep = self.saved
        self.tmp.cleanup()

    def execute(self, vm, line=f"deploy preview leave 4 {IMAGE}"):
        deployer.launch = vm
        return deployer.execute(line, CONF_CI)

    def test_invalid_request_nothing_launched(self):
        vm = FakeVM()
        for line in [f"deploy preview leave 4 {IMAGE};id", "deploy preview leave 4 x", "deploy prod leave 4 x"]:
            with self.subTest(line=line), self.assertRaises(Refusal):
                self.execute(vm, line)
        self.assertEqual(vm.calls, [])

    def test_first_deployment(self):
        vm = FakeVM()
        r = self.execute(vm)
        self.assertEqual(r, {"digest": f"sha256:{DIGEST}", "url": "https://leave.preview.example.test", "health": "ok"})
        self.assertEqual(vm.commands()[:5], ["ps", "ps", "systemd-creds", "cosign", "pull"])
        self.assertIn("compose", vm.commands())
        # argv only from validated values: the image token is exactly the validated one, and the Compose
        # model reads nothing but these variables (no shell anywhere: `launch` only takes a list).
        images = [x for argv, _ in vm.calls for x in argv if "/eupadev/" in x and not x.startswith("/etc/")]
        self.assertEqual(set(images), {IMAGE})
        env_compose = next(env for argv, env in vm.calls if argv[1:2] == ["compose"])
        self.assertEqual({k: env_compose[k] for k in ("IMAGE", "NAME", "NETWORK", "ENV", "TOOL", "CYCLE")},
                         {"IMAGE": IMAGE, "NAME": "preview-leave", "NETWORK": "preview-leave", "ENV": "preview", "TOOL": "leave", "CYCLE": "4"})
        self.assertFalse(os.path.exists(deployer.REGISTRY + "-preview-leave"))  # registry login gone

    def test_already_done(self):
        vm = FakeVM(containers=[container()])
        self.assertEqual(self.execute(vm)["health"], "ok")
        self.assertNotIn("cosign", vm.commands())
        self.assertNotIn("compose", vm.commands())

    def test_same_cycle_other_image_replaced(self):
        vm = FakeVM(containers=[container(image=f"{REG}/eupadev/leave@sha256:{'c' * 64}")])
        self.execute(vm)
        self.assertIn("compose", vm.commands())

    def test_other_cycle_refused(self):
        vm = FakeVM(containers=[container(cycle="3")])
        with self.assertRaisesRegex(Refusal, "owned by cycle 3"):
            self.execute(vm)
        self.assertNotIn("cosign", vm.commands())

    def test_quota(self):
        with self.assertRaisesRegex(Refusal, "quota"):
            self.execute(FakeVM(other_tools=["a", "b", "c"]))
        self.execute(FakeVM(other_tools=["a", "b", "leave"]))  # replacing its own Preview: not counted

    def test_refused_signature_nothing_started(self):
        vm = FakeVM(signature=1)
        with self.assertRaisesRegex(Refusal, "signature"):
            self.execute(vm)
        self.assertNotIn("pull", vm.commands())
        self.assertNotIn("compose", vm.commands())
        self.assertFalse(os.path.exists(deployer.REGISTRY + "-preview-leave"))

    def test_unhealthy(self):
        vm = FakeVM(health=22)
        deployer.wait.__defaults__ = (0,)
        try:
            r = self.execute(vm)
        finally:
            deployer.wait.__defaults__ = (60,)
        self.assertEqual((r["health"], r["digest"]), ("failed", f"sha256:{DIGEST}"))
        self.assertIn("stop", vm.commands())

    def test_remove_cleans_up(self):
        vm = FakeVM(containers=[container()])
        self.assertEqual(self.execute(vm, "remove preview leave 4"), {"done": True})
        self.assertEqual(vm.commands()[2:], ["rm", "network", "network", "network", "network", "image"])
        vm = FakeVM(containers=[container(cycle="3")])
        self.assertFalse(self.execute(vm, "remove preview leave 4")["done"])
        self.assertNotIn("rm", vm.commands())



IMAGE_B = f"{REG}/eupadev/leave@sha256:{'b' * 64}"


class FakeProd:
    """The Prod target: containers with their network aliases, as `launch` would see them through Docker."""

    def __init__(self, served=None, direct=0, health=0):
        self.containers, self.direct, self.health, self.calls = [], direct, health, []
        if served:
            self.create(f"prod-leave-{served.split(':')[-1][:12]}", served, "3", alias=True)

    def create(self, name, image, cycle, alias=False):
        self.containers.append({"Id": "id-" + name, "Name": "/" + name, "Image": "img-" + image, "State": {"Running": True},
                                "Config": {"Image": image, "Labels": {"eupadev.cycle": cycle}},
                                "NetworkSettings": {"Networks": {"prod-leave": {"Aliases": [name] + (["prod-leave"] if alias else [])}}}})

    def find(self, x):
        return [c for c in self.containers if x in (c["Id"], c["Name"][1:])]

    def __call__(self, argv, env=None, timeout=300):
        self.calls.append(argv)
        a, output, code = argv[1:], "", 0
        if argv[0] == deployer.CURL:
            code = self.health
        elif argv[0] != deployer.DOCKER:
            output = "token" if argv[0] == deployer.SYSTEMD_CREDS else ""
        elif a[:2] == ["ps", "-aq"]:
            output = "\n".join(c["Id"] for c in self.containers)
        elif a[0] == "inspect":
            output = json.dumps([c for c in self.containers if c["Id"] in a[1:]])
        elif a[:2] == ["image", "inspect"]:
            output = json.dumps([{"RepoDigests": [a[2][len("img-"):]]}])
        elif a[0] == "compose":
            if not self.find(env["NAME"]):
                self.create(env["NAME"], env["IMAGE"], env["CYCLE"])
        elif a[0] == "exec":
            code = self.direct
        elif a[:2] == ["network", "disconnect"]:
            for c in self.find(a[-1]):
                c["NetworkSettings"]["Networks"]["prod-leave"]["Aliases"] = [c["Name"][1:]]
        elif a[:3] == ["network", "connect", "--alias"]:
            for c in self.find(a[-1]):
                c["NetworkSettings"]["Networks"]["prod-leave"]["Aliases"].append(a[3])
        elif a[:2] == ["rm", "-f"]:
            self.containers = [c for c in self.containers if not set(a[2:]) & {c["Id"], c["Name"][1:]}]
        return subprocess.CompletedProcess(argv, code, output, "")

    def names(self):
        return sorted((c["Name"][1:], "prod-leave" in c["NetworkSettings"]["Networks"]["prod-leave"]["Aliases"]) for c in self.containers)


class Prod(unittest.TestCase):
    """E5g decision table: nothing served / healthy new / unhealthy new / same digest already served."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (deployer.launch, deployer.REGISTRY, deployer.LOCKS, deployer.time.sleep, deployer.wait.__defaults__)
        deployer.REGISTRY = os.path.join(self.tmp.name, "registry")
        deployer.LOCKS = os.path.join(self.tmp.name, "locks")
        deployer.time.sleep = lambda _s: None
        deployer.wait.__defaults__ = (0,)

    def tearDown(self):
        deployer.launch, deployer.REGISTRY, deployer.LOCKS, deployer.time.sleep, deployer.wait.__defaults__ = self.saved
        self.tmp.cleanup()

    def deploy(self, vm, image=IMAGE_B):
        deployer.launch = vm
        return deployer.execute(f"deploy prod leave 4 {image}", CONF_PROD)

    def test_creation(self):
        vm = FakeProd()
        r = self.deploy(vm)
        self.assertEqual(r, {"digest": f"sha256:{'b' * 64}", "url": "https://leave.example.test", "health": "ok"})
        self.assertEqual(vm.names(), [("prod-leave-bbbbbbbbbbbb", True)])

    def test_healthy_new_replaces_old(self):
        vm = FakeProd(served=IMAGE)
        self.assertEqual(self.deploy(vm)["health"], "ok")
        self.assertEqual(vm.names(), [("prod-leave-bbbbbbbbbbbb", True)])
        alias = next(i for i, x in enumerate(vm.calls) if x[1:4] == ["network", "connect", "--alias"])
        removal = next(i for i, x in enumerate(vm.calls) if x[1:3] == ["rm", "-f"])
        self.assertLess(alias, removal, "traffic to the new one before the old one is removed")

    def test_unhealthy_new_old_keeps_serving(self):
        vm = FakeProd(served=IMAGE, direct=1)
        r = self.deploy(vm)
        self.assertEqual((r["health"], r["digest"]), ("failed", f"sha256:{'b' * 64}"))
        self.assertEqual(vm.names(), [("prod-leave-aaaaaaaaaaaa", True)])
        self.assertFalse(any(x[1:4] == ["network", "connect", "--alias"] for x in vm.calls), "no traffic to the unhealthy one")

    def test_already_served(self):
        vm = FakeProd(served=IMAGE_B)
        self.assertEqual(self.deploy(vm)["health"], "ok")
        self.assertFalse(any(x[1] in ("compose", "rm") for x in vm.calls if x[0] == deployer.DOCKER))
        self.assertEqual(deployer.served(CONF_PROD, "prod", "leave"), {"digest": f"sha256:{'b' * 64}", "cycle": 3})


def archive(*members):
    """tar.gz like the forge's archive (top folder <repo>/); member = (name, type, content)."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as t:
        for name, kind, content in members:
            m = tarfile.TarInfo(name)
            m.type = kind
            if kind == tarfile.SYMTYPE or kind == tarfile.LNKTYPE:
                m.linkname = "/etc/passwd"
            m.size = len(content) if kind == tarfile.REGTYPE else 0
            t.addfile(m, io.BytesIO(content) if kind == tarfile.REGTYPE else None)
    return buffer.getvalue()


GOOD = [("leave/web/index.html", tarfile.REGTYPE, b"<h1>ok</h1>"), ("leave/web/css/a.css", tarfile.REGTYPE, b"a{}"),
        ("leave/web/css", tarfile.DIRTYPE, b""), ("leave/README.md", tarfile.REGTYPE, b"the tool's secret")]


class Mockup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (deployer.MOCKUPS, deployer.MOCKUP_INDEX, deployer.LOCKS, deployer.FILES_CAP)
        deployer.MOCKUPS = os.path.join(self.tmp.name, "mockups")
        deployer.MOCKUP_INDEX = os.path.join(self.tmp.name, "index")
        deployer.LOCKS = os.path.join(self.tmp.name, "locks")

    def tearDown(self):
        deployer.MOCKUPS, deployer.MOCKUP_INDEX, deployer.LOCKS, deployer.FILES_CAP = self.saved
        self.tmp.cleanup()

    def deploy(self, data, cycle="4", digest=None):
        digest = digest or hashlib.sha256(data).hexdigest()
        return deployer.deploy_mockup(CONF_CI, "leave", cycle, digest, io.BytesIO(data))

    def written(self):
        return os.path.exists(deployer.MOCKUPS) and os.listdir(deployer.MOCKUPS)

    def test_good_archive_only_web(self):
        data = archive(*GOOD)
        dig = hashlib.sha256(data).hexdigest()
        self.assertEqual(self.deploy(data), {"digest": "sha256:" + dig, "url": f"https://mockup.example.test/{dig}/", "health": "ok"})
        root = os.path.join(deployer.MOCKUPS, dig)
        files = sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs)
        self.assertEqual(files, ["css/a.css", "index.html"])
        self.assertEqual(deployer.served_mockup("leave"), {"digest": "sha256:" + dig, "cycle": 4})
        self.assertEqual(self.deploy(b"not read: already served", digest=dig)["health"], "ok")  # same digest: nothing read

    def test_trapped_archives_refused_nothing_written(self):
        traps = {
            "symbolic link": [*GOOD, ("leave/web/x", tarfile.SYMTYPE, b"")],
            "hard link": [*GOOD, ("leave/other", tarfile.LNKTYPE, b"")],
            "device": [*GOOD, ("leave/web/dev", tarfile.CHRTYPE, b"")],
            "absolute": [*GOOD, ("/leave/web/y.html", tarfile.REGTYPE, b"y")],
            "..": [*GOOD, ("leave/web/../../z.html", tarfile.REGTYPE, b"z")],
            "no web": [("leave/README.md", tarfile.REGTYPE, b"r")],
        }
        for name, members in traps.items():
            with self.subTest(name), self.assertRaises(Refusal):
                self.deploy(archive(*members))
            self.assertFalse(self.written(), name)
        deployer.FILES_CAP = 3
        with self.assertRaisesRegex(Refusal, "caps"):
            self.deploy(archive(*GOOD))
        with self.assertRaisesRegex(Refusal, "digest"):
            self.deploy(archive(*GOOD), digest="0" * 64)
        with self.assertRaisesRegex(Refusal, "unreadable"):
            self.deploy(b"not an archive")
        self.assertFalse(self.written())

    def test_other_cycle_and_removal(self):
        self.deploy(archive(*GOOD))
        with self.assertRaisesRegex(Refusal, "owned by cycle 4"):
            self.deploy(archive(*GOOD[:2]), cycle="5")
        self.assertFalse(deployer.remove_mockup("leave", "5")["done"])
        self.assertEqual(deployer.remove_mockup("leave", "4"), {"done": True})
        self.assertEqual(os.listdir(deployer.MOCKUPS), [])
        self.assertIsNone(deployer.served_mockup("leave"))


def compose(vm):
    """The Compose calls of a fake VM: (subcommand, service, env), in order."""
    out = []
    for argv, env in vm.calls:
        if argv[:2] == [deployer.DOCKER, "compose"]:
            sub = "run" if "run" in argv else "up"
            out.append((sub, argv[-1] if sub == "run" else None, env, argv))
    return out


class Core(unittest.TestCase):
    """d5: a core image needs its Gate 1 entry; migration before traffic; core variables; purge."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (deployer.launch, deployer.REGISTRY, deployer.LOCKS, deployer.time.sleep,
                      deployer.TOOLS, deployer.TOOL_SECRETS, deployer.wait.__defaults__)
        deployer.REGISTRY = os.path.join(self.tmp.name, "registry")
        deployer.LOCKS = os.path.join(self.tmp.name, "locks")
        deployer.TOOLS = os.path.join(self.tmp.name, "tools")
        deployer.TOOL_SECRETS = os.path.join(self.tmp.name, "secrets")
        deployer.time.sleep = lambda _s: None
        deployer.wait.__defaults__ = (0,)
        os.makedirs(deployer.TOOLS)
        os.makedirs(deployer.TOOL_SECRETS)

    def tearDown(self):
        (deployer.launch, deployer.REGISTRY, deployer.LOCKS, deployer.time.sleep,
         deployer.TOOLS, deployer.TOOL_SECRETS, deployer.wait.__defaults__) = self.saved
        self.tmp.cleanup()

    def register(self, client="leave-preview", retentions=None):
        with open(os.path.join(deployer.TOOLS, "leave.json"), "w") as f:
            json.dump({"client_id": client, "retentions": retentions or {"RETENTION_AUDIT": "400 days"}}, f)
        for x in deployer.CORE_SECRETS:
            open(os.path.join(deployer.TOOL_SECRETS, f"tool-leave-{x}"), "w").close()

    def execute(self, vm, line=f"deploy preview leave 4 {IMAGE}", conf=None):
        deployer.launch = vm
        return deployer.execute(line, conf or {**CONF_CI, "issuer": "https://auth.example.test/realms/tools"})

    def test_vanilla_unchanged(self):
        vm = FakeVM()
        self.assertEqual(self.execute(vm)["health"], "ok")
        self.assertEqual([c[0] for c in compose(vm)], ["up"])
        self.assertNotIn(deployer.CORE_MODEL, compose(vm)[0][3])
        self.assertNotIn(deployer.DB, [x for argv, _ in vm.calls for x in argv])

    def test_no_entry_refused_nothing_started(self):
        vm = FakeVM(core=True)
        with self.assertRaisesRegex(Refusal, "not registered at Gate 1: paste the entry shown on the tool's Gate 1 page into .*core-tools.yml, then run ansible-playbook register-tools.yml"):
            self.execute(vm)
        self.assertEqual(compose(vm), [])

    def test_missing_secrets_nothing_started(self):
        self.register()
        os.remove(os.path.join(deployer.TOOL_SECRETS, "tool-leave-oidc"))
        vm = FakeVM(core=True)
        with self.assertRaisesRegex(RuntimeError, "register-tools"):
            self.execute(vm)
        self.assertEqual(compose(vm), [])

    def test_invalid_entry(self):
        for bad in [{"RETENTION_AUDIT": "forever"}, {"AUDIT": "1 days"}, {"RETENTION_AUDIT": "1 days; DROP"}]:
            self.register(retentions=bad)
            with self.subTest(bad), self.assertRaisesRegex(RuntimeError, "invalid Gate 1 entry"):
                self.execute(FakeVM(core=True))

    def test_migration_then_traffic(self):
        self.register()
        vm = FakeVM(core=True)
        self.assertEqual(self.execute(vm)["health"], "ok")
        calls = compose(vm)
        self.assertEqual([(c[0], c[1]) for c in calls], [("run", "migrate"), ("run", "seed"), ("up", None)])
        for _, _, env, argv in calls:
            self.assertIn(deployer.CORE_MODEL, argv)
            self.assertEqual({k: env[k] for k in ("HOST", "ISSUER", "CLIENT", "TRUST_PROXY")},
                             {"HOST": "leave.preview.example.test", "ISSUER": "https://auth.example.test/realms/tools",
                              "CLIENT": "leave-preview", "TRUST_PROXY": "172.30.5.0/24"})
        plugged = [argv[-1] for argv, _ in vm.calls if argv[1:3] == ["network", "connect"]]
        self.assertTrue({deployer.CADDY, deployer.DB, deployer.SMOKESCREEN} <= set(plugged))

    def test_failed_migration_preview_intact(self):
        self.register()
        old = container(image=f"{REG}/eupadev/leave@sha256:{'c' * 64}")
        vm = FakeVM(containers=[old], core=True, migration=1)
        r = self.execute(vm)
        self.assertEqual((r["health"], r["digest"]), ("failed", f"sha256:{DIGEST}"))
        self.assertIn("migration failed", r["reason"])
        # No `up`: the old Preview keeps serving, its emptied schema rebuilt by its own image's migration.
        self.assertEqual([(c[0], c[2]["IMAGE"]) for c in compose(vm)], [("run", IMAGE), ("run", old["Config"]["Image"])])
        self.assertNotIn("stop", vm.commands())
        self.assertNotIn("rm", vm.commands())

    def test_new_digest_preview_emptied_before_migration(self):
        self.register()
        vm = FakeVM(containers=[container(image=f"{REG}/eupadev/leave@sha256:{'c' * 64}")], core=True)
        self.assertEqual(self.execute(vm)["health"], "ok")
        argvs = [argv for argv, _ in vm.calls]
        emptied = [i for i, a in enumerate(argvs) if a[1:3] == ["exec", deployer.DB]]
        self.assertEqual(len(emptied), 1)
        self.assertEqual(argvs[emptied[0]][-1], 'DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA app AUTHORIZATION "leave_owner"')
        self.assertIn("leave", argvs[emptied[0]])  # the tool's own database
        self.assertLess(emptied[0], next(i for i, a in enumerate(argvs) if a[1:2] == ["compose"]))

    def test_same_digest_data_kept(self):
        self.register()
        vm = FakeVM(containers=[container(running=False)], core=True)  # same digest, stopped: redeployed
        self.assertEqual(self.execute(vm)["health"], "ok")
        self.assertIn("compose", vm.commands())
        self.assertNotIn("exec", vm.commands())
        self.assertEqual([(c[0], c[1]) for c in compose(vm)], [("run", "migrate"), ("up", None)])  # no seed: data kept

    def test_new_digest_preview_seeded_after_migration(self):
        self.register()
        vm = FakeVM(containers=[container(image=f"{REG}/eupadev/leave@sha256:{'c' * 64}")], core=True)
        self.assertEqual(self.execute(vm)["health"], "ok")
        self.assertEqual([(c[0], c[1]) for c in compose(vm)], [("run", "migrate"), ("run", "seed"), ("up", None)])
        seeded = next(c for c in compose(vm) if c[1] == "seed")
        self.assertEqual((seeded[2]["IMAGE"], seeded[2]["TOOL"]), (IMAGE, "leave"))  # same image, same model
        self.assertIn(deployer.CORE_MODEL, seeded[3])
        emptied = next(i for i, (a, _) in enumerate(vm.calls) if a[1:3] == ["exec", deployer.DB])
        self.assertLess(emptied, next(i for i, (a, _) in enumerate(vm.calls) if a[1:2] == ["compose"]))

    def test_failed_seed_preview_intact(self):
        self.register()
        old = container(image=f"{REG}/eupadev/leave@sha256:{'c' * 64}")
        vm = FakeVM(containers=[old], core=True)
        real = vm.__call__
        vm_failing = lambda argv, env=None, timeout=300: (  # noqa: E731
            (vm.calls.append((argv, env)), subprocess.CompletedProcess(argv, 1, "", "demo.sql refused"))[1] if argv[-1] == "seed"
            else real(argv, env, timeout))
        vm_failing.calls = vm.calls
        r = self.execute(vm_failing)
        self.assertEqual((r["health"], r["digest"]), ("failed", f"sha256:{DIGEST}"))
        self.assertIn("demo seed failed: demo.sql refused", r["reason"])
        # Same path as a failed migration: no `up`, the old Preview keeps serving on its own rebuilt schema.
        self.assertEqual([(c[0], c[1], c[2]["IMAGE"]) for c in compose(vm)],
                         [("run", "migrate", IMAGE), ("run", "seed", IMAGE), ("run", "migrate", old["Config"]["Image"])])
        self.assertNotIn("stop", vm.commands())
        self.assertNotIn("rm", vm.commands())

    def test_failed_reset_nothing_started(self):
        self.register()
        vm = FakeVM(core=True)
        real = vm.__call__
        vm_failing = lambda argv, env=None, timeout=300: (  # noqa: E731
            subprocess.CompletedProcess(argv, 1, "", "boom") if argv[1:2] == ["exec"] else real(argv, env, timeout))
        vm_failing.calls = vm.calls
        with self.assertRaisesRegex(RuntimeError, "reset failed"):
            self.execute(vm_failing)
        self.assertEqual(compose(vm), [])

    def test_prod_never_emptied(self):
        self.register(client="leave")
        core = CoreProd(FakeProd(served=IMAGE))
        self.assertEqual(self.execute(core, f"deploy prod leave 4 {IMAGE_B}", {**CONF_PROD, "issuer": "https://i"})["health"], "ok")
        self.assertIn("migrate", [a[-1] for a in core.calls])
        self.assertNotIn("seed", [a[-1] for a in core.calls])  # demo data never reach Prod
        self.assertEqual([a for a in core.calls if a[1:3] == ["exec", deployer.DB]], [])

    def test_failed_migration_prod_old_serves(self):
        self.register(client="leave")
        vm = FakeProd(served=IMAGE)
        core = CoreProd(vm, migration=1)
        r = self.execute(core, f"deploy prod leave 4 {IMAGE_B}", {**CONF_PROD, "issuer": "https://i"})
        self.assertEqual(r["health"], "failed")
        self.assertEqual(vm.names(), [("prod-leave-aaaaaaaaaaaa", True)])

    def test_purge_prod(self):
        self.register(client="leave", retentions={"RETENTION_AUDIT": "400 days", "RETENTION_REQUESTS": "3 years"})
        vm = FakeProd(served=IMAGE)
        core = CoreProd(vm)
        r = self.execute(core, "purge prod leave", {**CONF_PROD, "issuer": "https://i"})
        self.assertTrue(r["done"])
        run = next(a for a in core.calls if a[1:2] == ["compose"])
        self.assertEqual(run[-6:], ["--rm", "-e", "RETENTION_AUDIT=400 days", "-e", "RETENTION_REQUESTS=3 years", "purge"])
        self.assertIn("prod-leave-aaaaaaaaaaaa", run)  # the served version's project

    def test_purge_refused_outside_prod_and_without_service(self):
        with self.assertRaises(Refusal):
            self.execute(FakeVM(), "purge preview leave")
        self.assertFalse(self.execute(CoreProd(FakeProd()), "purge prod leave", {**CONF_PROD, "issuer": "i"})["done"])

    def test_failed_purge_code_1(self):
        self.register(client="leave")
        with self.assertRaisesRegex(RuntimeError, "purge failed"):
            self.execute(CoreProd(FakeProd(served=IMAGE), migration=1), "purge prod leave", {**CONF_PROD, "issuer": "i"})


class CoreProd:
    """FakeProd seen with a core image: labels, subnet, and `compose run` (migration or purge) answering `migration`."""

    def __init__(self, prod, migration=0):
        self.prod, self.migration, self.calls = prod, migration, prod.calls

    def __call__(self, argv, env=None, timeout=300):
        if argv[:3] == [deployer.DOCKER, "image", "inspect"]:
            self.calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps([{"RepoDigests": [argv[3].removeprefix("img-")],
                                                                      "Config": {"Labels": {"eupadev.core": "0"}}}]), "")
        if argv[:3] == [deployer.DOCKER, "network", "inspect"]:
            self.calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps([{"IPAM": {"Config": [{"Subnet": "172.30.6.0/24"}]}}]), "")
        if argv[:2] == [deployer.DOCKER, "compose"] and "run" in argv:
            self.calls.append(argv)
            return subprocess.CompletedProcess(argv, self.migration, '{"msg":"purge"}', "")
        return self.prod(argv, env, timeout)


if __name__ == "__main__":
    unittest.main()
