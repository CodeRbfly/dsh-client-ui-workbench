# 文档索引

工作台（`dsh-client-ui-workbench`）的文档入口。**先在这里找到你要的那一份，别从头翻。**

## 0. 先说清两个 `docs/`

同名但**完全是两回事**，混过一次就会白找半天：

| 路径 | 是什么 | 谁写 |
| --- | --- | --- |
| `<插件>/docs/` | **本文所在**：开发文档（存储规范、文档生成方案、差异清单） | 我（代码仓库的一部分；`package.json.files` 不含它，但 `tools/pack-offline.mjs` 的 `ARCHIVE_ONLY` **会**把它打进离线包 —— 因为两个 README 都链到 `docs/storage-format.md`，不收它那个链接在解包后就是死的。**所以这份索引在内网那台机器上也能读到**） |
| `<工作区>/docs/requirements/` | **数据**：所有需求、所有阶段产物、模板 | 你和 AI 在界面上操作时写 |

下文凡是写 `docs/requirements/...` 都指**工作区**那一侧。

## 1. 读哪一份

| 你想知道 | 读 |
| --- | --- |
| 这是什么插件、怎么装、怎么改代码 | [`../README.zh.md`](../README.zh.md)（英文版 [`../README.md`](../README.md)，两份地位相同） |
| 数据怎么存、为什么这么拆、多人并发为什么不冲突 | [`storage-format.md`](storage-format.md) |
| **文档生成**（模板放哪、占位符怎么写、缺字段怎么办） | [`document-generation-plan.md`](document-generation-plan.md) |
| 当初为什么动这些地方（目标流程 vs 现状的对照，**决策记录**） | [`workflow-gap.md`](workflow-gap.md) |
| 具体改了什么、每一轮的推理 | [`../CHANGELOG.md`](../CHANGELOG.md) |

## 2. 当前落地状态

五个阶段：`需求` → `方案` → `开发` → `测试` → `提版`。**`需求` 与 `提版` 是共享的，
其余按人分目录**（`Pipeline/<阶段>/<开发人员>/`）。

| 阶段 | 产物（相对 `Pipeline/<阶段>/<人>/`） | 状态 |
| --- | --- | --- |
| 需求 | `需求/source/*.docx` · `需求/parsed/vN.txt` · `需求/analysis/vN.{md,points.json}` | ✅ 可用（导入 → AI 解析 → 多版本对比 → 删版本连带删内容） |
| 方案 | `draft.md` · `impact.json` · `tasks.json` · **`apis.json`** · **`pages.json`** · `方案文档.md`(生成物) · `design.json` | ✅ 可用（P0a/P0b 已落地） |
| 开发 | `changes.json` · `commits.json` · `selftest.json` | ✅ 可用；**自测报告（P0c）待做** |
| 测试 | `cases.json` · `runs.json` · `defects.json` | ✅ 可用；**正式测试由专门测试人员执行，不在本轮范围** |
| 提版 | `release.json` · `changelog.md` · `notes.md` | ✅ 可用；**提版文档（P0d）待做** |

契约自检：`node tools/verify.mjs` → **624 条，全绿**（这个数字由 `verify.mjs` 实际输出，
README 里的同一数字由自检断言比对）。

## 3. 文档生成：现在能做什么

**只有方案文档（P0a/P0b）。** 三步走，刻意不合成一步：

```
方案页 → 【生成方案文档】→ 页内预览（缺哪些字段当场列出来）
              ↓
        【复制全文】  或  【写入文件】 Pipeline/方案/<人>/方案文档.md
```

- **模板位置**：`<工作区>/docs/requirements/templates/方案/方案文档.md`。
  **工作台级、一套共用**，不在需求文件夹里 —— 公司模板本来就只有一套，改一次全生效。
  模板读写走宿主 op `readTemplate` / `writeTemplate`（**开机注册**，所以新增 op 时
  **需要重启一次 DSH**；宿主没重启时界面会明说，不会静默换成内置模板）。
- **先要底稿**：页面上【把内置模板写到 templates/方案/】会摊出内置模板
  （宿主**拒绝覆盖**已存在的文件，所以不会冲掉你改好的版本）。
- **占位符**只有三种：`{{path}}` / `{{#each}}…{{/each}}` / `{{#if}}…{{else}}…{{/if}}`；
  **刻意不支持嵌套循环**（模板要给人手写）。语法错误一律报错，不渲染半成品。
- **缺字段必须看得见**：文档级字段取不到值 → 「（待补：路径）」并列成清单；
  列表项里的空字段留空（表格的空单元格就是没写）。绝不静默留空，绝不编造。
- 完整占位符契约表见 [`document-generation-plan.md`](document-generation-plan.md) 第 4 节；
  内网填模板的步骤见同一份的第 6 节。

## 4. 本机的开发循环

改代码（Windows / PowerShell 5.1）：

```powershell
cd <插件目录>
node tools/verify.mjs                     # 离线契约自检，不需要 DSH / 浏览器 / 网络
node tools/install.mjs                    # 装到 $DSH_HOME/profiles/node_modules/
node tools/check-bundle.mjs --expect 'a,b,c'   # 浏览器**实际拿到**的 bundle 里有没有这些标志
```

几条踩过的坑，写在命令里比写在心里有用：

- `check-bundle.mjs` 的多个标志要写成**一个逗号分隔的 `--expect`**；重复给 `--expect`
  是**后者覆盖前者**，不会累加 —— 那样会得到一个"看起来全过"的假结果。
- 只改 `lib/client.js` → **热更新**（约 0.5 秒，浏览器不用刷新）。
  改 `index.js`（宿主半边）→ **必须重启一次 DSH**，新增 op 更是如此（op 是开机注册的）。
- `tools/rpc.mjs <op> --args-file <json>` 调任何 op。**参数一律走文件**：
  PowerShell 会吃掉内联 JSON 的引号，而 `Set-Content -Encoding UTF8` 会写进 BOM 让 JSON 解析失败。
- 重启脚本：`explorer.exe _restart-launch.vbs`（工作区根），日志 `_dsh-web-restart.log`。

## 5. 已知的、我没动的上游问题

这些是**数据或环境**里的既存异常，我只报告、没有改（改共享数据不该由我顺手决定）：

**数据内容（`XQ20260918-0009`，目前唯一有真实内容的需求）**

| # | 现象 | 影响 |
| --- | --- | --- |
| 1 | 标题是**「小小测试」**，内容却是《CRM 需求规格说明书》（108 个功能点） | 列表里认不出它是什么；标题与内容不符 |
| 2 | 三个日期全空：`releaseDate` / `testFreezeDate` / `goLiveDate` | **无法排期**；渲染进文档就是三处「待补」 |
| 3 | `3c673c19…「测试测试1」` 没有 `source` / `sourceVersion` / `createdAt`，而其余 107 个点都有 | 强烈提示它是**手工遗留的点**，不是 AI 分析出来的 |
| 4 | 分块 `测试测试` 下有 2 个点：一个真实点（`adada055…客户建档表单`）+ 上面那个遗留点 | 真实功能点被塞进了测试分块 |
| 5 | 108 个点里只有 **33 个**分派了人（小飞飞），75 个未分派；`联系人` 分块 5 个点全未分派 | 方案与任务只覆盖 33 个点；渲染出的方案文档也只看得到这些 |
| 6 | `v1.1.txt` 的文件头仍写 `v1.0`，§17.1/§17.2 未与正文同步 | 版本号不可信；108 个点 vs §17.1 只列 84 条 |
| 7 | `design.json` 在**所有**需求里都不存在 | 方案从未定稿（所以方案阶段不会显示「已审核」） |

**测试数据**：`XQ20260917-0003`（标题`测试测试`）、`XQ20260917-0004`（`多人协作示例`，用于多人协作
验证）、`XQ20260917-0001`（`客户经营信息优化`，`paused`，0 个功能点）都是演练/示例数据，
不是真实需求。要清理请你自己确认后删（界面上的删除是**不可逆**的）。

**没查清的一件事**：早先有一个装 CRM 规格的容器 `XQ20260918-0001`，现在不在
`docs/requirements/` 里了 —— 很可能是新加的「删除需求」被点了一下。这里没有回收站
（也没有 git），所以**恢复不了**；两个 `.docx` 原件还在工作区根目录，需要的话可以重新导入。
要不要给删除加一个 `docs/requirements/.trash/` 中转，等你定。

## 6. 这些文档里哪些是机器钉住的

有必要说清楚，因为**散文会腐坏，而我刚刚就抓到一次**：

| 被机器钉住的 | 由谁钉 |
| --- | --- |
| 离线契约、模板↔数据字段契约（`DOC_SCOPE_KEYS.design`） | `tools/verify.mjs` 第 34 组 |
| 两个 README 的同步（git blob 哈希） | `tools/verify.mjs` 第 8 组 + `README.i18n.yaml` |
| README 里的断言条数 | 同上（数字被人改错会红） |
| **其余所有散文结论** | **没有人钉** —— 只能靠人读 |

具体腐坏过一次：`document-generation-plan.md` 第 4.2 节早先写的是 `{{done}}`，
而实现里是 `{{doneText}}`（`是`/`否`）。照着那张表抄模板，只会得到一格「待补」——
**而这正是"缺字段要看得见"这条策略发挥作用的地方**：错误没有静默，它变成了可见的「待补」。
所以那份契约表现在与 `DOC_SCOPE_KEYS.design` 逐字对齐，凡引用它请以代码为准。
