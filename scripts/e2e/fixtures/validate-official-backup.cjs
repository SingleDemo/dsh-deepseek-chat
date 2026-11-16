#!/usr/bin/env node
/**
 * Validate a ZIP against the official DeepSeek chat-history export schema.
 *
 *   node scripts/e2e/fixtures/validate-official-backup.cjs fixtures/official-backup.zip
 *
 * Purpose: prove that a ZIP we produced is something the official importer accepts, and that
 * a fixture really is shaped like an official export. Exit code 0 = accepted, 1 = rejected.
 *
 * The ZIP parser here is written from scratch on purpose (zlib for inflate, own CRC-32): it
 * must not share a bug with docs/specs/14-zip-codec.js, otherwise "our writer + our reader"
 * could agree while the official reader disagrees.
 *
 * Checks mirror `src/services/chat/history/{zipReader,schema,importArchive}.ts`:
 *   archive  first entry is manifest.json; version === 3; no ZIP64 / encryption / traversal;
 *            no unknown entries; index ids === session ids (no duplicates)
 *   session  id matches the file name; title string|null; pinned boolean; timestamps RFC 3339 Z;
 *            current_message_id exists (unless the session has no messages)
 *   messages unique ids, parent_id < id, parent exists, role alternation, root is USER,
 *            known status, known fragment types with the right field shapes
 *   images   every FINISHED image reference resolves; every image entry is referenced
 *
 * Warnings never fail the run; they flag format drift the official reader tolerates.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

/* ------------------------------------------------------------------ CRC-32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------- ZIP parser */

/** Reject names the official reader rejects, and return the normalised name. */
function checkName(name, where) {
  if (typeof name !== 'string' || name === '') {
    fail(where + ': empty entry name');
    return name;
  }
  if (name.includes('\\')) fail(where + ': backslash in name');
  if (name.includes('\0')) fail(where + ': NUL in name');
  if (/^[A-Za-z]:/.test(name)) fail(where + ': absolute drive path');
  if (name.startsWith('/')) fail(where + ': absolute path');
  const body = name.endsWith('/') ? name.slice(0, -1) : name;
  for (const part of body.split('/')) {
    if (!part || part === '.' || part === '..') fail(where + ': empty or dot segment');
  }
  return name;
}

/**
 * Parse an archive into entries, in physical order, verifying CRC and sizes.
 * @param {Buffer} buffer
 * @returns {Array<{name: string, bytes: Buffer, method: number, descriptor: boolean, dosDate: number}>}
 */
function parseZip(buffer) {
  if (buffer.length < 22) throw new Error('file is too small to be a ZIP archive');
  let eocd = -1;
  for (let end = buffer.length - 22; end >= Math.max(0, buffer.length - 22 - 0xffff); end -= 1) {
    if (buffer.readUInt32LE(end) !== 0x06054b50) continue;
    if (end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) continue;
    eocd = end;
    break;
  }
  if (eocd < 0) throw new Error('end of central directory not found');
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) {
    fail('archive is split across disks');
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    fail('archive uses ZIP64 fields (official export never does)');
  }
  if (offset + size !== eocd) fail('central directory does not end where the EOCD starts');

  const entries = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const base = offset + cursor;
    if (base + 46 > buffer.length) throw new Error('central directory overruns the file');
    if (buffer.readUInt32LE(base) !== 0x02014b50) throw new Error('bad central directory signature');
    const flags = buffer.readUInt16LE(base + 8);
    const method = buffer.readUInt16LE(base + 10);
    const crc = buffer.readUInt32LE(base + 16);
    const compressedSize = buffer.readUInt32LE(base + 20);
    const realSize = buffer.readUInt32LE(base + 24);
    const nameLength = buffer.readUInt16LE(base + 28);
    const extraLength = buffer.readUInt16LE(base + 30);
    const commentLength = buffer.readUInt16LE(base + 32);
    const diskStart = buffer.readUInt16LE(base + 34);
    const externalAttributes = buffer.readUInt32LE(base + 38);
    const localOffset = buffer.readUInt32LE(base + 42);
    if (compressedSize === 0xffffffff || realSize === 0xffffffff || localOffset === 0xffffffff) {
      fail('entry uses ZIP64 fields');
    }
    if (diskStart !== 0) fail('entry is split across disks');
    if (flags & 0x0001 || flags & 0x0040) fail('entry is encrypted');
    if ((flags & ~0x080e) !== 0) fail('entry uses unsupported flags 0x' + flags.toString(16));
    if (method !== 0 && method !== 8) fail('entry uses unsupported compression method ' + method);
    if (((externalAttributes >>> 16) & 0xf000) === 0xa000) fail('entry is a symlink');
    const nameBytes = buffer.subarray(base + 46, base + 46 + nameLength);
    let name;
    try {
      name = nameBytes.toString('utf8');
    } catch (error) {
      throw new Error('entry name is not valid UTF-8');
    }
    if (!(flags & 0x0800) && nameBytes.some((byte) => byte > 0x7f)) {
      fail('non-ASCII name without the UTF-8 flag: ' + name);
    }
    name = checkName(name, 'entry');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > size) throw new Error('central directory overruns its declared size');

    // Local header.
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad local header: ' + name);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressed = buffer.readUInt32LE(localOffset + 18);
    const localSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dosDate = buffer.readUInt16LE(localOffset + 12);
    if (localFlags !== flags || localMethod !== method) throw new Error('local/central header mismatch: ' + name);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
    if (localName !== name) throw new Error('local/central name mismatch: ' + name);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('entry data overruns the file: ' + name);
    const descriptor = (flags & 0x0008) !== 0;
    if (!descriptor) {
      if (localCrc !== crc || localCompressed !== compressedSize || localSize !== realSize) {
        throw new Error('local header disagrees with the directory: ' + name);
      }
    } else if (zipDescriptor(buffer, dataEnd).crc !== crc) {
      throw new Error('data descriptor disagrees with the directory: ' + name);
    }
    let bytes;
    if (method === 0) {
      if (compressedSize !== realSize) throw new Error('stored entry has different sizes: ' + name);
      bytes = buffer.subarray(dataStart, dataEnd);
    } else {
      try {
        bytes = zlib.inflateRawSync(buffer.subarray(dataStart, dataEnd));
      } catch (error) {
        throw new Error('entry did not inflate: ' + name + ' (' + error.message + ')');
      }
    }
    if (bytes.length !== realSize) throw new Error('size mismatch for ' + name);
    if (crc32(bytes) !== crc) throw new Error('CRC mismatch for ' + name);
    entries.push({ name, bytes, method, descriptor, dosDate });
  }
  if (cursor !== size) fail('central directory size mismatch');
  return entries;
}

function zipDescriptor(buffer, dataEnd) {
  let cursor = dataEnd;
  if (buffer.readUInt32LE(cursor) === 0x08074b50) cursor += 4;
  return {
    crc: buffer.readUInt32LE(cursor),
    compressedSize: buffer.readUInt32LE(cursor + 4),
    size: buffer.readUInt32LE(cursor + 8),
  };
}

/* ------------------------------------------------------------------ schema */

const TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;
const MESSAGE_STATUSES = ['WIP', 'FINISHED', 'CONTENT_FILTER', 'FAILED', 'INCOMPLETE', 'CONTEXT_LENGTH_EXCEEDED', 'TIMEOUT'];
const SEARCH_STATUSES = ['WIP', 'FINISHED', 'FAILED'];
const TIP_STYLES = ['INFO', 'WARNING', 'CAUTION'];
const FRAGMENT_TYPES = [
  'REQUEST', 'RESPONSE', 'TEMPLATE_RESPONSE', 'THINK', 'TIP', 'CONTENT_RISK',
  'PARTIAL_FILE_READ', 'TOOL_SEARCH', 'TOOL_OPEN', 'TOOL_FIND', 'READ_LINK', 'FILE',
  'TOOL_IMAGE_SEARCH',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isBoolean = (value) => typeof value === 'boolean';
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isTime = (value) => isString(value) && TIME_RE.test(value) && Number.isFinite(Date.parse(value));
const isNullable = (check) => (value) => value === null || check(value);
const isOneOf = (values) => (value) => values.includes(value);
const isStringArray = (value) => Array.isArray(value) && value.every(isString);
const isCountArray = (value) => Array.isArray(value) && value.every(isCount);

/** Field-by-field check with a readable path, e.g. `session.messages[1].fragments[0].content`. */
function expect(where, value, check, description) {
  if (!check(value)) fail(where + ' should be ' + description + ', got ' + JSON.stringify(value));
}

function validateSearchResult(where, item) {
  if (!isObject(item)) return fail(where + ' should be an object');
  expect(where + '.url', item.url, isString, 'a string');
  expect(where + '.title', item.title, isString, 'a string');
  expect(where + '.snippet', item.snippet, isString, 'a string');
  expect(where + '.published_at', item.published_at, isNullable(isTime), 'a timestamp or null');
  expect(where + '.site_name', item.site_name, isNullable(isString), 'a string or null');
  if ('site_icon' in item) expect(where + '.site_icon', item.site_icon, isNullable(isString), 'a string or null');
}

function validateFileEntry(where, item) {
  if (!isObject(item)) return fail(where + ' should be an object');
  expect(where + '.id', item.id, isString, 'a string');
  expect(where + '.file_name', item.file_name, isString, 'a string');
  expect(where + '.file_size', item.file_size, isCount, 'a non-negative integer');
  expect(where + '.token_usage', item.token_usage, isNullable(isCount), 'an integer or null');
  expect(where + '.inserted_at', item.inserted_at, isTime, 'a timestamp');
  expect(where + '.export_path', item.export_path, isNullable(isString), 'a string or null');
  expect(where + '.is_image', item.is_image, isBoolean, 'a boolean');
  expect(where + '.width', item.width, isNullable(isCount), 'an integer or null');
  expect(where + '.height', item.height, isNullable(isCount), 'an integer or null');
}

function validateFragment(where, fragment) {
  if (!isObject(fragment)) return fail(where + ' should be an object');
  const type = fragment.type;
  if (!FRAGMENT_TYPES.includes(type)) return fail(where + '.type is unknown: ' + JSON.stringify(type));
  switch (type) {
    case 'REQUEST':
    case 'RESPONSE':
    case 'TEMPLATE_RESPONSE':
      expect(where + '.content', fragment.content, isString, 'a string');
      break;
    case 'THINK':
      expect(where + '.content', fragment.content, isString, 'a string');
      expect(where + '.elapsed_secs', fragment.elapsed_secs, isNullable(isNumber), 'a number or null');
      break;
    case 'TIP':
    case 'CONTENT_RISK':
      expect(where + '.content', fragment.content, isString, 'a string');
      expect(where + '.style', fragment.style, isOneOf(TIP_STYLES), 'INFO/WARNING/CAUTION');
      break;
    case 'PARTIAL_FILE_READ':
      expect(where + '.ratio', fragment.ratio, isNumber, 'a number');
      if (isNumber(fragment.ratio) && (fragment.ratio < 0 || fragment.ratio > 100)) {
        fail(where + '.ratio should be 0–100');
      }
      break;
    case 'TOOL_SEARCH':
      expect(where + '.queries', fragment.queries, isStringArray, 'a string array');
      if (!Array.isArray(fragment.results)) fail(where + '.results should be an array');
      else fragment.results.forEach((item, index) => validateSearchResult(where + '.results[' + index + ']', item));
      if ('status' in fragment) expect(where + '.status', fragment.status, isOneOf(SEARCH_STATUSES), 'WIP/FINISHED/FAILED');
      for (const key of ['stage_id', 'group_id']) {
        if (key in fragment) expect(where + '.' + key, fragment[key], isCount, 'a non-negative integer');
      }
      break;
    case 'TOOL_OPEN':
      expect(where + '.status', fragment.status, isOneOf(SEARCH_STATUSES), 'WIP/FINISHED/FAILED');
      expect(where + '.url', fragment.url, isNullable(isString), 'a string or null');
      expect(where + '.title', fragment.title, isNullable(isString), 'a string or null');
      for (const key of ['snippet', 'site_name']) {
        if (key in fragment) expect(where + '.' + key, fragment[key], isNullable(isString), 'a string or null');
      }
      expect(where + '.published_at', fragment.published_at, isNullable(isTime), 'a timestamp or null');
      for (const key of ['stage_id', 'group_id']) {
        if (key in fragment) expect(where + '.' + key, fragment[key], isCount, 'a non-negative integer');
      }
      break;
    case 'TOOL_FIND':
      expect(where + '.status', fragment.status, isOneOf(['WIP', 'FINISHED', 'NO_RESULT', 'FAILED']), 'WIP/FINISHED/NO_RESULT/FAILED');
      if ('pattern' in fragment) expect(where + '.pattern', fragment.pattern, isString, 'a string');
      for (const key of ['stage_id', 'group_id']) {
        if (key in fragment) expect(where + '.' + key, fragment[key], isCount, 'a non-negative integer');
      }
      break;
    case 'READ_LINK':
      if (!Array.isArray(fragment.results)) fail(where + '.results should be an array');
      else {
        fragment.results.forEach((item, index) => {
          const at = where + '.results[' + index + ']';
          if (!isObject(item)) return fail(at + ' should be an object');
          expect(at + '.signature', item.signature, isString, 'a string');
          if ('url' in item) expect(at + '.url', item.url, isString, 'a string');
          if ('title' in item) expect(at + '.title', item.title, isNullable(isString), 'a string or null');
        });
      }
      break;
    case 'FILE':
      if (!Array.isArray(fragment.files)) fail(where + '.files should be an array');
      else fragment.files.forEach((item, index) => validateFileEntry(where + '.files[' + index + ']', item));
      break;
    case 'TOOL_IMAGE_SEARCH':
      expect(where + '.status', fragment.status, isOneOf(SEARCH_STATUSES), 'WIP/FINISHED/FAILED');
      if ('image_indexes' in fragment) expect(where + '.image_indexes', fragment.image_indexes, isCountArray, 'an integer array');
      if (!Array.isArray(fragment.results)) fail(where + '.results should be an array');
      else {
        fragment.results.forEach((item, index) => {
          const at = where + '.results[' + index + ']';
          if (!isObject(item)) return fail(at + ' should be an object');
          expect(at + '.title', item.title, isString, 'a string');
          expect(at + '.source_page_url', item.source_page_url, isString, 'a string');
          expect(at + '.snippet', item.snippet, isString, 'a string');
          expect(at + '.site_name', item.site_name, isNullable(isString), 'a string or null');
          expect(at + '.published_at', item.published_at, isNullable(isTime), 'a timestamp or null');
        });
      }
      for (const key of ['stage_id', 'group_id']) {
        if (key in fragment) expect(where + '.' + key, fragment[key], isCount, 'a non-negative integer');
      }
      break;
    default:
      break;
  }
}

function validateMessageNode(where, node, byId) {
  if (!isObject(node)) return fail(where + ' should be an object');
  expect(where + '.id', node.id, isCount, 'a non-negative integer');
  expect(where + '.parent_id', node.parent_id, isNullable(isCount), 'an integer or null');
  expect(where + '.role', node.role, isOneOf(['USER', 'ASSISTANT']), 'USER/ASSISTANT');
  expect(where + '.status', node.status, isOneOf(MESSAGE_STATUSES), 'a known status');
  expect(where + '.thinking_enabled', node.thinking_enabled, isBoolean, 'a boolean');
  expect(where + '.search_enabled', node.search_enabled, isBoolean, 'a boolean');
  expect(where + '.accumulated_token_usage', node.accumulated_token_usage, isCount, 'a non-negative integer');
  expect(where + '.inserted_at', node.inserted_at, isTime, 'a timestamp');
  if (!Array.isArray(node.fragments)) return fail(where + '.fragments should be an array');
  node.fragments.forEach((fragment, index) => validateFragment(where + '.fragments[' + index + ']', fragment));

  if (node.id in byId) fail(where + ': duplicate message id ' + node.id);
  else byId[node.id] = node;
  if (node.parent_id === null) {
    if (node.role !== 'USER') fail(where + ': root message must be USER');
    return;
  }
  const parent = byId[node.parent_id];
  if (!parent) fail(where + ': parent_id ' + node.parent_id + ' is missing or larger than the id');
  else if (parent.role === node.role) fail(where + ': parent and child roles must alternate');
}

function validateSessionFile(where, session, expectedId) {
  if (!isObject(session)) return fail(where + ' should be an object');
  expect(where + '.id', session.id, isString, 'a string');
  if (session.id !== expectedId) fail(where + ': id ' + JSON.stringify(session.id) + ' != file name ' + expectedId);
  if (isString(session.id) && (/[/\\]/.test(session.id) || session.id === '.' || session.id === '..')) {
    fail(where + ': id contains a path separator');
  }
  expect(where + '.title', session.title, isNullable(isString), 'a string or null');
  if (!isBoolean(session.pinned)) fail(where + '.pinned should be a boolean');
  expect(where + '.current_message_id', session.current_message_id, isCount, 'a non-negative integer');
  expect(where + '.inserted_at', session.inserted_at, isTime, 'a timestamp');
  expect(where + '.updated_at', session.updated_at, isTime, 'a timestamp');
  if (!Array.isArray(session.messages)) return fail(where + '.messages should be an array');
  const byId = {};
  session.messages.forEach((node, index) => validateMessageNode(where + '.messages[' + index + ']', node, byId));
  if (session.messages.length > 0 && !(session.current_message_id in byId)) {
    fail(where + '.current_message_id ' + session.current_message_id + ' does not exist');
  }
  // Numbering rule enforced by the official exporter: ids are 1..n after a parent-first renumber.
  const ids = session.messages.map((node) => node.id).sort((a, b) => a - b);
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index] !== index + 1) {
      warn(where + ': message ids are not 1..n (' + ids.slice(0, 5).join(',') + '…) — official export renumbers');
      break;
    }
  }
}

function validateIndex(where, index, sessionIds) {
  if (!Array.isArray(index)) return fail(where + ' should be an array');
  const seen = new Set();
  for (let position = 0; position < index.length; position += 1) {
    const item = index[position];
    const at = where + '[' + position + ']';
    if (!isObject(item)) {
      fail(at + ' should be an object');
      continue;
    }
    expect(at + '.id', item.id, isString, 'a string');
    expect(at + '.title', item.title, isNullable(isString), 'a string or null');
    if (!isBoolean(item.pinned)) fail(at + '.pinned should be a boolean');
    expect(at + '.message_count', item.message_count, isCount, 'a non-negative integer');
    expect(at + '.inserted_at', item.inserted_at, isTime, 'a timestamp');
    expect(at + '.updated_at', item.updated_at, isTime, 'a timestamp');
    if (isString(item.id)) {
      if (seen.has(item.id)) fail(at + ': duplicate id in index');
      seen.add(item.id);
      if (!sessionIds.has(item.id)) fail(at + ': index lists a session with no JSON entry');
    }
  }
  for (const id of sessionIds) {
    if (!seen.has(id)) fail('session ' + id + ' is missing from the index');
  }
}

/* -------------------------------------------------------------------- main */

function resolveInput(argument) {
  const candidates = [
    path.resolve(process.cwd(), argument),
    path.resolve(__dirname, argument),
    path.resolve(__dirname, 'fixtures', argument),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function main() {
  const argument = process.argv[2] || 'fixtures/official-backup.zip';
  const file = resolveInput(argument);
  if (!file) {
    console.error('FAIL  cannot find ' + argument);
    process.exit(1);
  }
  const buffer = fs.readFileSync(file);
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    console.error('FAIL  not a ZIP archive (no PK\\x03\\x04 signature)');
    process.exit(1);
  }

  let entries;
  try {
    entries = parseZip(buffer);
  } catch (error) {
    console.error('FAIL  ' + error.message);
    process.exit(1);
  }
  if (entries.length === 0) {
    console.error('FAIL  archive has no entries');
    process.exit(1);
  }

  // Archive-level rules, in the official importer's order.
  const first = entries[0];
  if (first.name !== 'manifest.json') fail('first entry must be manifest.json, got ' + first.name);
  if (first.name === 'manifest.json') {
    let manifest;
    try {
      manifest = JSON.parse(first.bytes.toString('utf8'));
    } catch (error) {
      fail('manifest.json is not valid JSON');
    }
    if (!isObject(manifest)) fail('manifest.json should be an object');
    else if (!('export_format_version' in manifest)) fail('manifest.json is missing export_format_version');
    else if (manifest.export_format_version === 3) {
      /* good */
    } else if (typeof manifest.export_format_version === 'number' && manifest.export_format_version > 3) {
      fail('export_format_version is newer than 3');
    } else {
      fail('export_format_version must be 3');
    }
  }
  // Timestamp drift is tolerated by the official reader, but our exporter promises 1980-01-01.
  for (const entry of entries) {
    if (entry.method !== 0) warn(entry.name + ' is DEFLATE; the official exporter uses STORE');
    if (entry.descriptor) warn(entry.name + ' uses a data descriptor');
    if (entry.dosDate !== 0x0021) warn(entry.name + ' timestamp is not 1980-01-01');
  }

  const sessionIds = new Set();
  const sessions = new Map();
  let index = null;
  const images = new Map();
  for (const entry of entries) {
    if (entry.name === 'manifest.json' || entry.name === 'chat_session_index.json') {
      if (entry.name === 'chat_session_index.json') {
        if (index !== null) fail('chat_session_index.json appears twice');
        try {
          index = JSON.parse(entry.bytes.toString('utf8'));
        } catch (error) {
          fail('chat_session_index.json is not valid JSON');
        }
      }
      continue;
    }
    const sessionMatch = /^chat_sessions\/([^/]+)\.json$/.exec(entry.name);
    if (sessionMatch) {
      const id = sessionMatch[1];
      if (sessionIds.has(id)) fail('session ' + id + ' appears twice');
      sessionIds.add(id);
      let payload;
      try {
        payload = JSON.parse(entry.bytes.toString('utf8'));
      } catch (error) {
        fail(entry.name + ' is not valid JSON');
        continue;
      }
      sessions.set(id, payload);
      validateSessionFile(entry.name, payload, id);
      continue;
    }
    if (/^chat_sessions\/[^/]+_files\//.test(entry.name)) {
      images.set(entry.name, entry);
      continue;
    }
    fail('unknown entry: ' + entry.name);
  }
  if (index === null) fail('chat_session_index.json is missing');
  else validateIndex('chat_session_index.json', index, sessionIds);

  // Every referenced image must exist, and every image must be referenced by a FILE fragment.
  const referenced = new Set();
  for (const [id, session] of sessions) {
    if (!isObject(session) || !Array.isArray(session.messages)) continue;
    for (const message of session.messages) {
      if (!isObject(message) || !Array.isArray(message.fragments)) continue;
      for (const fragment of message.fragments) {
        if (!isObject(fragment) || fragment.type !== 'FILE' || !Array.isArray(fragment.files)) continue;
        for (const fileEntry of fragment.files) {
          if (!isObject(fileEntry) || typeof fileEntry.export_path !== 'string') continue;
          referenced.add(fileEntry.export_path);
          if (!fileEntry.export_path.startsWith('chat_sessions/' + id + '_files/')) {
            fail('FILE export_path is outside its session directory: ' + fileEntry.export_path);
          }
          const image = images.get(fileEntry.export_path);
          if (!image) {
            warn('FILE references a missing image entry: ' + fileEntry.export_path);
          } else if (isCount(fileEntry.file_size) && fileEntry.file_size !== image.bytes.length) {
            warn('FILE file_size ' + fileEntry.file_size + ' != image entry size ' + image.bytes.length);
          }
        }
      }
    }
  }
  for (const name of images.keys()) {
    if (!referenced.has(name)) warn('image entry is not referenced by any FILE fragment: ' + name);
  }

  for (const message of warnings) console.log('WARN  ' + message);
  if (errors.length > 0) {
    for (const message of errors) console.log('FAIL  ' + message);
    console.log('\nFAILED  ' + errors.length + ' error(s) in ' + path.relative(process.cwd(), file));
    process.exit(1);
  }
  let messages = 0;
  let fragments = 0;
  for (const session of sessions.values()) {
    if (!isObject(session) || !Array.isArray(session.messages)) continue;
    messages += session.messages.length;
    for (const message of session.messages) {
      if (isObject(message) && Array.isArray(message.fragments)) fragments += message.fragments.length;
    }
  }
  console.log(
    'OK  ' + path.relative(process.cwd(), file)
    + ' · zip entries=' + entries.length
    + ' · sessions=' + sessions.size
    + ' · messages=' + messages
    + ' · fragments=' + fragments
    + ' · images=' + images.size,
  );
  process.exit(0);
}

main();
