# dsh-plugin-dex-style-edit

在 DeepSeek Harness 的聊天界面里，**直接编辑一条已经发出去的用户消息，然后从那一条继续**。

每条用户消息的气泡下方会多出一个铅笔图标（与原生「复制」「分支」并排）。点它，气泡就地变成一个文本框；改完按 `Enter`（或点 **Send from here**），插件会：

1. 在**这条消息之前那一轮**的 `turn/end` 处切一刀，派生一个新会话；
2. 把当前视图切到那个新会话；
3. **直接把改过的文本作为新会话的第一条消息发出去**，这一轮立刻按新内容开跑；
4. 等这一轮跑起来之后，**把被替换的原会话归档**（`archiveSession`），它从侧栏的普通列表里退场。

第 4 步是为了让观感真的像"原地编辑"：DSH 日志只追加，原会话物理上还在、也还能通过归档列表找回来，但不会再和新会话并排躺在侧栏里。

发送走的是 composer 给空闲会话用的同一条路径（`binding.session.prompt([{type:'text',text}], 'queue')`），所以不是"填进草稿等你再按一次回车"。

插件还会在**侧栏**给每个 fork 出来的会话加一个分支小图标（见下文「侧栏 fork 徽标」）。

工作目录与文件**完全保持现状**（和 Codex 桌面版的分叉语义一致：*This keeps your current files and worktree state as-is*）。

## 为什么是"派生新会话"而不是"真的改历史"

DSH 的会话日志是**只追加**的，持久层明文写着 *Committed events are never rewritten*，并且没有任何删除/截断/改写 API（`ctx.sessions` 上只有 `fork`、`create` 之外的读取方法）。所以"把第 3 条消息改掉、后面全部丢掉"在 DSH 里无法原地完成——唯一能改变过去消息的机制就是 fork。

原会话始终保留，左侧栏会多出一条派生记录。

## 安装

## 安装

```sh
# 从 GitHub 安装（走 git，目标机器需要装 git）
dsh plugin --profile desktop add github:XylaAlyx/dsh-plugin-dex-style-edit

# 不走 git 的等价方式（走 HTTPS 打包下载）
dsh plugin --profile desktop add https://codeload.github.com/XylaAlyx/dsh-plugin-dex-style-edit/tar.gz/HEAD
```

装完**必须重启 DSH**（原因见下）。

<details>
<summary>本地开发安装（不走 GitHub）</summary>

插件是一个标准 DSH Profile Bundle，手工装进某个 profile 也是三步：

```powershell
# 1. 让包能被 profile 解析到
New-Item -ItemType Junction `
  -Path   "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-dex-style-edit" `
  -Target "<本目录绝对路径>"

# 2. 在 profile 的 package.json 里声明依赖与 bundle
#    dependencies 加 "dsh-plugin-dex-style-edit": "link:<本目录绝对路径>"
#    dsh.profile.bundles 追加 "dsh-plugin-dex-style-edit"
```

第 3 步是 `cordis.patch.yml`：本包自带的 patch 会把插件挂进 Loader，**不需要**手改 profile 的 patch。

等价做法是 `dsh plugin --profile desktop add <本目录绝对路径>` 或 `link:<本目录绝对路径>`。

</details>

### 必须重启 DSH

桌面端（Electron）在 host 向渲染进程报告 `ready` 时**只收集一次** index 注入表
（`dsh-desktop-host/lib/index.js`：`injections: ctx.webServer.collectIndexInjections()`），
而渲染层缓存这张表、没有刷新路径。因此新装的插件**必须重启整个 DSH 应用**才会出现；
单纯刷新页面不够。

装好并重启之后，之后**只改 `lib/client.js` 不需要重启**：`dsh-client-hmr` 每 500 ms 轮询该文件的
`mtimeMs || ctimeMs || size`，变化即热替换（会丢 React 局部状态，会话和输入框内容保留）。
改 `lib/index.js`（host 半）需要重启。

## 行为细节

| 场景 | 表现 |
|---|---|
| 会话第 2 条及以后的消息 | 铅笔可用；发送后切到新会话，改过的文本作为该会话的第一条消息立即开跑，原会话被归档 |
| 会话第 1 条消息 | 铅笔**禁用**，悬停提示说明原因（没有更早的轮次可以承接） |
| 带图片/附件的消息 | 铅笔可用，但提示里会写明附件**不会**带过去（文本编辑器只能带文本） |
| 发送被宿主拒绝 | 编辑器保持打开并显示原因，文本不丢，可改完重试；**原会话不会被归档** |
| 归档失败 | 只记一条 warn，编辑本身仍算成功（消息已经在分叉上跑起来了） |
| 运行中的轮次 | 只有该轮的**开篇消息**可编辑；轮到中途插入的 steer 消息会返回 `NOT_TURN_OPENING` |
| 注入的上下文（agent-instructions / runtime-context / skill-catalog） | 不渲染为可编辑气泡，与原生一致 |

操作行（时间 · 复制 · 编辑 · 分支）在这个实现里是**常显**的，不再只在 hover 时出现——
因为接管 `key: 'user'` 渲染器时必须自己重画整行。

## 侧栏 fork 徽标

侧栏里每个**从别的会话派生出来的**会话，标题前会显示一个 14px 的分支图标，悬停提示
`Branched from <父会话标题>`。它覆盖所有 fork 来源：本插件的编辑、原生「分支」按钮、任何别的方式。

数据完全来自 DSH 已有的会话谱系，插件不新增任何字段：

| 判据 | 来源 |
|---|---|
| 有父会话 | 客户端会话快照 `byId[id].parentId`（服务端 header 的 `parentSession`） |
| 不是 subagent 子会话 | 快照里的 `origin !== 'subagent'` |

挂载点是官方槽位 **`sidebar.session.row.leading`**（`replaceRisk: none`，语义就是"标题前那个 16px 格子"），
不需要遮蔽任何官方 UI。

三个已知边界：

- **运行中不显示**。该格子被 `ui-workspace` 占用时显示的是状态点（`showStatus` 为真就轮到状态点），
  所以一个正在跑的 fork 暂时看不到徽标，等它 settled 就出现。
- **头部没有面包屑**。DSH 会话标题栏的祖先链在遇到第一个非 subagent 会话时就停住
  （`deriveAncestry`：`if (summary.origin !== "subagent") break`），所以普通 fork 在头部不显示来源；
  侧栏徽标是目前唯一的谱系入口。
- **归档后不显示**。归档行不走这个格子。

## 实现要点

- **没有用户消息操作槽位**：DSH 唯一的"消息动作区"是 `conversation.chat.assistant-actions`，
  只服务已定稿的 assistant 轮次。所以本插件接管 keyed 槽位 `conversation.chat.node` 的
  `key: 'user'`（`replaceRisk: shadows-shipped-ui`），用 `priority: -1` 压过官方那条
  （槽位注册表按 priority 升序取第一个存活条目）。
- **重画气泡**：官方 `UserStyleBubble` / `MessageIconActions` / `MessageAction` 都没有导出，
  只能自己实现。外观照抄官方的 CSS 模块（`MessageItem.module.css` / `MessageIconActions.module.css`），
  设计 token 全部核对过确实存在于 DSH 主题中；图标复用
  `@deepseek-ai/dsh-client-ui-primitives` 的 `IconEditOutlineRegular` 等。
- **fork + 发送 + 归档**：`ctx.sessions.fork({ sessionId, atSeq, increaseTitle: true })` →
  `ctx.uiWorkspace.openSession(childId)` → 轮询拿到 `ctx.sessions.binding(childId)` →
  `binding.session.prompt([{ type: 'text', text }], 'queue')` →
  `ctx.uiWorkspace.archiveSession(sessionId, { stopActivity: false })`。
  插件不自己拼会话种子、不碰磁盘。归档是收尾动作，失败只 warn：消息此刻已经在分叉上跑了，
  不能因为收尾失败就把它报成编辑失败（否则文本会看起来丢了）。
- **侧栏徽标不遮蔽官方 UI**：注册进 `sidebar.session.row.leading`（list/root，`replaceRisk: none`），
  只读会话快照的 `parentId` / `origin`。选择器按值订阅，所以列表每次重建 `byId` 也不会引发重渲染风暴。
- **host 半只读**：一个同源 POST 路由 `dex-style-edit/resolve` 把
  「消息 seq → 所属轮次 → 上一个 `turn/end` 的 seq + 原文」算出来。
  它只读事件日志（`ctx.sessions.get()` 或 `ctx.sessionQuery.readSession()`），从不写；
  `inject` 里必须同时声明 `sessions` 与 `sessionQuery`，否则 Cordis 读属性即抛。
  路由自带回环 Host / `Origin` 校验（`ctx.webServer` 本身没有鉴权）。

## 开发

```powershell
node --test --test-isolation=none tests/resolve.test.mjs   # host 侧解析逻辑（纯函数，10 例）
node scripts/selfcheck.mjs                                  # 清单 / 平台模块 / 槽位 / 发送契约自检
node scripts/preflight.mjs                                  # 安装是否被 profile 正确接上
```

`selfcheck` 认两个可选环境变量：`DSH_PRIMITIVES_INDEX`（primitives 的 `lib/index.js`，
用来核对借用的符号真的导出）与 `DSH_SLOTS_JSON`（`_ds/slots.json`，用来核对目标槽位确实存在且是
`shadows-shipped-ui`）。

浏览器半边的渲染与异步发送**没有自动化测试**——它需要真实 React 的提交语义，用假 React 模拟只会
得到误导性的结论。这部分靠真机验收：装好后在 GUI 里点一条历史消息的铅笔，确认新会话立刻带着改过的
文本开跑。

## 卸载

删掉 profile 的 junction、把包名从 `dependencies` 和 `dsh.profile.bundles` 移除，重启 DSH。
插件不改动任何 DSH 安装文件。
