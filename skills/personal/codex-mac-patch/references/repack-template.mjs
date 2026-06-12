// Template-based asar rewriter for Codex Desktop Mac patch.
// Preserves header structure, unpacked split, and per-file integrity exactly.
//
// Usage: node repack.mjs <input-asar> <output-asar>
//
// Fill the PATCHES array below from discovery script output.
// Each patch: { matchEnds: '<filename>', edits: [{ name, find, replace }] }
//   matchEnds — filename suffix to match (basename from discovery)
//   find      — exact string that must appear exactly once in the file
//   replace   — replacement string

import fs from 'node:fs';
import crypto from 'node:crypto';
import { readArchiveHeaderSync } from './node_modules/@electron/asar/lib/disk.js';
import { Pickle } from './node_modules/@electron/asar/lib/pickle.js';
import { getFileIntegrityFromBuffer } from './node_modules/@electron/asar/lib/integrity.js';

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('Usage: node repack.mjs <input-asar> <output-asar>');
  process.exit(1);
}

// ---- PATCH DEFINITIONS (fill from discover.mjs output) ----
const PATCHES = [
  // Example:
  // { matchEnds: 'read-service-tier-for-request-eQvQk10Q.js', edits: [
  //   { name: 'fastmode-request',
  //     find: 'n===`chatgpt`?...',
  //     replace: '...' },
  // ]},
];

const orig = fs.readFileSync(SRC);
const { header, headerSize } = readArchiveHeaderSync(SRC);
const dataStart = 8 + headerSize;

// Collect all packed leaf nodes
const packed = [];
(function walk(node, p) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    const path = p + '/' + k;
    if (v.files) walk(v.files, path);
    else if (v.offset !== undefined && !v.unpacked) packed.push({ path: path.slice(1), node: v });
  }
})(header.files, '');

packed.sort((a, b) => parseInt(a.node.offset) - parseInt(b.node.offset));

// Apply patches, rebuild body
const applied = {};
let cursor = 0;
const chunks = [];
for (const item of packed) {
  const { path, node } = item;
  const off = parseInt(node.offset);
  let buf = orig.subarray(dataStart + off, dataStart + off + node.size);
  const pdef = PATCHES.find(p => path.endsWith(p.matchEnds));
  if (pdef) {
    let s = buf.toString('utf8');
    for (const e of pdef.edits) {
      const n = s.split(e.find).length - 1;
      if (n !== 1) { applied[e.name] = `FAIL(matches=${n})`; continue; }
      s = s.replace(e.find, e.replace);
      applied[e.name] = 'OK';
    }
    buf = Buffer.from(s, 'utf8');
  }
  node.offset = String(cursor);
  node.size = buf.length;
  node.integrity = getFileIntegrityFromBuffer(buf);
  cursor += buf.length;
  chunks.push(buf);
}

// Abort if any patch failed
const fails = Object.entries(applied).filter(([, v]) => v !== 'OK');
if (fails.length) {
  console.error('PATCH FAILURES:', JSON.stringify(applied, null, 2));
  process.exit(2);
}

// Write new asar
const body = Buffer.concat(chunks);
const headerStr = JSON.stringify(header);
const hp = Pickle.createEmpty(); hp.writeString(headerStr);
const headerBuf = hp.toBuffer();
const sp = Pickle.createEmpty(); sp.writeUInt32(headerBuf.length);
const sizeBuf = sp.toBuffer();
fs.writeFileSync(OUT, Buffer.concat([sizeBuf, headerBuf, body]));

// Output new header hash (needed for Info.plist update)
const newHash = crypto.createHash('sha256').update(headerStr).digest('hex');
console.log('patches:', JSON.stringify(applied));
console.log('packed files:', packed.length);
console.log('new asar bytes:', fs.statSync(OUT).size);
console.log('NEW_HEADER_SHA256=' + newHash);
