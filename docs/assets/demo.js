/**
 * Interactive demo for the landing page.
 *
 * The point is to make the core idea obvious in five seconds without installing
 * anything: a device that matches what you intended, versus one where someone
 * changed something. Everything here is fiction.
 */

const BASELINE = [
  "hostname R1",
  "no ip domain lookup",
  "interface GigabitEthernet0/0",
  " ip address 10.0.0.1 255.255.255.252",
  " no shutdown",
  "router ospf 1",
  " area 0 network 10.0.0.0 0.0.0.3",
  "line vty 0 4",
  " transport input ssh",
];

// Someone changed it overnight: added three things, removed one.
const CHANGED = [
  "hostname R1",
  "no ip domain lookup",
  "snmp-server community public RO",
  "banner motd ^C Unauthorized access prohibited^C",
  "interface GigabitEthernet0/0",
  " ip address 10.0.0.1 255.255.255.252",
  " no shutdown",
  "router ospf 1",
  " area 0 network 10.0.0.0 0.0.0.3",
  "line vty 0 4",
  " transport input ssh",
  "ntp server 162.159.200.1 prefer",
];

const EXPLANATIONS = {
  clean:
    "R1 matches the config in git. Nothing to report — so there's nothing to do.",
  drift:
    "R1 no longer matches git. Three lines were added that you never approved, " +
    "and one you configured deliberately is gone.",
};

const el = {
  diff: document.getElementById("diff"),
  state: document.getElementById("state"),
  dot: document.getElementById("dot"),
  explain: document.getElementById("explain"),
  summary: document.getElementById("summary"),
  clean: document.getElementById("btn-clean"),
  drift: document.getElementById("btn-drift"),
};

function row(text, kind) {
  const div = document.createElement("div");
  div.className = "diff-row " + (kind || "ctx");
  const sgn = document.createElement("span");
  sgn.className = "sgn";
  sgn.textContent = kind === "add" ? "+" : kind === "del" ? "−" : " ";
  const body = document.createElement("span");
  body.textContent = text;
  div.append(sgn, body);
  return div;
}

function renderDrift() {
  // Show context around the first difference, then the differences themselves.
  const out = [];
  out.push(row("! Running config differs from baseline", "ctx"));
  out.push(row(""));
  CHANGED.slice(0, 2).forEach((l) => out.push(row(l, "ctx")));
  out.push(row("snmp-server community public RO", "add"));
  out.push(row("banner motd ^C Unauthorized access prohibited^C", "add"));
  out.push(row("interface GigabitEthernet0/0", "ctx"));
  out.push(row(" ip address 10.0.0.1 255.255.255.252", "ctx"));
  out.push(row(" no shutdown", "ctx"));
  out.push(row("line vty 0 4", "ctx"));
  out.push(row(" transport input ssh", "ctx"));
  out.push(row("ntp server 162.159.200.1 prefer", "add"));
  out.push(row(""));
  out.push(row("! 3 unexpected · 1 missing", "ctx"));
  return out;
}

function renderClean() {
  return BASELINE.map((l) => row(l, "ctx"));
}

function show(drifted) {
  el.diff.replaceChildren(...(drifted ? renderDrift() : renderClean()));

  el.state.textContent = drifted ? "DRIFT" : "CLEAN";
  el.state.classList.toggle("drift", drifted);
  el.dot.classList.toggle("drift", drifted);

  el.explain.textContent = EXPLANATIONS[drifted ? "drift" : "clean"];
  el.summary.textContent = drifted ? "4 changes" : "0 changes";

  el.clean.classList.toggle("active", !drifted);
  el.drift.classList.toggle("active", drifted);
}

el.clean.addEventListener("click", () => show(false));
el.drift.addEventListener("click", () => show(true));

show(false);