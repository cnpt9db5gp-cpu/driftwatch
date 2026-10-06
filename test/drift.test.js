import { test } from "node:test";
import assert from "node:assert";
import { normalize } from "../src/normalize.js";
import { compare } from "../src/diff.js";

test("normalize strips noise lines", () => {
  const raw = [
    "hostname R1",
    "! Last configuration change at 23:41:02 UTC by nawapon",
    "Building configuration...",
    "Current configuration : 2843 bytes",
    "R1#show running-config",
  ].join("\n");
  const out = normalize(raw);
  assert.deepStrictEqual(out, ["hostname R1"]);
});

test("normalize dedupes and canonicalizes whitespace", () => {
  const raw = ["interface Gi0/0", "interface  Gi0/0", "  ip  address   1.1.1.1  255.255.255.0"].join("\n");
  const out = normalize(raw);
  assert.deepStrictEqual(out, ["interface Gi0/0", "ip address 1.1.1.1 255.255.255.0"]);
});

test("identical configs show no drift", () => {
  const cfg = "hostname R1\nno ip domain lookup\nline vty 0 4\n transport input ssh";
  assert.strictEqual(compare(cfg, cfg).drift, false);
});

test("live-added line is reported as unexpected", () => {
  const base = "hostname R1\nno ip domain lookup";
  const live = "hostname R1\nno ip domain lookup\nsnmp-server community public RO";
  const r = compare(base, live);
  assert.strictEqual(r.drift, true);
  assert.strictEqual(r.unexpected, 1);
  assert.strictEqual(r.missing, 0);
});

test("deleted intent is reported as missing", () => {
  const base = "hostname R1\nntp server 162.159.200.1 prefer";
  const live = "hostname R1";
  const r = compare(base, live);
  assert.strictEqual(r.drift, true);
  assert.strictEqual(r.missing, 1);
  assert.strictEqual(r.unexpected, 0);
});

test("reordered config IS drift, because sequence is meaning", () => {
  // ACL entries, static routes and prefix lists are evaluated in order,
  // so a reordered config is genuinely a different config.
  const base = "hostname R1\nno ip domain lookup\nline vty 0 4";
  const live = "line vty 0 4\nno ip domain lookup\nhostname R1";
  assert.strictEqual(compare(base, live).drift, true);
});

test("runtime noise does not create false drift", () => {
  const base = "hostname R1\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0";
  const live = [
    "hostname R1",
    "! Last configuration change at 01:12:00 UTC",
    "interface Gi0/0",
    " ip address 10.0.0.1 255.255.255.0",
    "Building configuration...",
  ].join("\n");
  assert.strictEqual(compare(base, live).drift, false);
});