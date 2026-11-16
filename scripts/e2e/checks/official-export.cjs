/**
 * Check: official-export
 *
 * Exports two conversations through 设置 → 数据管理 → 下载, intercepts the download,
 * then:
 *   - asserts the official file name (deepseek_data-YYYY-MM-DD-HHmm.zip) and PK header;
 *   - walks the local headers: manifest.json first, chat_sessions/*.json, index last,
 *     STORE only, no data descriptors;
 *   - asserts manifest.export_format_version === 3;
 *   - runs scripts/e2e/fixtures/validate-official-backup.cjs on the file (exit 0 + OK);
 *   - round-trips it: delete all conversations, import the exported ZIP, assert the
 *     conversation count and texts come back unchanged.
 *
 * Costs no API calls.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./lib/backup-helpers.cjs');

const SEEDS = [
  { id: 'e2e-rt-1', title: 'E2E-ROUNDTRIP-一', question: '往返问题一：导出再导入', answer: '往返回答一：必须能读回来。' },
  { id: 'e2e-rt-2', title: 'E2E-ROUNDTRIP-二', question: '往返问题二：再导一次', answer: '往返回答二：顺序和文本都不变。' },
];

module.exports = {
  name: 'official-export',
  description: '导出官方 ZIP：文件名/PK 头/manifest 首条 v3/STORE 无 descriptor → 校验器 CLI exit0+OK → 删除全部后导入回来，会话数与文本不变',
  timeoutMs: 180000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const dir = path.join(os.tmpdir(), 'dsh-e2e-official-export-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    let exportedFile = null;

    const waitRail = async (count, label) => {
      await s.waitFor(expected => document.querySelectorAll('.dsc-railList .dsc-row').length === expected,
        { timeout: 15000, label: label || ('rail 会话数变成 ' + count) }, [count]);
    };

    try {
      const seeds = await h.seedConversations(ctx, SEEDS);
      ctx.log('种子会话: ' + seeds.map(item => item.title).join(' / '));

      await h.openSettings(ctx);
      const exported = await h.exportByDownload(ctx, dir);
      exportedFile = exported.file;
      const fileName = path.basename(exportedFile);
      ctx.assertMatch(fileName, /^deepseek_data-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/,
        '下载文件名是官方 deepseek_data-YYYY-MM-DD-HHmm.zip（实际 ' + fileName + '）');
      ctx.assert(exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b,
        '导出文件以 PK\\x03\\x04 头开始');
      ctx.log('导出: ' + fileName + ' (' + exported.bytes.length + 'B, ' + exported.behavior + ')');

      // Archive layout, straight from the local headers (our exporter is STORE-only).
      const entries = h.readLocalEntries(exported.bytes);
      ctx.assert(entries.length >= 4, 'ZIP 至少 4 条（manifest + 2 会话 + index），实际 ' + entries.length);
      ctx.assertEqual(entries[0].name, 'manifest.json', 'ZIP 首条是 manifest.json');
      const nameList = entries.map(item => item.name);
      ctx.assert(nameList.filter(name => name.startsWith('chat_sessions/')).length === 2,
        '两条会话各有一个 chat_sessions/<id>.json（实际 ' + nameList.join(', ') + '）');
      ctx.assertEqual(nameList[nameList.length - 1], 'chat_session_index.json',
        '最后一条是 chat_session_index.json');
      ctx.assert(entries.every(item => item.method === 0), '所有条目都是 STORE（method 0），与官方导出一致');
      ctx.assert(entries.every(item => (item.flags & 0x0008) === 0), '所有条目都没有 data descriptor');
      ctx.assert(nameList.every(name => name === 'manifest.json'
        || name === 'chat_session_index.json'
        || /^chat_sessions\/[^_]+\.json$/.test(name) === true
        || name.startsWith('chat_sessions/')), 'ZIP 条目命名符合官方布局');

      const manifest = JSON.parse(entries[0].data.toString('utf8'));
      ctx.assertEqual(manifest.export_format_version, 3, 'manifest.export_format_version === 3');
      ctx.log('manifest: ' + JSON.stringify(manifest));

      // Independent validator on the real file.
      const validation = h.validateBackup(exportedFile);
      ctx.assertEqual(validation.status, 0,
        'validate-official-backup.cjs exit 0（实际 ' + validation.status + '）\n'
        + (validation.stdout || validation.stderr).trim().split('\n').slice(0, 6).join('\n        '));
      ctx.assert(/^OK\s/m.test(validation.stdout), '校验器输出 OK');
      ctx.log(validation.stdout.trim().split('\n').slice(-1)[0]);
      await s.shot('official-export-file');

      // Round trip: delete everything, then import the ZIP we just wrote.
      await h.openSettings(ctx);
      const firstLabel = await h.clickDataRowButton(ctx, /删除全部|Delete all/);
      const confirmLabel = await h.clickDataRowButton(ctx, /要删除本浏览器中保存的全部对话|Delete every conversation/i);
      ctx.log('删除全部: ' + firstLabel + ' → ' + confirmLabel);
      await waitRail(0, '删除后 rail 为空');
      let stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 0, '删除后 localStorage conversations 为 []');

      await h.openSettings(ctx);
      await h.importBackupFile(ctx, exportedFile);
      await waitRail(2, '导入自己导出的 ZIP 后 rail 回到 2 条');
      stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 2, '往返后会话数不变（2）');
      const titles = stored.map(item => item.title).join(' | ');
      ctx.assertIncludes(titles, 'E2E-ROUNDTRIP-一', '往返后标题保留');
      ctx.assertIncludes(titles, 'E2E-ROUNDTRIP-二', '往返后第二个标题保留');
      ctx.assert(stored.every(item => item.messages.length === 2), '往返后每个会话仍有 2 条消息');

      // Only the active conversation renders; open both and read their bodies.
      await h.openRailConversation(ctx, 'E2E-ROUNDTRIP-一');
      const firstText = await s.eval(() => Array.from(document.querySelectorAll('.dsc-botBody'))
        .map(node => (node.innerText || '')).join(' | '));
      ctx.assertIncludes(firstText, '往返回答一', '往返后第一个回答正文可读');
      await h.openRailConversation(ctx, 'E2E-ROUNDTRIP-二');
      const secondText = await s.eval(() => Array.from(document.querySelectorAll('.dsc-botBody'))
        .map(node => (node.innerText || '')).join(' | '));
      ctx.assertIncludes(secondText, '往返回答二', '往返后第二个回答正文可读');
      ctx.log('往返成功: ' + titles);
      await s.shot('official-export');
    } finally {
      try {
        if (exportedFile && fs.existsSync(exportedFile)) {
          const stored = await h.storedConversations(ctx);
          if (!stored.some(item => item.title === 'E2E-ROUNDTRIP-一')) {
            await h.openSettings(ctx);
            await h.importBackupFile(ctx, exportedFile);
            ctx.log('finally: 已用导出的 ZIP 恢复会话');
          }
        }
      } catch (error) {
        ctx.log('finally 恢复失败（一次性 profile）: ' + error.message);
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        ctx.log('清理临时下载目录失败: ' + error.message);
      }
    }
  },
};
