/**
 * Check: data-management
 *
 * Exercises the backup data-management loop against the official-format exporter:
 *   1. seed two conversations (the "user data" that must not be lost);
 *   2. 导出 → intercepted download must be an official deepseek_data-*.zip (PK header);
 *   3. 删除全部 (two clicks) → rail empty, localStorage conversations [];
 *   4. legacy JSON import (the older dsh-chat-backup format is still supported):
 *      one conversation titled LEGACY-CHECK;
 *   5. import the exported ZIP back → both conversations return, storage is 2.
 *
 * The seed snapshot (exported ZIP) is imported back in finally if an assertion
 * failed mid-way. Temp download files are always removed. Costs no API calls.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./lib/backup-helpers.cjs');

const SEEDS = [
  { id: 'e2e-seed-1', title: 'E2E-SEED-一', question: '占位问题 A：这是第一条假会话。', answer: '占位回答 A。' },
  { id: 'e2e-seed-2', title: 'E2E-SEED-二', question: '占位问题 B：这是第二条假会话。', answer: '占位回答 B。' },
];

module.exports = {
  name: 'data-management',
  description: '数据管理：导出官方 deepseek_data-*.zip → 删除全部 → 旧 JSON 备份导入(LEGACY-CHECK) → 再导入导出的 ZIP 恢复 2 条会话，数据不丢',
  timeoutMs: 150000,
  cost: 'none',
  settings: { thinking: 'off', webSearch: false },

  async run(ctx) {
    const s = ctx.steps;
    const dir = path.join(os.tmpdir(), 'dsh-e2e-data-mgmt-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    let exportedFile = null;

    const waitRail = async (count, label) => {
      await s.waitFor(expected => document.querySelectorAll('.dsc-railList .dsc-row').length === expected,
        { timeout: 15000, label: label || ('rail 会话数变成 ' + count) }, [count]);
    };

    try {
      // 1. User data to protect.
      const seeds = await h.seedConversations(ctx, SEEDS);
      ctx.log('已种入 2 条假会话作为「用户数据」: ' + seeds.map(item => item.title).join(' / '));

      await h.openSettings(ctx);
      ctx.assertEqual(await s.count('.dsc-dataRow'), 3, '「数据管理」有 3 行（导出/导入/删除全部）');

      // 2. Export: official ZIP, intercepted download.
      const exported = await h.exportByDownload(ctx, dir);
      exportedFile = exported.file;
      ctx.assertMatch(path.basename(exportedFile), /^deepseek_data-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/,
        '导出的文件是官方 deepseek_data-*.zip');
      ctx.assert(exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b,
        '导出文件以 PK 头开始（ZIP）');
      ctx.assert(exported.bytes.length > 200, '导出 ZIP 非空（' + exported.bytes.length + ' 字节）');
      ctx.log('导出: ' + path.basename(exportedFile) + ' (' + exported.bytes.length + 'B)');
      await s.shot('data-management-export');

      // 3. Delete all: action, then confirm.
      await h.openSettings(ctx);
      const firstLabel = await h.clickDataRowButton(ctx, /删除全部|Delete all/);
      const confirmLabel = await h.clickDataRowButton(ctx, /要删除本浏览器中保存的全部对话|Delete every conversation/i);
      ctx.log('删除全部: ' + firstLabel + ' → ' + confirmLabel);
      await waitRail(0, '删除后 rail 为空');
      const emptied = await h.storedConversations(ctx);
      ctx.assertEqual(emptied.length, 0, '删除后 localStorage conversations 为 []');
      await s.shot('data-management-empty');

      // 4. Legacy JSON backup (older format) still imports.
      const legacyConversation = h.buildSeedConversations([
        { id: 'legacy-1', title: 'LEGACY-CHECK', question: '旧 JSON 备份里的问题', answer: '旧 JSON 备份里的回答' },
      ], Date.now())[0];
      const legacyFile = path.join(dir, 'legacy-backup.json');
      fs.writeFileSync(legacyFile, JSON.stringify({
        format: 'dsh-chat-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: { model: 'deepseek-flash' },
        conversations: [legacyConversation],
      }, null, 2), 'utf8');

      await h.openSettings(ctx);
      await h.importBackupFile(ctx, legacyFile);
      await waitRail(1, '旧 JSON 导入后 rail 只有 1 条');
      let stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 1, '旧 JSON 导入后 localStorage 只有 1 个对话');
      ctx.assertEqual(stored[0].title, 'LEGACY-CHECK', '旧 JSON 导入的标题是 LEGACY-CHECK');
      ctx.log('旧 JSON 备份导入成功: ' + stored[0].title);
      await s.shot('data-management-legacy');

      // 5. Restore the exported official ZIP; both conversations must come back.
      await h.openSettings(ctx);
      await h.importBackupFile(ctx, exportedFile);
      await waitRail(2, '导入导出 ZIP 后 rail 回到 2 条');
      stored = await h.storedConversations(ctx);
      ctx.assertEqual(stored.length, 2, '恢复后 localStorage 是 2 个对话');
      const titles = stored.map(item => item.title).join(' | ');
      ctx.assertIncludes(titles, 'E2E-SEED-一', '恢复后第一条会话标题正确');
      ctx.assertIncludes(titles, 'E2E-SEED-二', '恢复后第二条会话标题正确');
      ctx.log('已用导出的 ZIP 恢复 2 条会话: ' + titles);
      await s.shot('data-management');
    } finally {
      try {
        if (exportedFile && fs.existsSync(exportedFile)) {
          const stored = await h.storedConversations(ctx);
          if (!stored.some(item => item.title === 'E2E-SEED-一')) {
            await h.openSettings(ctx);
            await h.importBackupFile(ctx, exportedFile);
            ctx.log('finally: 已用导出的 ZIP 恢复用户数据');
          }
        }
      } catch (error) {
        ctx.log('finally 恢复失败（一次性 profile，不影响真实数据）: ' + error.message);
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        ctx.log('清理临时下载目录失败: ' + error.message);
      }
    }
  },
};
