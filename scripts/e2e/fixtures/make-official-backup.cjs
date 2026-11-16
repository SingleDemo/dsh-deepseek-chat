#!/usr/bin/env node
/**
 * Build official-format DeepSeek chat-history ZIP fixtures.
 *
 *   node scripts/e2e/fixtures/make-official-backup.cjs
 *
 * Writes (under scripts/e2e/fixtures/fixtures/):
 *   official-backup.zip           STORE entries, mtime 1980-01-01, produced by the shared
 *                                 codec in docs/specs/14-zip-codec.js — this is what our
 *                                 export must look like and what our import must accept.
 *   official-backup-deflate.zip   Same payload compressed with raw DEFLATE and written with a
 *                                 data descriptor (flag bit 3), the shape a streaming writer
 *                                 such as fflate (used by the real exporter) produces. Used to
 *                                 exercise `zipRead`'s deflate + descriptor path.
 *   official-backup-fragments.zip  Every one of the 13 fragment types across two sessions,
 *                                 with a real branch (one USER message with two ASSISTANT
 *                                 siblings), for mapping tests.
 *
 * Layout of official-backup.zip (order matters):
 *   manifest.json
 *   chat_sessions/<session-id>.json
 *   chat_session_index.json
 *   chat_sessions/<session-id>_files/<file-id>_pic.png
 *
 * Fidelity notes:
 *   - The FILE fragment sits on the USER message. The official importer only reads FILE
 *     fragments from user messages (`toLocal.ts` → `toUser`); a FILE fragment on an
 *     ASSISTANT message is silently dropped by both the official importer and ours.
 *   - Timestamps are RFC 3339 UTC with milliseconds, exactly what the schema accepts.
 *   - Message ids are parent-first: parent_id < id, root is USER, roles alternate.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CODEC_PATH = path.join(REPO_ROOT, 'docs', 'specs', '14-zip-codec.js');
const OUT_DIR = path.join(__dirname, 'fixtures');

/* ------------------------------------------------------------ codec loader */

/**
 * Load docs/specs/14-zip-codec.js. The file is meant to be pasted into client.js, so it has
 * no module exports; wrap it and hand back the public API instead of duplicating the bytes.
 */
function loadCodec() {
  const source = fs.readFileSync(CODEC_PATH, 'utf8');
  const factory = new Function(
    source
    + '\nreturn { zipWriteBytes: zipWriteBytes, zipRead: zipRead, crc32: crc32, zipSelfTest: zipSelfTest, ZipError: ZipError };',
  );
  return factory();
}

/* -------------------------------------------------------------- fixture data */

const SESSION_ID = '9f2c1a4e-6b8d-4f3a-9c21-7d5e0a1b2c3d';
const FRAGMENTS_SESSION_ID = 'b7c1d2e3-4f50-4617-8899-aabbccddeeff';
const FILE_ID = '3d9b8a7c-1e2f-4a5b-8c6d-0e1f2a3b4c5d';
const IMAGE_NAME = FILE_ID + '_pic.png';
/** Image entries live inside their own session directory; the official importer enforces that. */
const imagePathFor = (sessionId) => 'chat_sessions/' + sessionId + '_files/' + IMAGE_NAME;
const IMAGE_PATH = imagePathFor(SESSION_ID);

/** 1x1 transparent PNG (67 bytes) — small enough to inline, valid enough to sniff. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SESSION_CREATED = '2026-11-16T02:30:00.000Z';
const SESSION_UPDATED = '2026-11-16T02:33:23.270Z';

/** The four fragment types the task asks for, in the order a real turn emits them. */
function basicSession(title) {
  return {
    id: SESSION_ID,
    title,
    pinned: false,
    current_message_id: 2,
    inserted_at: SESSION_CREATED,
    updated_at: SESSION_UPDATED,
    messages: [
      {
        id: 1,
        parent_id: null,
        role: 'USER',
        status: 'FINISHED',
        thinking_enabled: true,
        search_enabled: true,
        accumulated_token_usage: 0,
        inserted_at: '2026-11-16T02:30:01.000Z',
        fragments: [
          { type: 'REQUEST', content: '帮我看下 SSE 是怎么把 token 推过来的，顺便找一张图' },
          {
            type: 'FILE',
            files: [
              {
                id: FILE_ID,
                file_name: 'pic.png',
                file_size: PNG_BYTES.length,
                token_usage: null,
                inserted_at: '2026-11-16T02:30:01.000Z',
                export_path: IMAGE_PATH,
                is_image: true,
                width: null,
                height: null,
              },
            ],
          },
        ],
      },
      {
        id: 2,
        parent_id: 1,
        role: 'ASSISTANT',
        status: 'FINISHED',
        thinking_enabled: true,
        search_enabled: true,
        accumulated_token_usage: 128,
        inserted_at: '2026-11-16T02:30:02.000Z',
        fragments: [
          { type: 'THINK', content: '先解释 SSE 的基本机制，再给一条参考链接。', elapsed_secs: 1.5 },
          {
            type: 'TOOL_SEARCH',
            queries: ['server sent events token streaming'],
            status: 'FINISHED',
            results: [
              {
                url: 'https://example.com/sse',
                title: 'Server-sent events explained',
                snippet: 'SSE keeps one HTTP response open and pushes text frames.',
                published_at: '2026-05-01T00:00:00.000Z',
                site_name: 'example.com',
                site_icon: null,
              },
            ],
          },
          {
            type: 'RESPONSE',
            content: 'SSE 用一个长期保持的 HTTP 响应，把 text/event-stream 帧按行推给浏览器；每个 data: 行就是一个 token 增量。',
          },
        ],
      },
    ],
  };
}

/** Every fragment type, plus one real branch: two ASSISTANT siblings under one USER message. */
function fragmentsSessions(imagePath) {
  const user2 = {
    id: 1,
    parent_id: null,
    role: 'USER',
    status: 'FINISHED',
    thinking_enabled: false,
    search_enabled: true,
    accumulated_token_usage: 0,
    inserted_at: '2026-11-16T03:00:00.000Z',
    fragments: [
      {
        type: 'TIP',
        content: '该回答由深度思考模型生成。',
        style: 'INFO',
      },
      { type: 'REQUEST', content: '把 13 种片段都覆盖一遍' },
      {
        type: 'FILE',
        files: [
          {
            id: FILE_ID,
            file_name: 'pic.png',
            file_size: PNG_BYTES.length,
            token_usage: null,
            inserted_at: '2026-11-16T03:00:00.000Z',
            export_path: imagePath,
            is_image: true,
            width: null,
            height: null,
          },
        ],
      },
    ],
  };
  const assistantA = {
    id: 2,
    parent_id: 1,
    role: 'ASSISTANT',
    status: 'INCOMPLETE',
    thinking_enabled: false,
    search_enabled: true,
    accumulated_token_usage: 512,
    inserted_at: '2026-11-16T03:00:01.000Z',
    fragments: [
      {
        type: 'CONTENT_RISK',
        content: '部分内容可能涉及敏感话题。',
        style: 'CAUTION',
      },
      {
        type: 'TOOL_IMAGE_SEARCH',
        status: 'FINISHED',
        image_indexes: [0],
        results: [
          {
            title: '示例图',
            source_page_url: 'https://example.com/image-page',
            snippet: '一张示意图',
            site_name: 'example.com',
            published_at: null,
          },
        ],
      },
      {
        type: 'TOOL_OPEN',
        status: 'FINISHED',
        url: 'https://example.com/sse',
        title: 'Server-sent events explained',
        snippet: 'SSE keeps one HTTP response open.',
        site_name: 'example.com',
        published_at: '2026-05-01T00:00:00.000Z',
      },
      {
        type: 'TOOL_FIND',
        status: 'NO_RESULT',
        pattern: 'text/event-stream',
      },
      {
        type: 'READ_LINK',
        results: [
          {
            url: 'https://example.com/sse',
            title: 'Server-sent events explained',
            signature: 'sig-example-not-a-real-signature',
          },
        ],
      },
      {
        type: 'PARTIAL_FILE_READ',
        ratio: 42,
      },
      {
        type: 'THINK',
        content: '先把工具步骤补齐，再给一段正文。',
        elapsed_secs: null,
      },
      {
        type: 'RESPONSE',
        content: '这是第一个回答版本，被停止在输出上限前。',
      },
      {
        type: 'TEMPLATE_RESPONSE',
        content: '回答已中断。',
      },
    ],
  };
  const assistantB = {
    id: 3,
    parent_id: 1,
    role: 'ASSISTANT',
    status: 'FINISHED',
    thinking_enabled: false,
    search_enabled: false,
    accumulated_token_usage: 96,
    inserted_at: '2026-11-16T03:00:09.000Z',
    fragments: [
      { type: 'RESPONSE', content: '这是第二个回答版本（同父兄弟节点）。' },
    ],
  };
  return [user2, assistantA, assistantB];
}

function fragmentsSession() {
  const id = FRAGMENTS_SESSION_ID;
  return {
    id,
    title: null,
    pinned: false,
    current_message_id: 2,
    inserted_at: '2026-11-16T03:00:00.000Z',
    updated_at: '2026-11-16T03:05:00.000Z',
    messages: fragmentsSessions(imagePathFor(id)),
  };
}

/* --------------------------------------------------------------- archives */

function manifestBytes() {
  return Buffer.from(JSON.stringify({ export_format_version: 3 }), 'utf8');
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

/**
 * The official order: manifest → sessions → index → images. Image entries are derived from
 * the FILE fragments, so a fixture can never reference an image the archive does not carry.
 */
function buildEntries(sessions) {
  const entries = [{ name: 'manifest.json', bytes: new Uint8Array(manifestBytes()) }];
  for (let i = 0; i < sessions.length; i += 1) {
    entries.push({
      name: 'chat_sessions/' + sessions[i].id + '.json',
      bytes: new Uint8Array(jsonBytes(sessions[i])),
    });
  }
  const index = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    pinned: false,
    message_count: session.messages.length,
    inserted_at: session.inserted_at,
    updated_at: session.updated_at,
  }));
  entries.push({ name: 'chat_session_index.json', bytes: new Uint8Array(jsonBytes(index)) });
  const images = new Set();
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const fragment of message.fragments) {
        if (fragment.type !== 'FILE') continue;
        for (const file of fragment.files) {
          if (typeof file.export_path === 'string') images.add(file.export_path);
        }
      }
    }
  }
  for (const name of images) {
    if (name !== imagePathFor(SESSION_ID) && name !== imagePathFor(FRAGMENTS_SESSION_ID)) {
      throw new Error('fixture references an image helper entry is not prepared for: ' + name);
    }
    entries.push({ name, bytes: new Uint8Array(PNG_BYTES) });
  }
  return entries;
}

/* ------------------------------------------------- deflate + data descriptor */

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

/**
 * Independent writer used only for the DEFLATE fixture: method 8, flag bit 3 (data
 * descriptor), local header CRC/sizes zeroed — mirroring what fflate emits when the real
 * exporter streams entries. Kept separate from the codec on purpose: it must not share a bug.
 * @param {Array<{name: string, bytes: Uint8Array}>} entries
 * @returns {Buffer}
 */
function writeDeflatedWithDescriptor(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const nameBytes = Buffer.from(encoder.encode(entry.name));
    const raw = Buffer.from(entry.bytes);
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const flags = 0x0808; // UTF-8 name + data descriptor
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);       // time
    local.writeUInt16LE(0x0021, 12);  // 1980-01-01
    local.writeUInt32LE(0, 14);       // crc: in the descriptor
    local.writeUInt32LE(0, 18);       // compressed size: in the descriptor
    local.writeUInt32LE(0, 22);       // real size: in the descriptor
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0); // optional descriptor signature
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(deflated.length, 8);
    descriptor.writeUInt32LE(raw.length, 12);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    localChunks.push(local, deflated, descriptor);
    centralChunks.push(central);
    offset += local.length + deflated.length + descriptor.length;
  }
  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralDir, eocd]);
}

/* -------------------------------------------------------------------- main */

async function main() {
  const codec = loadCodec();
  const selfTest = await codec.zipSelfTest();
  if (!selfTest.ok) throw new Error('codec self test failed');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const basic = basicSession('SSE 是什么');
  const basicZip = Buffer.from(codec.zipWriteBytes(buildEntries([basic])));
  const basicPath = path.join(OUT_DIR, 'official-backup.zip');
  fs.writeFileSync(basicPath, basicZip);

  const fragmentsZip = Buffer.from(codec.zipWriteBytes(buildEntries([fragmentsSession()])));
  const fragmentsPath = path.join(OUT_DIR, 'official-backup-fragments.zip');
  fs.writeFileSync(fragmentsPath, fragmentsZip);

  const deflatedPath = path.join(OUT_DIR, 'official-backup-deflate.zip');
  fs.writeFileSync(deflatedPath, writeDeflatedWithDescriptor(buildEntries([basic])));

  // Prove the codec can read both archives back before telling the caller we are done.
  const readBack = await codec.zipRead(new Uint8Array(basicZip));
  if (readBack.length !== 4 || readBack[0].name !== 'manifest.json') {
    throw new Error('codec could not read its own archive back');
  }
  const deflatedBack = await codec.zipRead(new Uint8Array(fs.readFileSync(deflatedPath)));
  if (deflatedBack.length !== 4) throw new Error('codec could not read the deflate archive');

  const lines = [
    'codec self test: ok (' + selfTest.entries + ' entries, deflate=' + selfTest.deflate + ')',
    basicPath + '  ' + basicZip.length + ' bytes  (store, mtime 1980-01-01)',
    '  manifest.json',
    '  chat_sessions/' + SESSION_ID + '.json',
    '  chat_session_index.json',
    '  ' + IMAGE_PATH + '  (' + PNG_BYTES.length + ' bytes)',
    fragmentsPath + '  ' + fragmentsZip.length + ' bytes  (all 13 fragment types, 1 branch)',
    deflatedPath + '  ' + fs.statSync(deflatedPath).size + ' bytes  (deflate + data descriptor)',
    '',
    'validate with:',
    '  node scripts/e2e/fixtures/validate-official-backup.cjs fixtures/official-backup.zip',
  ];
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('make-official-backup failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
