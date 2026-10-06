/**
 * Config collection.
 *
 * Two modes:
 *   - mock: deterministic synthetic configs, so the tool is demoable and
 *     testable with no network gear attached.
 *   - ssh:  real collection via the system `ssh` binary.
 *
 * No vendor SDK dependencies on purpose: a drift tool that needs a compiled
 * netmiko install is a drift tool nobody runs.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const NOISE = [
  "Building configuration...",
  "Current configuration : 2843 bytes",
  "! Last configuration change at 23:41:02 UTC Mon Oct 6 2026 by nawapon",
  "R1#show running-config",
];

/**
 * Deterministic pseudo-random generator seeded by device name.
 * Same device always yields the same "running" config, which is what makes the
 * mock mode useful for testing.
 */
function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
}

const DRIFT_LINES = [
  "ip access-list extended MGMT permit tcp any any eq 22",
  "logging buffered 32768 informational",
  "snmp-server community public RO",
  "ntp server 162.159.200.1 prefer",
  "banner motd ^C Unauthorized access prohibited^C",
];

/**
 * Build a synthetic "running" config for a device.
 * @param {object} device inventory entry
 * @param {number} driftLevel 0 = matches baseline, 1+ = inject extra lines
 */
export function mockRunningConfig(device, driftLevel = 0) {
  const rnd = seededRandom(device.name);
  const lines = [
    `hostname ${device.name}`,
    "no ip domain lookup",
    `interface ${device.mgmt || "GigabitEthernet0/0"}`,
    ` ip address ${device.mgmtIp || "10.0.0.1"} 255.255.255.252`,
    " no shutdown",
    "router ospf 1",
    ` router-id ${device.routerId || "1.1.1.1"}`,
    ` area 0 network ${device.network || "10.0.0.0"} 0.0.0.3`,
    "line con 0",
    " exec-timeout 5 0",
    "line vty 0 4",
    " transport input ssh",
    ...NOISE,
  ];

  const count = Math.round(driftLevel * 3);
  for (let i = 0; i < count; i++) {
    lines.splice(
      Math.floor(rnd() * lines.length),
      0,
      DRIFT_LINES[Math.floor(rnd() * DRIFT_LINES.length)]
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Collect a running config from a real device over SSH.
 * Uses the system ssh binary with BatchMode so it never blocks on a prompt.
 */
export async function sshRunningConfig(device, timeoutMs = 15000) {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
    device.username ? `-l${device.username}` : "",
    device.name,
    device.command || "show running-config",
  ].filter(Boolean);

  try {
    const { stdout } = await pexec("ssh", args, { timeout: timeoutMs, maxBuffer: 8 << 20 });
    return { ok: true, config: stdout, error: null };
  } catch (err) {
    return {
      ok: false,
      config: null,
      error: err.stderr?.trim() || err.message || "ssh failed",
    };
  }
}

/**
 * Collect config for one device according to the requested mode.
 */
export async function collect(device, { mock = false, driftLevel = 0 } = {}) {
  if (mock) {
    return { ok: true, config: mockRunningConfig(device, driftLevel), error: null };
  }
  return sshRunningConfig(device);
}

export default { collect, mockRunningConfig, sshRunningConfig };