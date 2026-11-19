# E2E 实机验证（DSH · vendored chat-demo UI）

在真实 DSH Web GUI 里跑无头 Chrome，通过 CDP 驱动面板，每个检查项产出
`docs/e2e/<name>.png` 截图并打印 PASS / FAIL / SKIP。本目录只驱动产品，不修改产品代码
（`client.js` 由 `scripts/build-client.mjs` 生成，**不要手改**）。

## 快速开始

```powershell
# 先取当前 GUI 端口：看 `dsh web` 输出，或当前会话系统提示里的 GUI URL
$env:DSH_E2E_GUI = 'http://127.0.0.1:<port>'   # 端口会变，默认值 55160 仅作兜底

node scripts/e2e/run.cjs --list                 # 列出 19 项（含 SKIP），不起浏览器
node scripts/e2e/run.cjs --only panel            # 单项/多项（逗号分隔）
node scripts/e2e/run.cjs --only account-login    # 账号登录免 Key（1 次生成）
node scripts/e2e/run.cjs --only model-picker     # 模型选择（0 次生成；Key 模式缺陷见下）
node scripts/e2e/run.cjs                         # 全量：15 PASS + 4 SKIP
node scripts/e2e/run.cjs --fresh-profile         # 冷 profile，跑完删除
```

- GUI 连不上时 harness 会直接报「连不上 GUI … 用 DSH_E2E_GUI 指定当前端口」。
- 其他环境变量：`DSH_E2E_CDP_PORT`（默认 9224）、`DSH_E2E_PROFILE`（默认 `%TEMP%/dsh-e2e-profile`）、
  `DSH_E2E_CREDENTIALS`（默认 `~/.dsh/.credentials.yaml`）、`DSH_E2E_CHROME`。
- 退出码：0 = 无 FAIL（SKIP 不算失败），1 = 有失败。准备阶段 CDP 抖动会自动重启浏览器重试一次。

## 目录

```
scripts/e2e/
  harness.cjs              # 登录 cookie 现签 / Chrome / CDP / steps（seedSettings、seedDemoKey、send…）
  run.cjs                  # 检查项框架：--list、--only、SKIP（静态/运行时）、PASS/FAIL、截图、退出码
  checks/                  # 每个 .cjs 一项；lib/demo-helpers.cjs 是共享 helper
  tools/verify-real-import.cjs  # 非套件工具：实机导入真实官方导出 ZIP（快照 → 导入 → 断言 → 保留）
  fixtures/                # 官方格式 ZIP fixtures + 独立 validator
docs/e2e/<name>.png        # 每项主截图（另有 -settings/-failed 等证据图）
docs/e2e/README.md         # 本文件
```

## 检查项（19 项 = 15 PASS + 4 SKIP）

| 检查 | 结果 | 内容 | 成本 |
| --- | --- | --- | --- |
| `panel` | PASS | 入口进入面板 → `.dsc-demo-host` + 标题「AI Chat」+ 主题 class → 欢迎语「今天有什么可以帮到你？」→ sider + 输入区（textarea/深度思考/智能搜索/语音/附件/发送） | 无 |
| `settings` | PASS | 面板内遮罩 + 两个 tab；通用设置含思考强度/API 地址/主题跟随系统；数据管理含登录方式/API Key/导入/导出/删除全部 | 无 |
| `chat-live` | PASS | 一次请求断言回答文本 + `.katex` + `.md-mermaid-diagram svg`（公式/Mermaid 管线） | 1 次生成 |
| `search-panel` | PASS | 智能搜索发问 → citation 角标 + 「已阅读 N 个网页」搜索步骤 → 点开 `SearchPanel`：`aside` 在 `.dsc-demo-host` 内、矩形不超出面板、列出 SourceCard（记录条数/首条标题）、可关闭 | 1 次生成 |
| `account-login` | PASS | 免 Key 账号登录：空 api-key + `auth-mode=account` → 打开面板 0 个 Key 弹窗 → `GET /plugins/dsh-deepseek-chat/account-token` 200 `{ok:true}`（token 不打印）→ 「登录方式=DeepSeek 账号（推荐）」+「已登录」→ 切手动 Key 再切回 → 空 Key 真实生成成功。profile 未登录时运行时 SKIP | 1 次生成 |
| `model-picker` | PASS | 模型行在 API Key 下方、不在通用设置；手动 Key 模式聚焦输入框拉 `/models` 出下拉（名称+id 两行、首条含 deepseek）、点选写 `chat-demo:model`、下拉关闭、手输 ID 回车保存、恢复 `deepseek-flash`。网络/凭据异常时留证后 SKIP | 0 |
| `branch-edit` | PASS | 编辑首条消息 → 消息版本 pager 2/2 → 切回旧问题+旧回答 → 切回新分支 → 重新生成出第二个回答版本 → IndexedDB 树 ≥5 条 → reload 后 pager 仍在 | 3 次生成 |
| `continue-reply` | PASS | 长回答 → 停止生成 → 「继续生成」→ 正文变长且按钮消失 | 2 次生成 |
| `key-verify` | PASS | Key 掩码 → `sk-invalid…` → 「API Key 无效」→ 换回真 Key 恢复掩码 | 2 次 `/models` |
| `read-aloud` | PASS | 朗读 → TTS 播放态（「停止朗读」）→ 停止 | 1 次生成 + 1 次 TTS |
| `voice-copy` | PASS | 语音按钮存在；headless 无麦克风 → 错误 toast，面板不崩 | 无 |
| `waiting-dots` | PASS | 限速发送 → 1–2s 内 3 个等待圆点 → 停止生成 | 1 次中断生成 |
| `official-import` | PASS | 覆盖模式导入 fixtures（基本包 / DEFLATE+descriptor / 13 片段+分支），显式取消合并勾选；结束快照恢复也走覆盖 | 无 |
| `official-export` | PASS | 导出含分支 ZIP（manifest v3、树 4 节点 2 root、校验器 exit 0）→ 删除全部 → 导入回来分支可切换 | 无 |
| `import-merge` | PASS | 默认合并导入：复选框默认勾选 + 「合并导入」+ 合并说明；N+1、原会话保留、同 ID 再导入不重复；取消勾选走覆盖只剩 1 个；状态文案「已导入 1 个对话」 | 无 |
| `edit-message` | SKIP | 新 UI 编辑总是新建分支，旧语义不存在（由 `branch-edit` 覆盖） | — |
| `data-management` | SKIP | 旧 JSON 备份已移除，只支持官方 ZIP（由 `official-*` 覆盖） | — |
| `math-mermaid` | SKIP | 已并入 `chat-live`（省一次 API） | — |
| `location` | SKIP | 省/市级联自定义 Select，交互成本高于覆盖价值 | — |

全量约 65–80s，账单上约 10 次生成 + 1 次 TTS + 少量免费 `/models`。

## 已知问题 / 注意

1. **GUI 端口会变**：默认 `55160` 只是兜底；当前端口从 `dsh web` 输出或会话系统提示取，
   用 `$env:DSH_E2E_GUI='http://127.0.0.1:<port>'` 传给 run.cjs。harness 检测到连接被拒会给出提示。
2. **已修复（1.2.2 / 7da3b78）：手动 Key 模式模型列表 401**。此前 `listModels` 只附加账号 token，
   手填 Key 时没带 `Authorization`/`x-api-key`，`GET /models` 返回 401、下拉不出现。现在 `listModels`
   与 `verifyApiKey` 一致（账号模式用账号 token，Key 模式用 `Authorization: Bearer <key>`），
   `model-picker` 已按正常断言路径 **PASS**（截图 `docs/e2e/model-picker.png`）。
   若将来网络/凭据异常导致拿不到列表，检查会留 `model-picker-fetch-failed.png` 并如实 SKIP，不误判产品缺陷。
3. **账号登录（免 Key）**：`chat-demo:auth-mode=account` + 空 Key 时不再弹 Key 提示；
   Host 路由仅 loopback、`cache-control: no-store`，token 只存内存、401 自动重取一次。
   `seedSettings` 默认 `auth-mode=key`（既有检查用种子 Key，不依赖当前登录态），
   `account-login` 显式 `{ authMode:'account', apiKey:'' }`。
4. **运行时 SKIP**：检查里可 `ctx.skip('原因')`；runner 打印 `SKIP <name> — 原因`、计入跳过、不算失败。
5. **存储**：demo 数据在 localStorage `chat-demo:*`（含 `api-key`、`auth-mode`、`model` 等）与
   IndexedDB `chat-demo`（v11，sessions/sessionSummaries/files/staging）。
   `seedSettings` 每个检查前清空 demo 键与五个 store 再 reload。
6. **导入**：默认合并（同 ID 覆盖）；`importHistoryZip(ctx, file, { merge:false })` 走覆盖。
   导入确认弹窗与设置弹窗都是 `[role=dialog]`，点击需用面板根作用域。
7. **ZIP 解析**：demo 导出为 STORE/DEFLATE + data descriptor，必须走中央目录解析（helper 已实现）。
8. **Mermaid 懒加载**：从 jsDelivr 按需加载；离线会停在 `.md-mermaid-status`（网络环境问题）。
9. **密钥安全**：Key 只进 `process.env` 与 profile 的 localStorage；脚本不打印不落盘，
   截图里是掩码，`close()` 清 demo/旧键里的 Key，`--fresh-profile` 结束删除 profile。
