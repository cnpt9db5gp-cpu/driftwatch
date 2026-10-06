/**
 * HTTP status dashboard.
 *
 * Runs the same comparison the CLI does, then renders it as a page you can
 * leave open on a wall display. No framework, no build step: the point of this
 * tool is that it runs at 2am with nothing installed.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { compare } from "./diff.js";
import { collect } from "./collect.js";

const ESC = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Run the check across an inventory and return structured results.
 * Shared by both the CLI and the dashboard so they can never disagree.
 */
export async function runCheck({ inventoryPath, baselineDir, mock, driftLevel = 0 }) {
  const raw = await readFile(inventoryPath, "utf8");
  const inv = JSON.parse(raw);

  const devices = [];
  for (const device of inv.devices) {
    const res = await collect(device, { mock, driftLevel });
    const basePath = path.join(baselineDir, `${device.name}.cfg`);

    if (!res.ok) {
      devices.push({ name: device.name, state: "error", error: res.error, changes: [] });
      continue;
    }
    if (!existsSync(basePath)) {
      devices.push({
        name: device.name,
        state: "nobaseline",
        error: "no baseline captured — run driftwatch pull",
        changes: [],
      });
      continue;
    }

    const base = await readFile(basePath, "utf8");
    const cmp = compare(base, res.config);
    devices.push({
      name: device.name,
      state: cmp.drift ? "drift" : "clean",
      missing: cmp.missing,
      unexpected: cmp.unexpected,
      changes: cmp.changes,
    });
  }
  return { devices, checkedAt: new Date().toISOString() };
}

function renderCard(d) {
  const badge = {
    clean: ["#0f7b3f", "CLEAN"],
    drift: ["#b3261e", "DRIFT"],
    error: ["#7a5c00", "UNREACHABLE"],
    nobaseline: ["#444", "NO BASELINE"],
  }[d.state];

  const lines = d.changes
    .map(
      (c) =>
        `<li><code class="${c.type === "removed" ? "del" : "add"}">${
          c.type === "removed" ? "−" : "+"
        }</code> ${ESC(c.value)}</li>`
    )
    .join("");

  return `
  <section class="card ${d.state}">
    <header>
      <span class="dot" style="background:${badge[0]}"></span>
      <h2>${ESC(d.name)}</h2>
      <span class="badge" style="background:${badge[0]}">${badge[1]}</span>
    </header>
    ${
      d.state === "drift"
        ? `<p class="counts">${d.missing} missing · ${d.unexpected} unexpected</p>
           <ul class="changes">${lines}</ul>`
        : d.error
          ? `<p class="err">${ESC(d.error)}</p>`
          : `<p class="ok">Config matches intent.</p>`
    }
  </section>`;
}

export function renderHtml(result) {
  const drifted = result.devices.filter((d) => d.state === "drift").length;
  const healthy = drifted === 0 && result.devices.every((d) => d.state === "clean");
  const banner = healthy ? ["#0f7b3f", "All devices match intent"] : ["#b3261e", `${drifted} device(s) drifted`];

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>driftwatch</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem; background:#0d0f12; color:#e6e6e6;
         font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  h1 { font-size:1.1rem; letter-spacing:.18em; text-transform:uppercase;
       color:#8b949e; margin:0 0 1.5rem; }
  .banner { padding:1rem 1.25rem; border-radius:8px; background:${banner[0]};
            font-size:1.05rem; font-weight:600; margin-bottom:1.75rem; }
  .stamp { color:#6e7681; font-size:.8rem; margin-top:2rem; }
  .grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:1rem 1.25rem; }
  .card header { display:flex; align-items:center; gap:.6rem; margin-bottom:.6rem; }
  .card h2 { font-size:1rem; margin:0; flex:1; }
  .dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
  .badge { font-size:.62rem; padding:.15rem .5rem; border-radius:4px; color:#fff; letter-spacing:.08em; }
  .counts { color:#8b949e; font-size:.82rem; margin:.25rem 0 .6rem; }
  .changes { list-style:none; margin:0; padding:0; font-size:.83rem; }
  .changes li { padding:.15rem 0; border-top:1px solid #21262d; }
  .changes code { font-weight:700; margin-right:.4rem; }
  .add { color:#d29922; } .del { color:#f85149; }
  .ok { color:#3fb950; } .err { color:#d29922; }
</style></head>
<body>
  <h1>driftwatch</h1>
  <div class="banner">${ESC(banner[1])}</div>
  <div class="grid">${result.devices.map(renderCard).join("")}</div>
  <p class="stamp">Checked ${result.checkedAt} · refreshes on reload</p>
  <meta http-equiv="refresh" content="30">
</body></html>`;
}

/**
 * Serve the dashboard. Binds loopback by default — exposing a status page that
 * lists your network devices is not something to do on 0.0.0.0 by accident.
 */
export async function serve(opts = {}) {
  const {
    port = 8787,
    host = "127.0.0.1",
    inventory = "driftwatch.json",
    baselineDir = "baseline",
    mock = false,
    driftLevel = 0,
  } = opts;

  const server = createServer(async (req, res) => {
    try {
      const result = await runCheck({ inventoryPath: inventory, baselineDir, mock, driftLevel });
      const drifted = result.devices.some((d) => d.state === "drift");
      res.writeHead(drifted ? 409 : 200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHtml(result));
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`driftwatch: ${err.message}`);
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  return { url: `http://${host}:${port}`, server };
}

export default { serve, runCheck, renderHtml };