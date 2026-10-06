# driftwatch

**Catch network config drift before it bites you at 2am.**

Your intended config lives in git. Driftwatch polls your devices, compares live
state against that intent, and tells you exactly what changed — and who changed it.

Most people find out they have drift the expensive way. This makes it a `git diff`.

```
OK    R1         config matches intent
DRIFT SW1        1 missing, 2 unexpected
        + snmp-server community public RO
        - ip route 0.0.0.0 0.0.0.0 10.0.0.254
        + banner motd ^C Unauthorized access prohibited^C

2 clean, 1 drifted of 3
```

## Why not just Ansible / SaltStack / Batfish

Those are heavier than most people need, and all of them assume you already have
inventory and a source of truth. Driftwatch is one binary, one JSON file, and a
directory of baseline configs in git. If you have 3 devices and a laptop, that's
the whole setup.

## Install

```bash
git clone https://github.com/cnpt9db5gp-cpu/driftwatch
cd driftwatch
npm install
```

No runtime dependencies. Node 20+.

## Quick start — try it with no gear

```bash
node src/cli.js pull --inventory examples/inventory.json --baseline examples/baseline --mock
node src/cli.js check --inventory examples/inventory.json --baseline examples/baseline --mock
```

## Real use

```bash
# 1. scaffold
node src/cli.js init

# 2. capture your intended state (needs SSH keys to your devices)
node src/cli.js pull

# 3. commit the baseline — this is now your source of truth
git add baseline/ && git commit -m "baseline: capture intended config"

# 4. check on a schedule
node src/cli.js check
```

Run it from cron, CI, or a webhook. Exit `0` clean, `1` drift, `2` unreachable —
so it composes with anything.

## Inventory format

```json
{
  "version": 1,
  "defaults": { "command": "show running-config" },
  "devices": [
    {
      "name": "R1",
      "host": "10.0.0.1",
      "username": "netops",
      "command": "show running-config"
    }
  ]
}
```

## Design decisions

**Noise is stripped before diffing.** Devices emit timestamps, uptime counters,
byte counts, and command echoes. Diffing raw output means learning to ignore
red lines, and people stop reading the output. So normalization happens first —
the diff shows only real configuration.

**Order is preserved, deliberately.** ACL entries, static routes, and prefix
lists are evaluated in order. A reordered config is a *different* config. Sorting
to make diffs look tidy would hide real misconfiguration.

**No vendor SDKs.** Collection uses the system `ssh` binary in batch mode. A tool
that needs a compiled netmiko install is a tool nobody runs at 2am.

**Missing vs unexpected are distinct.** "Missing" means someone deleted
something you intended. "Unexpected" means someone added something you never
approved. Those are different incidents and deserve different urgency.

## Commands

| Command | What it does |
|---|---|
| `init` | scaffold inventory + baseline dir |
| `pull` | collect configs, overwrite baseline (accept current state) |
| `check` | collect, compare, report drift |

| Flag | Default | Purpose |
|---|---|---|
| `--inventory <file>` | `driftwatch.json` | device list |
| `--baseline <dir>` | `baseline` | intended-state configs |
| `--mock` | off | synthetic devices, no gear needed |
| `--drift <n>` | `0` | inject synthetic changes (demo/CI testing) |

## Test

```bash
node --test test/
```

## License

MIT