# 文档生成方案（模板机制 + 占位符契约）

按你的最新确认收敛了范围。本文是**可直接执行的清单**：你在内网照着第 6 节填模板，
代码侧 **P0a + P0b 已落地**（第 7 节标 ✅ 的就是已经做完的）。
**注意第 3.1 节与最初计划不同**：模板改放工作台级 `templates/<阶段>/`，因此**需要重启一次 DSH**。

---

## 0. 范围

| | 内容 |
| --- | --- |
| **做** | ① 方案阶段补两张结构化清单（接口/页面）**✅** → ② **方案文档**生成 **✅** → ③ **自测报告**生成（归「开发」阶段）**待做** → ④ **提版文档**生成 **待做** |
| **不做**（你已明确） | 上传流程系统的动作与回执、测试阶段的用例/执行/缺陷（专门测试人员负责）、导出格式（.docx 等）、角色权限 |

范围收敛带来的一个简化：上一版计划里的 `requirement.json.deliveries`（单号回执）**取消**，不再动共享元数据。生成即写盘，用户自己去提交。

---

## 1. 用户看到的样子

```
方案页（我的）  [生成方案文档] → 预览（缺哪些字段当场列出来）→ [写入文件] Pipeline/方案/<人>/方案文档.md
                                + [复制全文]（直接粘进流程系统）
                [把内置模板写到 templates/方案/] ← 拿到一份占位符位置正确的底稿
开发页（我的）  [生成自测报告] → 预览 → 写盘 Pipeline/开发/<人>/自测报告.md        （P0c，待做）
提版页          [生成提版文档] → 预览 → 写盘 Pipeline/提版/提版文档.md              （P0d，待做）
```

生成后页面上有一条说明，避免误解：**"生成文件是导出物，不要手改 —— 改数据源（清单/自测/任务）后重新生成即可。"**
再次生成**直接覆盖**，不留版本（留版本会导致"哪份是真的"这种问题，而生成物本该可复现）。

---

## 2. 前置：方案阶段的两张结构化清单

方案文档要有内容，先得让"接口"和"页面"变成**可逐行增删改的数据**（这正是你的原话："后端需要修改或新增什么接口、前端需要新增或修改哪些页面"）。

位置与现有方案产物同级：`Pipeline/方案/<开发人员>/`。

**`apis.json`**（后端接口清单）

| 字段 | 说明 |
| --- | --- |
| `pointId` / `pointName` | 属于哪个功能点（`pointName` 冗余存，方便模板直接渲染） |
| `taskNo` | 关联任务号（T01…，见第 4.2 节的推导） |
| `name` | 接口名（如 `客户查重预检`） |
| `method` | `GET/POST/PUT/DELETE`，未定留空 |
| `path` | 路径，未确定写 `（路径待确认）` —— **合法值，不是错误** |
| `change` | `新增` / `修改`，未定留空。**实现上是自由文本，不是下拉** —— 下拉的默认值会把「还没想清楚」变成一个具体态度 |
| `request` / `response` | 入参 / 出参要点 |
| `note` | 备注（权限、幂等、兼容开关等） |

**`pages.json`**（前端页面清单）

| 字段 | 说明 |
| --- | --- |
| `pointId` / `pointName` / `taskNo` | 同上 |
| `route` / `name` | 路由 / 页面名，未定留空 |
| `change` | `新增` / `修改`，未定留空（同上：自由文本） |
| `blocks` | 页面区块（表单分区、页签、列表列等） |
| `interaction` | 关键交互（校验时机、二次确认、置灰条件…） |
| `note` | 备注 |

UI 直接复用现有 `STAGE_BLOCKS` 的行表格（加行/删行/改单元格/存盘），和 `changes.json` 是同一套组件。
**注意**：`方案` 阶段目前不在 `STAGE_BLOCKS` 里（它走 preset：`draft.md/impact.json/tasks.json/design.json`），
所以这两块做成方案页里新增的第 4、5 个区块，**不动**现有的定稿/版本快照逻辑。

同时收紧方案阶段的 AI 指令（`stagePrompt`）：
**先产出 `apis.json` / `pages.json` 两张表，再据此写 `draft.md`** —— 正文变成清单的叙述版，而不是清单藏在正文里。
`impact.json` 保持现状（散文），在模板里按纯文本占位符引用。

---

## 3. 模板机制

### 3.1 位置与解析顺序（**已按实际实现更新**）

```
<工作区>/docs/requirements/templates/方案/方案文档.md     ← 方案文档模板
<工作区>/docs/requirements/templates/测试/…               ← 自测 / 测试报告模板（P0c）
<工作区>/docs/requirements/templates/提版/…               ← 提版文档模板（P0d）
```

**模板是工作台级、全工作台共用一套**，不在每条需求里 —— 公司模板本来就只有一套，改一次全生效。
这三个目录**宿主早就建好了**（`index.js` 的 `TEMPLATE_DIRS` + `ensureLayout`），以前没人用，
现在正式启用。它不在需求文件夹内，客户端读不到，所以走宿主 op `readTemplate` / `writeTemplate`。

解析顺序：**自定义模板 → 内置默认模板**。模板缺失/读失败一律回落到内置默认，**绝不因为模板问题拒绝生成**。
要分清两种"没读到"：

- `not-found`（还没放模板）→ 正常，用内置默认，界面上提示该把文件放哪，并提供
  【把内置模板写到 templates/方案/】（宿主的 `writeTemplate` **拒绝覆盖**已有文件）；
- `unknown-op`（宿主没重启、还没注册这两个 op）→ 界面上**明说"重启一次 DSH"**，
  不能静默回落 —— 用户改了半天模板、生成的文档却一点没变，而没有任何提示，那是最坏的一种。

模板**语法与渲染**全在客户端 bundle 里（改语法不用碰宿主）；只有"读写模板文件"是宿主 op。
→ 这一条与最初计划不同：**需要重启一次 DSH**（新增 op 是开机注册的）。

### 3.2 语法（只有这三种，够用且好手写）

```
{{path}}                          标量替换
{{#each path}} … {{/each}}        循环；块内直接写字段名，行里自动带一个 1 起的 {{index}}
{{#if path}} … {{else}} … {{/if}} 有值才输出（空串 / 空数组 / 0 / 缺失 = 「没有」）
```

- 路径用点号：`{{requirement.id}}`、`{{impact.risk}}`。
- 循环块内用**裸字段名**：`{{name}}`、`{{method}}`（不写 `this.`）。
- **限制：不支持嵌套循环。** 需要嵌套就由数据侧预处理扁平化（例如接口行自带 `pointName`）。
  这条限制是刻意的：模板要给人手写，嵌套语法一进来就没法维护。
- 语法错误（未闭合、标签不成对、`{{else}}` 没有对应的 `{{#if}}`、不认识的块、嵌套循环）
  **一律报错**，不渲染半成品 —— 用户会照着半成品去开发。
- markdown 表格写法（这是你会用得最多的形式）：

```markdown
| 序号 | 接口名 | 方法 | 路径 | 新增/修改 |
| --- | --- | --- | --- | --- |
{{#each design.apis}}| {{index}} | {{name}} | {{method}} | {{path}} | {{change}} |
{{/each}}
```

### 3.3 缺失字段策略（重要）

**文档级**字段取不到值 → 输出 `（待补：字段名）`，并在预览上方汇总 **"缺 N 项：xxx, yyy"**；
**列表项里的空字段留空**（表格里某一行的备注没写就是没写，每格都印"待补"会把真正的缺口淹掉）。

- 绝不静默留空（那会让文档看起来完整、实际缺内容）；绝不编造。
- 数据源全空时**不生成空壳**：直接提示"还没有可生成的内容"。
- 这条同时是你和我的沟通通道：公司模板里要、我数据里没有的字段，**照原样写占位符**即可，
  生成时它会出现在"待补"清单里 —— 你把清单发我，我要么补数据源，要么确认它是人工填写项。

---

## 4. 占位符契约

### 4.1 所有文档共有的 scope

| 占位符 | 来源 |
| --- | --- |
| `{{requirement.id}}` `{{requirement.title}}` `{{requirement.status}}` | `requirement.json` |
| `{{requirement.developers}}` | `requirement.developers`，用**顿号**连接（`、`） |
| `{{requirement.releaseDate}}` `{{requirement.testFreezeDate}}` `{{requirement.goLiveDate}}` | 同上（**当前为空 → 渲染成"待补"**，这是真实状态，不要用"待定"糊过去） |
| `{{developer}}` | 当前人（提版文档为空） |
| `{{generatedAt}}` | 生成时间（ISO） |
| `{{templateSource}}` | 实际渲染值只有两种：`自定义模板 templates/方案/方案文档.md` 或 `内置默认模板` |

### 4.2 方案文档（`Pipeline/方案/<人>/方案文档.md`）✅ 已实现

数据源：`requirement.json` + `draft.md` + `impact.json` + `tasks.json` + `apis.json` + `pages.json` + **分派给该人的**功能点。

> 下表与 `lib/client.js` 的 `DOC_SCOPE_KEYS.design` **逐字对应**，而那张表本身被契约自检
> 双向钉住（模板引用的每个键都在表里、表里每个键都能从真实数据取到）。
> 内网写模板时照这张表抄；我已经踩过一次坑 —— 早先这里是 `{{done}}`，实现里是
> `{{doneText}}`，照着抄只会得到一格「待补」。

| 占位符 | 说明 |
| --- | --- |
| `{{design.draft}}` | 方案正文全文 |
| `{{design.preamble}}` | 正文里**第一个 `## ` 之前**的内容（多数 `draft.md` 没有这一段，取到就是空串） |
| `{{design.sections}}` | 正文按 `## ` 标题拆出的小节数组：`{{#each design.sections}}{{title}}…{{body}}{{/each}}`（行内可用 `{{index}}`） |
| `{{design.section}}` | 按标题直接取某小节：`{{design.section.一、需求与目标}}`（标题里的空格要原样写）。这是**动态键**，不在声明表里，但可以出现在模板里 |
| `{{design.pointCount}}` `{{design.taskCount}}` `{{design.effortTotal}}` `{{design.apiCount}}` `{{design.pageCount}}` | 汇总数字（我负责的点数 / 任务数 / 人天 / 接口数 / 页面数） |
| `{{#each design.points}}` | `{{index}} {{name}} {{group}} {{taskNos}}`（`taskNos` 用顿号连接，没关联任务就是空串） |
| `{{#each design.tasks}}` | `{{index}} {{taskNo}} {{title}} {{estimate}} {{pointName}} {{doneText}}`（`doneText` 是 `是`/`否`） |
| `{{#each design.apis}}` | `{{index}} {{pointName}} {{taskNo}} {{name}} {{method}} {{path}} {{change}} {{request}} {{response}} {{note}}` |
| `{{#each design.pages}}` | `{{index}} {{pointName}} {{taskNo}} {{name}} {{route}} {{change}} {{blocks}} {{interaction}} {{note}}` |
| `{{impact.risk}}` `{{impact.modules}}` `{{impact.rollback}}` `{{impact.dependencies}}` | `impact.json` 四段（纯文本；当前 `modules` 是一大段散文，模板里当段落用，**不要**去循环它）。`impact.json` 整个文件缺失时这四处**一起**变成「待补」—— 比一片空白更早让人发现"影响面还没写" |

> **任务号 `T01` 的推导**：`tasks.json` 里**没有** T 号，T 号是"任务在数组里的序号"（1 起，补零两位）——
> `汇总.md` 现在就是这么用的（44 条 → T01–T44，功能点 16 的任务是 T44，因为它排最后）。
> 渲染器采用同一规则，保证生成文档里的 T 号与汇总.md 一致；这条会写成断言。
> 注意 `apis.json` / `pages.json` 里的 `taskNo` 是**人手填的文本**，不是推导出来的 ——
> 它是给读文档的人看"这条接口是为哪个任务做的"，填错了不会有任何报错。

### 4.3 自测报告（`Pipeline/开发/<人>/自测报告.md`）— **P0c，尚未实现，下面是设计意图**

数据源：`selftest.json` + `changes.json` + 该人的 `tasks.json` + 一张新的元信息小表。

| 占位符 | 说明 |
| --- | --- |
| `{{selftest.total}}` `{{selftest.pass}}` `{{selftest.fail}}` `{{selftest.pending}}` | 由 `selftest.json` 统计，非人工填 |
| `{{selftest.conclusion}}` | **由统计自动判定**：无 pending/fail → "通过"；否则逐条列出未通过项（不给人手写"通过"的机会） |
| `{{#each selftest.items}}` | `{{index}} {{item}} {{result}} {{note}}` |
| `{{#each develop.changes}}` | `{{taskNo}} {{target}} {{note}} {{done}}` |
| `{{develop.taskDone}}` `{{develop.taskTotal}}` | 任务完成比例 |
| `{{env.name}}` `{{env.version}}` `{{env.at}}` | 见下 |

自测环境/代码版本这类信息数据里推不出来，所以生成报告时弹一个小输入框（测试环境 / 代码版本或分支 / 自测时间），
存到 `Pipeline/开发/<人>/selftest.meta.json`，下次预填。**留空就在报告里渲染成"待补"，不猜。**

### 4.4 提版文档（`Pipeline/提版/提版文档.md`）— **P0d，尚未实现，下面是设计意图**

数据源：全员 `tasks.json` / `changes.json` / `commits.json` / 各自 `自测报告` + `release.json`。

| 占位符 | 说明 |
| --- | --- |
| `{{release.version}}` `{{release.releasedAt}}` | `release.json` 两个字段 |
| `{{release.taskCount}}` `{{release.effortTotal}}` `{{release.pointCount}}` | 全员汇总 |
| `{{#each release.points}}` | `{{index}} {{name}} {{developer}} {{taskNos}} {{changed}}`（按功能点归并变更） |
| `{{#each release.tasks}}` | `{{taskNo}} {{title}} {{developer}} {{estimate}} {{done}}` |
| `{{#each release.commits}}` | `{{hash}} {{message}} {{developer}}` |
| `{{#each release.selftests}}` | `{{developer}} {{pass}} {{fail}} {{pending}} {{conclusion}}` |
| `{{#each release.gaps}}` | **对不齐的地方**：有任务无变更记录 / 有变更没挂 taskId / 有人没出自我测报告 |

`release.gaps` 是这份文档的价值点：提版前先看到"哪里对不上"，而不是等评审时被问。

---

## 5. 生成物规则

1. 首行固定生成头（`docHeader()`，实际形状逐字如下）：
   `<!-- 工作台生成 · 模板=<模板路径，没读到自定义模板时是"内置默认模板"> · 时间=<ISO> · 数据源=draft.md + impact.json + tasks.json + apis.json + pages.json -->`
   用途：日后翻出一份文档，能立刻知道它是哪来的、用的哪版模板。
   **数据源那一段是写死的常量 `DOC_SOURCES`**，不是"这次真的读到了什么"—— 它回答的是
   "这份文档由哪几样东西决定"，而 `requirement.json` 与功能点不在里面（它们是所有文档共有的底）。
2. 生成物**不作为任何 AI 指令的输入**（避免"自己吃自己"的循环）。
3. 数据源全空时**不生成空壳**：点【生成方案文档】直接提示"还没有可生成的内容"
   （正文、接口清单、页面清单、任务全空）。
4. 生成物不进 `STAGE_BLOCKS`（它是导出物，不是可编辑产物），只在对应阶段的页面区块里出现 + 一个「复制全文」按钮（方便直接粘进流程系统）。

---

## 6. 你在内网要做的事（照这个顺序）

1. **工作台根**下的 `templates/方案/` 目录已经存在（宿主建好的），
   把 `方案文档.md` 放进去：`docs/requirements/templates/方案/方案文档.md`。
   也可以先在页面上点【把内置模板写到 templates/方案/】，拿到一份占位符位置正确的底稿再改
   （宿主**拒绝覆盖**已存在的文件，所以不会把你改好的版本冲掉）。
2. **把公司 Word 模板里的固定文字整段粘进去**（标题、说明、编号、"以上情况属实"这类套话），
   在需要填数据的地方写占位符，**照第 4 节的表抄名字**。
3. 表格按 3.2 节那个写法（markdown 表头 + `{{#each}}` 行）。
4. 公司要求、第 4 节没给的字段：**照常写占位符**，生成时会在"待补"清单里出现；把清单发我，我来接数据源或确认人工填。
5. Word 原件**先不用给我**。等导出格式定了（比如必须交 .docx），再拿最终定稿的 md 模板一对一映射到 Word —— 那时模板已经稳定，改一次就够。
6. 改完模板**不需要重启**（每次生成时现读）；但**第一次启用模板读取需要重启一次 DSH**
   （`readTemplate` / `writeTemplate` 是宿主启动时注册的 op）。宿主没重启时界面上会明说这一点。

---

## 7. 代码改动落点（**已实现部分标 ✅**）

| 位置 | 改动 |
| --- | --- |
| `lib/client.js` | ✅ `BUILTIN_DOCS`（内置默认模板）、`renderTemplate` / `collectRefs` / `scopeKeys`（纯函数）、`designDocScope`、`parseDraftSections`、`taskNo`、`docHeader` / `designDocFile`；方案页新增接口清单 / 页面清单 / 方案文档三个区块；中英文案 |
| `lib/client.js` `designPrompt` / `STAGE_RULES` | ✅ 方案阶段"先出接口/页面清单，再写正文"；`STAGE_RULES.design`；清单的 JSON 形状由 `designListShapeText` 从声明表生成 |
| `lib/client.js` `DESIGN_LISTS` | ✅ 两张清单的声明表（列名 / 宽度 / 占位符），**刻意不并进 `STAGE_BLOCKS`**（那张表决定阶段完成判定） |
| `index.js` | ✅ 新增 `readTemplate` / `writeTemplate` 两个 op（工作台级 `templates/<阶段>/`，都在 `WORKSPACE_OPS` 里带 sessionId；写侧拒绝覆盖）。**需要重启一次宿主** |
| `tools/verify.mjs` | ✅ `[34]` 共 68 条：引擎行为、四类语法错误、**模板↔scope 双向字段契约**、清单规范化与落盘形状、生成头、渲染冒烟，以及宿主侧真跑一遍模板读写（含 not-found / 拒绝覆盖 / 阶段白名单 / `..` 越界） |
| `docs/storage-format.md` | ✅ `apis.json` / `pages.json` / `templates/<阶段>/` / 占位符语法 / 生成物与生成头 |
| `CHANGELOG.md`、`README.md`、`README.zh.md`、`README.i18n.yaml` | ✅ 条目、功能段、断言数（548 → 624）、双语哈希 |

---

## 8. 分期

| 期 | 内容 | 状态 |
| --- | --- | --- |
| **P0a** | 模板引擎 + 方案文档的默认模板 + **方案文档**生成 | ✅ 已落地 |
| **P0b** | `apis.json` / `pages.json` 两张清单 + 方案提示词收紧 | ✅ 已落地 |
| **P0c** | **自测报告**（开发阶段）+ `selftest.meta.json` + 结论自动判定 | 待做（等 `Pipeline/开发/` 有真实数据再写模板） |
| **P0d** | **提版文档**（含 `release.gaps` 对不齐清单） | 待做 |
| **P1** | 模板语法错误的**页面内**提示、待补字段清单可点击定位 | 待做 |
| **P1（本轮复查新增）** | **模板读取失败只有 `unknown-op` 会告诉用户**：`not-found` / `not-file` / `too-large` 都静默回落到内置模板（`readTemplateOrNull` 只对 `unknown-op` 置 `unsupported`）。一个 2 MB 的模板文件、或一个名叫 `方案文档.md` 的目录，都会让"我改的模板没生效"变成哑的 —— 与第 3.1 节自己定的原则冲突，应该照 `unknown-op` 那样把原因显示出来 | 待做 |

> P0c / P0d 的引擎与字段契约机制已经就绪；这两份文档的模板要等有真实数据再定形状 ——
> 没有数据就写模板，写出来的只是对形状的想象。

---

## 9. 我这样默认了（不同意就说）

1. **方案文档正文按小节抽取**（`draft.md` 的 `## ` 小节），`{{design.draft}}` 整篇也保留 ——
   现有那份 `draft.md` 用的是 `###` 小节，所以它会走"整篇嵌入"这条分支。
2. **生成物文件名**：`方案文档.md`（与 `汇总.md`、`draft.md` 并列，不覆盖任何现有文件）。
3. **自测报告的"环境/版本"用小表单输入**并缓存（P0c）。
4. **模板放工作台根**（一套共用），走宿主 op 读写 → **需要重启一次 DSH**。

