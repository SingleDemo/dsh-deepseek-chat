/**
 * Official-archive ZIP codec — self-contained, zero-dependency, browser-ready.
 *
 * Paste this whole file inside the `window.__ModuleLoader__.load({ factory(require) { ... } })`
 * body of `client.js`; it declares only functions and a few `const`s, touches no DOM and no
 * module scope, so it can sit next to the other helpers (put it in the utils section).
 * Public names (`zipWrite`, `zipWriteBytes`, `zipRead`, `crc32`, `zipSelfTest`, `ZipError`)
 * do not collide with anything in client.js today.
 *
 * WHY THIS EXISTS
 *   The DeepSeek chat-history export is a ZIP whose entries are STORE (uncompressed) and
 *   whose timestamp is fixed at 1980-01-01. We must (a) write byte-compatible archives the
 *   official importer accepts and (b) read archives produced by the official exporter, which
 *   may also use DEFLATE and ZIP data descriptors. `zipRead` therefore accepts STORE,
 *   DEFLATE and data descriptors; `zipWrite` always emits the conservative STORE form.
 *
 * API
 *   zipWrite(entries)        -> Blob             (application/zip, ready to download)
 *   zipWriteBytes(entries)   -> Uint8Array       (same archive as raw bytes)
 *   zipRead(arrayBuffer)     -> Promise<Array<{ name, bytes, method, size, crc }>>
 *   zipSelfTest()            -> Promise<{ ok: true, entries: number, deflate: boolean }>
 *   crc32(uint8Array)        -> number           (unsigned 32-bit)
 *   ZipError                 -> Error subclass; `error.code` is one of ZIP_CODES
 *
 *   entries: Array<{ name: string, bytes: Uint8Array }>
 *
 * GUARANTEES (writer)
 *   - Entries are written in the given order, STORE only, real CRC-32 in both headers.
 *   - DOS timestamp fixed to 1980-01-01 00:00:00 (date 0x0021, time 0x0000), so two runs of
 *     the same input produce byte-identical archives.
 *   - UTF-8 names always carry flag 0x0800; names are normalised to NFC.
 *   - No data descriptor, no extra fields, no archive comment, no ZIP64, no directory entry.
 *   - Repeated or unsafe names throw instead of producing an ambiguous archive.
 *
 * GUARANTEES (reader)
 *   - Finds the EOCD by scanning the tail backwards; rejects multi-disk archives.
 *   - Supports method 0 (store) and 8 (deflate), plus flag bit 3 (data descriptor).
 *   - Verifies declared size and CRC-32 after decompression; verifies local and central
 *     headers agree; rejects duplicate names, symlink attributes, and disk-split entries.
 *   - Rejects path traversal: backslashes, absolute paths, drive letters, NUL, "." / "..".
 *   - Directory entries (trailing "/") are validated and then skipped.
 *
 * ZIP_CODES (stable strings, map them to UI copy)
 *   ZIP_INVALID               malformed structure            -> 文件内容不完整，无法导入
 *   ZIP_UNSUPPORTED_ZIP64     ZIP64 sentinel found           -> 文件内容不完整，无法导入
 *   ZIP_UNSUPPORTED_ENCRYPTED encrypted entry                -> 文件内容不完整，无法导入
 *   ZIP_UNSUPPORTED_METHOD    method other than store/deflate-> 文件内容不完整，无法导入
 *   ZIP_UNSUPPORTED_DEFLATE   DecompressionStream unavailable-> 浏览器不支持解压，请更换浏览器
 *   ZIP_PATH_TRAVERSAL        unsafe entry name              -> 文件内容不完整，无法导入
 *   ZIP_DUPLICATE_NAME        two entries share one name     -> 文件内容不完整，无法导入
 *   ZIP_CRC_MISMATCH          CRC/size disagreement          -> 文件内容不完整，无法导入
 *   ZIP_TOO_LARGE             archive needs ZIP64            -> 文件内容不完整，无法导入
 *   ZIP_BAD_INPUT             caller passed the wrong type   -> 程序错误（不要展示给用户）
 */

/* eslint-disable no-bitwise, no-unused-vars */

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_DESCRIPTOR_SIG = 0x08074b50;
/** 1980-01-01 00:00:00 as a DOS date/time pair: the official export's fixed timestamp. */
const ZIP_DOS_DATE = 0x0021;
const ZIP_DOS_TIME = 0x0000;
/** Bit 3: CRC and sizes live in a trailing data descriptor. Bit 11: the name is UTF-8. */
const ZIP_FLAG_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;
/** Flags we understand; anything else means the entry needs features we do not implement. */
const ZIP_FLAG_ALLOWED = 0x080e;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
/** Sentinel values that mean "the real value lives in a ZIP64 record". */
const ZIP64_U32 = 0xffffffff;
const ZIP64_U16 = 0xffff;

const ZIP_CODES = {
  INVALID: 'ZIP_INVALID',
  UNSUPPORTED_ZIP64: 'ZIP_UNSUPPORTED_ZIP64',
  UNSUPPORTED_ENCRYPTED: 'ZIP_UNSUPPORTED_ENCRYPTED',
  UNSUPPORTED_METHOD: 'ZIP_UNSUPPORTED_METHOD',
  UNSUPPORTED_DEFLATE: 'ZIP_UNSUPPORTED_DEFLATE',
  PATH_TRAVERSAL: 'ZIP_PATH_TRAVERSAL',
  DUPLICATE_NAME: 'ZIP_DUPLICATE_NAME',
  CRC_MISMATCH: 'ZIP_CRC_MISMATCH',
  TOO_LARGE: 'ZIP_TOO_LARGE',
  BAD_INPUT: 'ZIP_BAD_INPUT',
};

class ZipError extends Error {
  /**
   * @param {string} code - one of ZIP_CODES
   * @param {string} message - developer-facing detail; the UI shows its own copy
   */
  constructor(code, message) {
    super(message || code);
    this.name = 'ZipError';
    this.code = code;
  }
}

const zipFail = (code, message) => {
  throw new ZipError(code, message);
};

/* ------------------------------------------------------------------ CRC-32 */

let zipCrcTable = null;

/** Lazily build the standard CRC-32 (IEEE 802.3, reflected) lookup table. */
function zipCrc32Table() {
  if (zipCrcTable) return zipCrcTable;
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    table[value] = crc >>> 0;
  }
  zipCrcTable = table;
  return table;
}

/**
 * CRC-32 of a byte array (the checksum the ZIP format stores).
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit checksum
 */
function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) zipFail(ZIP_CODES.BAD_INPUT, 'crc32 expects a Uint8Array');
  const table = zipCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------- utilities */

const zipEncoder = new TextEncoder();
const zipDecoderStrict = new TextDecoder('utf-8', { fatal: true });
const zipDecoderLenient = new TextDecoder('utf-8');

const zipU32 = (view, offset) => view.getUint32(offset, true);
const zipU16 = (view, offset) => view.getUint16(offset, true);

/**
 * Validate one entry name and normalise it. The official reader rejects backslashes,
 * drive letters, NUL, and empty/"."/".." segments, so the writer must never emit them.
 * @param {string} raw
 * @param {(message: string) => never} fail
 * @returns {string} the NFC normalised name
 */
function zipCheckName(raw, fail) {
  if (typeof raw !== 'string' || raw === '') fail('entry name must be a non-empty string');
  const name = raw.normalize('NFC');
  if (name.indexOf('\\') >= 0) fail('entry name must use forward slashes: ' + name);
  if (name.indexOf('\0') >= 0) fail('entry name must not contain NUL: ' + name);
  if (/^[A-Za-z]:/.test(name)) fail('entry name must be relative: ' + name);
  if (name.charAt(0) === '/') fail('entry name must be relative: ' + name);
  const body = name.charAt(name.length - 1) === '/' ? name.slice(0, -1) : name;
  const parts = body.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..') {
      fail('entry name has an empty or dot segment: ' + name);
    }
  }
  return name;
}

/** Minimal growable byte sink, so the writer core does not depend on Blob. */
function zipSink() {
  let buffer = new Uint8Array(1024);
  let length = 0;
  const ensure = (extra) => {
    if (length + extra <= buffer.length) return;
    let size = buffer.length * 2;
    while (size < length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(buffer.subarray(0, length));
    buffer = next;
  };
  return {
    get length() {
      return length;
    },
    u16(value) {
      ensure(2);
      buffer[length] = value & 0xff;
      buffer[length + 1] = (value >>> 8) & 0xff;
      length += 2;
    },
    u32(value) {
      ensure(4);
      buffer[length] = value & 0xff;
      buffer[length + 1] = (value >>> 8) & 0xff;
      buffer[length + 2] = (value >>> 16) & 0xff;
      buffer[length + 3] = (value >>> 24) & 0xff;
      length += 4;
    },
    bytes(value) {
      ensure(value.length);
      buffer.set(value, length);
      length += value.length;
    },
    result() {
      return buffer.slice(0, length);
    },
  };
}

/* ------------------------------------------------------------------ writer */

/**
 * Build the archive bytes: STORE, fixed DOS timestamp, no data descriptor, no ZIP64.
 * @param {Array<{name: string, bytes: Uint8Array}>} entries
 * @returns {Uint8Array}
 */
function zipWriteBytes(entries) {
  if (!Array.isArray(entries)) zipFail(ZIP_CODES.BAD_INPUT, 'zipWrite expects an array of entries');
  if (entries.length >= ZIP64_U16) zipFail(ZIP_CODES.TOO_LARGE, 'archive needs ZIP64: too many entries');
  const prepared = [];
  const seen = new Set();
  let total = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] || {};
    const name = zipCheckName(entry.name, (message) => zipFail(ZIP_CODES.PATH_TRAVERSAL, message));
    if (seen.has(name)) zipFail(ZIP_CODES.DUPLICATE_NAME, 'duplicate entry name: ' + name);
    seen.add(name);
    let bytes = entry.bytes;
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array)) zipFail(ZIP_CODES.BAD_INPUT, 'entry bytes must be a Uint8Array: ' + name);
    if (bytes.length >= ZIP64_U32) zipFail(ZIP_CODES.TOO_LARGE, 'entry needs ZIP64: ' + name);
    const nameBytes = zipEncoder.encode(name);
    if (nameBytes.length > 0xffff) zipFail(ZIP_CODES.TOO_LARGE, 'entry name too long: ' + name);
    total += 30 + nameBytes.length + bytes.length + 46 + nameBytes.length + 22;
    if (total >= ZIP64_U32) zipFail(ZIP_CODES.TOO_LARGE, 'archive needs ZIP64: size overflow');
    prepared.push({ nameBytes, bytes, crc: crc32(bytes), offset: 0 });
  }

  const sink = zipSink();
  for (let i = 0; i < prepared.length; i += 1) {
    const item = prepared[i];
    item.offset = sink.length;
    sink.u32(ZIP_LOCAL_SIG);
    sink.u16(20);              // version needed to extract: 2.0
    sink.u16(ZIP_FLAG_UTF8);   // no data descriptor; name is UTF-8
    sink.u16(ZIP_METHOD_STORE);
    sink.u16(ZIP_DOS_TIME);
    sink.u16(ZIP_DOS_DATE);
    sink.u32(item.crc);
    sink.u32(item.bytes.length); // compressed size == stored size
    sink.u32(item.bytes.length);
    sink.u16(item.nameBytes.length);
    sink.u16(0);               // no extra field
    sink.bytes(item.nameBytes);
    sink.bytes(item.bytes);
  }
  const centralOffset = sink.length;
  for (let i = 0; i < prepared.length; i += 1) {
    const item = prepared[i];
    sink.u32(ZIP_CENTRAL_SIG);
    sink.u16(20);              // version made by: 2.0, DOS/FAT
    sink.u16(20);              // version needed
    sink.u16(ZIP_FLAG_UTF8);
    sink.u16(ZIP_METHOD_STORE);
    sink.u16(ZIP_DOS_TIME);
    sink.u16(ZIP_DOS_DATE);
    sink.u32(item.crc);
    sink.u32(item.bytes.length);
    sink.u32(item.bytes.length);
    sink.u16(item.nameBytes.length);
    sink.u16(0);               // extra length
    sink.u16(0);               // comment length
    sink.u16(0);               // disk number start
    sink.u16(0);               // internal attributes
    sink.u32(0);               // external attributes
    sink.u32(item.offset);
    sink.bytes(item.nameBytes);
  }
  const centralSize = sink.length - centralOffset;
  sink.u32(ZIP_EOCD_SIG);
  sink.u16(0);                 // this disk
  sink.u16(0);                 // disk with the central directory
  sink.u16(prepared.length);
  sink.u16(prepared.length);
  sink.u32(centralSize);
  sink.u32(centralOffset);
  sink.u16(0);                 // no archive comment
  return sink.result();
}

/**
 * Build the archive as a Blob (what `URL.createObjectURL` / `<a download>` want).
 * @param {Array<{name: string, bytes: Uint8Array}>} entries
 * @returns {Blob}
 */
function zipWrite(entries) {
  return new Blob([zipWriteBytes(entries)], { type: 'application/zip' });
}

/* ------------------------------------------------------------------ reader */

/**
 * Inflate one raw-deflate range with the platform DecompressionStream.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function zipInflateRaw(bytes) {
  const StreamClass = typeof DecompressionStream !== 'undefined' ? DecompressionStream : undefined;
  if (typeof StreamClass !== 'function') {
    zipFail(ZIP_CODES.UNSUPPORTED_DEFLATE, 'this environment cannot decompress deflate entries');
  }
  let response;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new StreamClass('deflate-raw'));
    response = new Response(stream);
  } catch (error) {
    zipFail(ZIP_CODES.UNSUPPORTED_DEFLATE, 'DecompressionStream("deflate-raw") is unavailable');
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    zipFail(ZIP_CODES.INVALID, 'deflate entry did not decompress: ' + (error && error.message));
    return new Uint8Array(0);
  }
}

/** Locate the End Of Central Directory by scanning the tail backwards. */
function zipFindEocd(view) {
  const length = view.byteLength;
  if (length < 22) zipFail(ZIP_CODES.INVALID, 'file is too small to be a ZIP archive');
  const earliest = Math.max(0, length - 22 - 0xffff);
  for (let end = length - 22; end >= earliest; end -= 1) {
    if (zipU32(view, end) !== ZIP_EOCD_SIG) continue;
    if (end + 22 + zipU16(view, end + 20) !== length) continue;
    if (zipU16(view, end + 4) !== 0 || zipU16(view, end + 6) !== 0) {
      zipFail(ZIP_CODES.INVALID, 'multi-disk archives are not supported');
    }
    const count = zipU16(view, end + 10);
    const size = zipU32(view, end + 12);
    const offset = zipU32(view, end + 16);
    if (count === ZIP64_U16 || size === ZIP64_U32 || offset === ZIP64_U32) {
      zipFail(ZIP_CODES.UNSUPPORTED_ZIP64, 'archive uses ZIP64 fields');
    }
    if (offset + size !== end) {
      zipFail(ZIP_CODES.INVALID, 'central directory does not end where the EOCD starts');
    }
    return { count, size, offset, end };
  }
  zipFail(ZIP_CODES.INVALID, 'end of central directory record not found');
  return { count: 0, size: 0, offset: 0, end: 0 };
}

/** Parse the central directory into entry descriptors, ordered by physical offset. */
function zipReadCentral(view, eocd) {
  let cursor = 0;
  const entries = [];
  for (let index = 0; index < eocd.count; index += 1) {
    const base = eocd.offset + cursor;
    if (cursor + 46 > eocd.size) zipFail(ZIP_CODES.INVALID, 'central directory entry overruns');
    if (zipU32(view, base) !== ZIP_CENTRAL_SIG) zipFail(ZIP_CODES.INVALID, 'bad central header signature');
    const flags = zipU16(view, base + 8);
    const method = zipU16(view, base + 10);
    const crc = zipU32(view, base + 16);
    const compressedSize = zipU32(view, base + 20);
    const size = zipU32(view, base + 24);
    const nameLength = zipU16(view, base + 28);
    const extraLength = zipU16(view, base + 30);
    const commentLength = zipU16(view, base + 32);
    const diskStart = zipU16(view, base + 34);
    const externalAttributes = zipU32(view, base + 38);
    const localOffset = zipU32(view, base + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd.size) zipFail(ZIP_CODES.INVALID, 'central directory entry overruns');
    if (compressedSize === ZIP64_U32 || size === ZIP64_U32 || localOffset === ZIP64_U32) {
      zipFail(ZIP_CODES.UNSUPPORTED_ZIP64, 'entry uses ZIP64 fields');
    }
    if (diskStart !== 0) zipFail(ZIP_CODES.INVALID, 'entry is split across disks');
    if (localOffset >= eocd.offset) zipFail(ZIP_CODES.INVALID, 'local header overlaps the directory');
    if ((flags & ZIP_FLAG_ALLOWED) !== flags) {
      zipFail(ZIP_CODES.UNSUPPORTED_ENCRYPTED, 'entry uses unsupported flags: ' + flags);
    }
    if (method !== ZIP_METHOD_STORE && method !== ZIP_METHOD_DEFLATE) {
      zipFail(ZIP_CODES.UNSUPPORTED_METHOD, 'unsupported compression method ' + method);
    }
    if (method === ZIP_METHOD_STORE && compressedSize !== size) {
      zipFail(ZIP_CODES.INVALID, 'stored entry declares different compressed and real sizes');
    }
    // Unix mode file type lives in the upper 16 bits: 0xA000 marks a symlink.
    if (((externalAttributes >>> 16) & 0xf000) === 0xa000) {
      zipFail(ZIP_CODES.INVALID, 'symlink entries are not supported');
    }
    const nameBytes = view.buffer.slice(
      view.byteOffset + base + 46,
      view.byteOffset + base + 46 + nameLength,
    );
    const rawName = new Uint8Array(nameBytes);
    let name;
    try {
      name = (flags & ZIP_FLAG_UTF8) ? zipDecoderStrict.decode(rawName) : zipDecoderLenient.decode(rawName);
    } catch (error) {
      zipFail(ZIP_CODES.INVALID, 'entry name is not valid UTF-8');
    }
    // Directories are validated but never returned; the official reader skips them too.
    if (name.charAt(name.length - 1) === '/' && size !== 0) {
      zipFail(ZIP_CODES.INVALID, 'directory entry carries data: ' + name);
    }
    entries.push({
      name: zipCheckName(name, (message) => zipFail(ZIP_CODES.PATH_TRAVERSAL, message)),
      rawName,
      flags,
      method,
      crc,
      compressedSize,
      size,
      localOffset,
    });
    cursor = next;
  }
  if (cursor !== eocd.size) zipFail(ZIP_CODES.INVALID, 'central directory size mismatch');
  entries.sort((a, b) => a.localOffset - b.localOffset);
  const names = new Set();
  for (let i = 0; i < entries.length; i += 1) {
    if (names.has(entries[i].name)) zipFail(ZIP_CODES.DUPLICATE_NAME, 'duplicate entry name: ' + entries[i].name);
    names.add(entries[i].name);
  }
  return entries;
}

/** Verify the local header of one entry and recover its bytes, then check size and CRC. */
async function zipReadEntry(view, buffer, entry, boundary) {
  const base = entry.localOffset;
  if (base + 30 > boundary) zipFail(ZIP_CODES.INVALID, 'local header overruns: ' + entry.name);
  if (zipU32(view, base) !== ZIP_LOCAL_SIG) zipFail(ZIP_CODES.INVALID, 'bad local header signature');
  const flags = zipU16(view, base + 6);
  const method = zipU16(view, base + 8);
  const localCrc = zipU32(view, base + 14);
  const localCompressed = zipU32(view, base + 18);
  const localSize = zipU32(view, base + 22);
  const nameLength = zipU16(view, base + 26);
  const extraLength = zipU16(view, base + 28);
  if (flags !== entry.flags) zipFail(ZIP_CODES.INVALID, 'local and central flags disagree: ' + entry.name);
  if (method !== entry.method) zipFail(ZIP_CODES.INVALID, 'local and central methods disagree: ' + entry.name);
  if (nameLength !== entry.rawName.length) zipFail(ZIP_CODES.INVALID, 'local name length differs: ' + entry.name);
  for (let i = 0; i < nameLength; i += 1) {
    if (buffer[base + 30 + i] !== entry.rawName[i]) {
      zipFail(ZIP_CODES.INVALID, 'local and central names differ: ' + entry.name);
    }
  }
  const dataStart = base + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > boundary) zipFail(ZIP_CODES.INVALID, 'entry data overruns: ' + entry.name);
  const hasDescriptor = (flags & ZIP_FLAG_DESCRIPTOR) !== 0;
  if (!hasDescriptor) {
    if (localCrc !== entry.crc || localCompressed !== entry.compressedSize || localSize !== entry.size) {
      zipFail(ZIP_CODES.INVALID, 'local and central sizes disagree: ' + entry.name);
    }
  } else {
    // A streaming writer zeroes the local CRC/sizes; if present they must still agree.
    if ((localCrc !== 0 && localCrc !== entry.crc)
      || (localCompressed !== 0 && localCompressed !== entry.compressedSize)
      || (localSize !== 0 && localSize !== entry.size)) {
      zipFail(ZIP_CODES.INVALID, 'local header contradicts the data descriptor: ' + entry.name);
    }
    let cursor = dataEnd;
    if (cursor + 12 > boundary) zipFail(ZIP_CODES.INVALID, 'data descriptor overruns: ' + entry.name);
    if (zipU32(view, cursor) === ZIP_DESCRIPTOR_SIG) cursor += 4;
    if (cursor + 12 > boundary) zipFail(ZIP_CODES.INVALID, 'data descriptor overruns: ' + entry.name);
    if (zipU32(view, cursor) !== entry.crc
      || zipU32(view, cursor + 4) !== entry.compressedSize
      || zipU32(view, cursor + 8) !== entry.size) {
      zipFail(ZIP_CODES.INVALID, 'data descriptor disagrees with the directory: ' + entry.name);
    }
  }
  const raw = buffer.subarray(dataStart, dataEnd);
  const bytes = entry.method === ZIP_METHOD_STORE ? raw.slice() : await zipInflateRaw(raw);
  if (bytes.length !== entry.size) {
    zipFail(ZIP_CODES.CRC_MISMATCH, 'size mismatch for ' + entry.name + ': ' + bytes.length + ' != ' + entry.size);
  }
  if (crc32(bytes) !== entry.crc) zipFail(ZIP_CODES.CRC_MISMATCH, 'CRC mismatch for ' + entry.name);
  return bytes;
}

/**
 * Parse an archive into plain entries, in the order they appear in the file.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Promise<Array<{name: string, bytes: Uint8Array, method: number, size: number, crc: number}>>}
 */
async function zipRead(input) {
  const buffer = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : (input instanceof Uint8Array ? input : null);
  if (!buffer) zipFail(ZIP_CODES.BAD_INPUT, 'zipRead expects an ArrayBuffer or Uint8Array');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = zipFindEocd(view);
  const central = zipReadCentral(view, eocd);
  const entries = [];
  for (let index = 0; index < central.length; index += 1) {
    const entry = central[index];
    const boundary = index + 1 < central.length ? central[index + 1].localOffset : eocd.offset;
    const bytes = await zipReadEntry(view, buffer, entry, boundary);
    if (entry.name.charAt(entry.name.length - 1) === '/') continue;
    entries.push({ name: entry.name, bytes, method: entry.method, size: entry.size, crc: entry.crc });
  }
  return entries;
}

/* --------------------------------------------------------------- self test */

/**
 * Round-trip a small archive through this codec. After pasting the file, run
 * `zipSelfTest().then(console.log)` once in the console and expect `{ ok: true, ... }`.
 * It covers: UTF-8 names, an empty entry, binary bytes, entry order, and CRC verification.
 * @returns {Promise<{ok: true, entries: number, deflate: boolean}>}
 */
async function zipSelfTest() {
  const encoder = new TextEncoder();
  const source = [
    { name: 'manifest.json', bytes: encoder.encode('{"export_format_version":3}') },
    { name: 'chat_sessions/测试 会话.json', bytes: encoder.encode('{"id":"测试 会话","messages":[]}') },
    { name: 'chat_sessions/测试 会话_files/f1_pic.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254]) },
    { name: 'empty.json', bytes: new Uint8Array(0) },
  ];
  const archive = zipWriteBytes(source);
  const read = await zipRead(archive);
  if (read.length !== source.length) zipFail(ZIP_CODES.INVALID, 'self test: entry count mismatch');
  for (let i = 0; i < source.length; i += 1) {
    if (read[i].name !== source[i].name) zipFail(ZIP_CODES.INVALID, 'self test: name/order mismatch');
    if (read[i].size !== source[i].bytes.length) zipFail(ZIP_CODES.INVALID, 'self test: size mismatch');
    for (let j = 0; j < source[i].bytes.length; j += 1) {
      if (read[i].bytes[j] !== source[i].bytes[j]) zipFail(ZIP_CODES.INVALID, 'self test: byte mismatch');
    }
  }
  return { ok: true, entries: read.length, deflate: typeof DecompressionStream === 'function' };
}
