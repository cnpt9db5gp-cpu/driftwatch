#!/usr/bin/env node
/**
 * driftwatch — catch network config drift before it bites you at 2am.
 *
 * Commands:
 *   check    collect from every device, compare against baseline, report
 *   pull     collect and overwrite the baseline (accept the current state)
 *   init     scaffold an inventory and baseline
 *   help
 *
 * Exit codes: 0 = clean, 1 = drift detected, 2 = collection error.
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { compare } from "./diff.js";
import { collect } from "./collect.js";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function loadInventory(pathToInventory) {
  const raw = await readFile(pathToInventory, "utf8");
  return JSON.parse(raw);
}

function baselinePathFor(baselineDir, device) {
  return path.join(baselineDir, `${device.name}.cfg`);
}

async function readBaseline(file) {
  if (!existsSync(file)) return null;
  return readFile(file, "utf8");
}

/* ---------------------------------- init ---------------------------------- */

async function cmdInit(args) {
  const inventory = args.flags.inventory || "driftwatch.json";
  const baselineDir = args.flags.baseline || "baseline";

  if (!existsSync(inventory)) {
    const scaffold = {
      version: 1,
      defaults: { command: "show running-config" },
      devices: [
        {
          name: "R1",
          host: "10.0.0.1",
          username: "netops",
          network: "10.0.0.0",
          routerId: "1.1.1.1",
        },
      ],
    };
    await writeFile(inventory, JSON.stringify(scaffold, null, 2) + "\n");
    console.log(`${GREEN}created${RESET} ${inventory}`);
  } else {
    console.log(`${YELLOW}exists${RESET}  ${inventory}`);
  }

  await mkdir(baselineDir, { recursive: true });
  console.log(`${GREEN}created${RESET} ${baselineDir}/`);
  console.log(`\nNext: ${BOLD}driftwatch pull${RESET} to capture your first baseline.`);
}

/* ---------------------------------- pull ---------------------------------- */

async function cmdPull(args) {
  const inventoryPath = args.flags.inventory || "driftwatch.json";
  const baselineDir = args.flags.baseline || "baseline";
  const mock = Boolean(args.flags.mock);

  const inv = await loadInventory(inventoryPath);
  await mkdir(baselineDir, { recursive: true });

  for (const device of inv.devices) {
    const res = await collect(device, { mock, driftLevel: 0 });
    if (!res.ok) {
      console.log(`${RED}fail${RESET}   ${device.name}: ${res.error}`);
      continue;
    }
    const out = baselinePathFor(baselineDir, device);
    await writeFile(out, res.config);
    console.log(`${GREEN}saved${RESET}  ${out}`);
  }
  console.log(`\nCommit these. They are your intended state.`);
}

/* --------------------------------- check ---------------------------------- */

async function cmdCheck(args) {
  const inventoryPath = args.flags.inventory || "driftwatch.json";
  const baselineDir = args.flags.baseline || "baseline";
  const mock = Boolean(args.flags.mock);
  // --drift N injects N synthetic live changes per device (demo/testing)
  const driftLevel = Number(args.flags.drift ?? 0);

  if (!existsSync(inventoryPath)) {
    console.error(`${RED}error${RESET} no inventory at ${inventoryPath} — run ${BOLD}driftwatch init${RESET}`);
    process.exit(2);
  }

  const inv = await loadInventory(inventoryPath);
  let clean = 0;
  let drifted = 0;
  let errored = 0;
  const driftReports = [];

  for (const device of inv.devices) {
    const res = await collect(device, { mock, driftLevel });
    const base = await readBaseline(baselinePathFor(baselineDir, device));

    if (!res.ok) {
      console.log(`${RED}ERROR ${RESET}${device.name.padEnd(10)} ${res.error}`);
      errored++;
      continue;
    }
    if (base === null) {
      console.log(`${YELLOW}NO BASE ${RESET}${device.name.padEnd(10)} run ${BOLD}driftwatch pull${RESET} first`);
      errored++;
      continue;
    }

    const cmp = compare(base, res.config);
    if (!cmp.drift) {
      console.log(`${GREEN}OK    ${RESET}${device.name.padEnd(10)} ${DIM}config matches intent${RESET}`);
      clean++;
    } else {
      console.log(`${RED}DRIFT ${RESET}${device.name.padEnd(10)} ${cmp.missing} missing, ${cmp.unexpected} unexpected`);
      for (const c of cmp.changes) {
        const sign = c.type === "removed" ? `${RED}-${RESET}` : `${YELLOW}+${RESET}`;
        console.log(`        ${sign} ${c.value}`);
      }
      drifted++;
      driftReports.push({ device: device.name, ...cmp });
    }
  }

  const total = inv.devices.length;
  console.log(
    `\n${BOLD}${clean} clean${RESET}${drifted ? `, ${RED}${drifted} drifted${RESET}` : ""}` +
      `${errored ? `, ${YELLOW}${errored} unchecked${RESET}` : ""}` +
      ` ${DIM}of ${total}${RESET}`
  );

  if (drifted) process.exit(1);
  if (errored && !drifted) process.exit(2);
  process.exit(0);
}

/* ---------------------------------- help ---------------------------------- */

function cmdHelp() {
  console.log(`${BOLD}driftwatch${RESET} — catch network config drift before it bites you at 2am

${BOLD}Usage${RESET}
  driftwatch <command> [flags]

${BOLD}Commands${RESET}
  init      scaffold an inventory and baseline directory
  pull      collect configs and overwrite the baseline (accept current state)
  check     collect, compare against baseline, report drift

${BOLD}Flags${RESET}
  --inventory <file>   default: driftwatch.json
  --baseline <dir>     default: baseline
  --mock               use synthetic devices (no network gear needed)
  --drift <n>          inject n synthetic live changes (demo/testing)

${BOLD}Examples${RESET}
  driftwatch init
  driftwatch pull --mock
  driftwatch check --mock
  driftwatch check --mock --drift 1

${BOLD}Exit codes${RESET}
  0 clean · 1 drift detected · 2 collection error
`);
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "help";
  try {
    switch (cmd) {
      case "init":
        return await cmdInit(args);
      case "pull":
        return await cmdPull(args);
      case "check":
        return await cmdCheck(args);
      case "help":
      case "--help":
      case "-h":
        return cmdHelp();
      default:
        console.error(`${RED}unknown command${RESET} ${cmd}`);
        cmdHelp();
        process.exit(2);
    }
  } catch (err) {
    console.error(`${RED}error${RESET} ${err.message}`);
    process.exit(2);
  }
}

main();