// codex-mac-patch: Gate discovery for Codex Desktop asar.
// Reads the asar, scans packed JS files for behavioral gate patterns,
// outputs a JSON report of matched files + exact find/replace strings.
// Usage: node discover.mjs <path-to-app.asar> [workdir]
//   workdir: directory containing node_modules/@electron/asar (default: dirname of asar)

import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error('Usage: node discover.mjs <path-to-app.asar> [workdir]');
  process.exit(1);
}

// Resolve @electron/asar from workdir (where npm installed it)
const workdir = path.resolve(process.argv[3] || path.dirname(SRC));
const asarDisk = await import(path.resolve(workdir, 'node_modules/@electron/asar/lib/disk.js'));
const { readArchiveHeaderSync } = asarDisk;

// ---- GATE DEFINITIONS ----
// Each gate: { name, matchSubstring (to identify the file), find, replace }
// matchSubstring: a unique string that appears in the TARGET file only.
// find/replace: the exact string transformation to bypass the gate.
// If findSubstring is set, it's used for verification; otherwise find is used.
const GATES = [
  {
    name: 'fastmode-request',
    description: 'Fast Mode request gate — removes chatgpt authMethod check',
    matchSubstring: 'featureRequirements?.fast_mode',
    // The gate: authMethod check wrapping fast_mode — we unwrap it
    findPattern: /n===`chatgpt`\?(\(await [^}]+\}\))\.requirements\?\.featureRequirements\?\.fast_mode!==!1:!1/,
    findExact: 'n===`chatgpt`?(await e.query.fetch(c,{authMethod:n,hostId:t})).requirements?.featureRequirements?.fast_mode!==!1:!1',
    replaceFn: (m) => `${m[1]}.requirements?.featureRequirements?.fast_mode!==!1`,
    replaceExact: null, // set dynamically if regex matches
  },
  {
    name: 'fastmode-ui',
    description: 'Fast Mode UI gate — removes authMethod===chatgpt from settings',
    matchSubstring: 'isServiceTierAllowed',
    findPattern: /f=a&&!u&&c!=null&&c\?\.requirements\?\.featureRequirements\?\.fast_mode!==!1/,
    findExact: 'f=a&&!u&&c!=null&&c?.requirements?.featureRequirements?.fast_mode!==!1',
    replaceExact: 'f=!u&&c?.requirements?.featureRequirements?.fast_mode!==!1',
  },
  {
    name: 'computer-use-gate',
    description: 'Computer Use / browser / plugins enabled resolver — bypasses Statsig + platform gates',
    matchSubstring: 'statsig-disabled',
    findPattern: /return e\?o===`electron`\?r\?a\?`loading`:[^`]+`[^`]+`:[^`]+`[^`]+`:[^`]+`[^`]+`:[^`]+`[^`]+`:`disabled`/,
    findExact: 'return e?o===`electron`?r?a?`loading`:i?n?`loading`:t?`available`:`config-requirement-disabled`:`unsupported-platform`:`statsig-disabled`:`window-type-disabled`:`disabled`',
    replaceExact: 'return e?o===`electron`?a?`loading`:i?`available`:`unsupported-platform`:`window-type-disabled`:`disabled`',
  },
  {
    name: 'plugins-authblocked',
    description: 'Plugins page authBlocked gate — forces fi=false',
    matchSubstring: 'fi=_e(di)',
    findExact: 'fi=_e(di)',
    replaceExact: 'fi=!1',
  },
  {
    name: 'mobile-login-loop',
    description: 'Mobile setup login redirect — disables forced login redirect',
    matchSubstring: 'codex-mobile-setup-flow',
    findExact: 'J&&f(`/login`,{replace:!0})',
    replaceExact: '!1',
  },
  {
    name: 'locale-i18n',
    description: 'i18n locale gate — forces enable_i18n to true',
    matchSubstring: 'enable_i18n',
    findExact: 's=a?.get(`enable_i18n`,!1)',
    replaceExact: 's=!0',
  },
];

const orig = fs.readFileSync(SRC);
const { header, headerSize } = readArchiveHeaderSync(SRC);
const dataStart = 8 + headerSize;

// Collect packed JS files under webview/assets
const packed = [];
(function walk(node, p) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    const path = p + '/' + k;
    if (v.files) walk(v.files, path);
    else if (v.offset !== undefined && !v.unpacked && path.includes('webview/assets/') && path.endsWith('.js')) {
      packed.push({ path: path.slice(1), node: v });
    }
  }
})(header.files, '');

const report = { appVersion: null, gates: [], warnings: [] };

// Try to get version from asar (package.json or similar)
try {
  const allFiles = [];
  (function walkAll(node, p) {
    for (const k of Object.keys(node)) {
      const v = node[k];
      const path = p + '/' + k;
      if (v.files) walkAll(v.files, path);
      else if (v.offset !== undefined && !v.unpacked && path.endsWith('package.json')) {
        allFiles.push({ path: path.slice(1), node: v });
      }
    }
  })(header.files, '');
  for (const f of allFiles) {
    if (f.path.includes('webview')) continue; // skip webview package.json
    const off = parseInt(f.node.offset);
    const buf = orig.subarray(dataStart + off, dataStart + off + Math.min(f.node.size, 500));
    try {
      const pkg = JSON.parse(buf.toString('utf8'));
      if (pkg.version && !report.appVersion) report.appVersion = pkg.version;
    } catch {}
  }
} catch {}

for (const gate of GATES) {
  // Read content for all candidates
  const candidates = packed.map(f => {
    const off = parseInt(f.node.offset);
    const buf = orig.subarray(dataStart + off, dataStart + off + f.node.size);
    return { ...f, content: buf.toString('utf8') };
  }).filter(f => f.content.includes(gate.matchSubstring));

  if (candidates.length === 0) {
    report.gates.push({ name: gate.name, status: 'NOT_FOUND', description: gate.description });
    continue;
  }

  // Pick the best candidate: prefer the file that also contains findExact
  let file;
  if (candidates.length === 1) {
    file = candidates[0];
  } else {
    const withFind = candidates.filter(c => gate.findExact && c.content.includes(gate.findExact));
    if (withFind.length === 1) {
      file = withFind[0];
    } else if (withFind.length > 1) {
      file = withFind[0];
      report.warnings.push(`Gate "${gate.name}": ${withFind.length} files contain findExact — picked ${file.path}`);
    } else {
      // No candidate contains findExact — fall back to shortest filename (usually most specific)
      candidates.sort((a, b) => a.path.length - b.path.length);
      file = candidates[0];
      report.warnings.push(`Gate "${gate.name}": ${candidates.length} files match substring, none contain findExact — picked shortest-name ${file.path}`);
    }
  }

  const content = file.content;

  // Verify findExact exists in content
  const findCount = content.split(gate.findExact).length - 1;
  if (findCount === 0) {
    report.gates.push({
      name: gate.name, status: 'PATTERN_MISMATCH', description: gate.description,
      file: file.path, matchSubstring: gate.matchSubstring,
      hint: 'findExact not found — minified shape may have changed. Re-investigate manually.',
    });
    continue;
  }
  if (findCount > 1) {
    report.gates.push({
      name: gate.name, status: 'MULTIPLE_MATCHES', description: gate.description,
      file: file.path, matchCount: findCount,
    });
    continue;
  }

  // Extra validation
  if (gate.requireAlso && !content.includes(gate.requireAlso)) {
    report.gates.push({
      name: gate.name, status: 'VALIDATION_FAILED', description: gate.description,
      file: file.path,
    });
    continue;
  }

  report.gates.push({
    name: gate.name, status: 'OK', description: gate.description,
    file: file.path,
    find: gate.findExact,
    replace: gate.replaceExact,
    matchCount: findCount,
  });
}

console.log(JSON.stringify(report, null, 2));
