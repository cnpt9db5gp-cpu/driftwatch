/**
 * Line-level diff used to decide whether a device has drifted.
 *
 * Standard LCS diff, but shaped for config review: we care about *which*
 * statements are missing from the device and which are unexpected, not about
 * character-level noise.
 */

import { normalize } from "./normalize.js";

/**
 * Compute an LCS-based diff between two arrays.
 * Returns an ordered list of { type, value } entries.
 */
export function diffLines(a, b) {
  const n = a.length;
  const m = b.length;

  // Guard against pathological memory use on huge configs.
  if (n * m > 4_000_000) {
    return [
      ...a.map((value) => ({ type: "removed", value })),
      ...b.map((value) => ({ type: "added", value })),
    ];
  }

  // lcs[i][j] = length of LCS of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "removed", value: a[i] });
      i++;
    } else {
      out.push({ type: "added", value: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "removed", value: a[i++] });
  while (j < m) out.push({ type: "added", value: b[j++] });
  return out;
}

/**
 * Compare a device's running config against its baseline.
 *
 * @param {string} baselineText  config stored in git (the intended state)
 * @param {string} runningText   config collected from the device
 * @returns {{drift: boolean, changes: Array, missing: number, unexpected: number}}
 */
export function compare(baselineText, runningText) {
  const baseline = normalize(baselineText);
  const running = normalize(runningText);
  const entries = diffLines(baseline, running);

  // "removed" = in baseline, missing from device  => someone deleted intent
  // "added"   = on device, absent from baseline => someone changed live state
  const missing = entries.filter((e) => e.type === "removed");
  const unexpected = entries.filter((e) => e.type === "added");
  const changes = [...missing, ...unexpected];

  return {
    drift: changes.length > 0,
    changes,
    missing: missing.length,
    unexpected: unexpected.length,
  };
}

export default { diffLines, compare };