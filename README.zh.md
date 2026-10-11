# 需求执行工作台 — Requirements Execution Workbench

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 客户端
插件：在会话头部的 **对话轨迹** 页签右边加一个 **需求执行工作台** 页签，内部是
`需求 → 方案 → 开发 → 测试 → 提版` 五阶段管线。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#离线安装)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-web%20client%20plugin-informational.svg)](#原理一个页签是怎么出现的)

[English](README.md) · **简体中文**

---

## 这是什么

一个长在 DSH Web GUI 里的**需求执行工作台**。它让需求走完五个阶段的管线，并把
所有产物以**纯文件**形式落在工作区里 —— 因此状态可 diff、可评审、可经 git 共享。

- **需求** —— 并行多个需求，编号按 `XQ<年月日>-<序号>` 生成。上传 `.docx` 后**在浏览器里**
  解析出正文（宿主不需要任何依赖），逐版本留存、可与上一版做行级对比。
  **但页面不给你看那堆正文**：导入完成会立刻把文档交给当前对话里的 AI，由它读一遍并产出
  分析 —— 这份需求到底要做什么、动到哪些系统和数据、可执行粒度的功能点、最容易出问题的
  地方、以及文档**没说清楚**的问题 —— 写进 `Pipeline/需求/analysis/<版本>.md`，
  页面上显示的就是这份分析。
  **功能点会自动填好，并按需求分块显示成树**：同一次分析还写一份
  `analysis/<版本>.points.json`，工作台读它把功能点并进需求页（同名算同一条，重复分析不会翻倍）。
  这次分析**优先使用随包分发的 skill `requirement-doc-reader`**（插件加载时投放到
  `$DSH_HOME/skills/`）：它写清了需求文档该怎么读 —— 怎么判断一份 Word 是「装着多系统、
  多处修订记录表」还是单一文档、怎么按修订记录表里那一行声明的变更底色只抽**本次这一条
  需求**的变更、怎么区分「新增功能」（整个功能块同色）与「变更功能」（只有部分带底色，
  无底色即工程里已实现的原功能）、以及功能点该写到什么粒度。它是**软依赖**：加载不到就
  退回原来的通用指令，但 AI 被要求**在回报里明说「本次没有用上 skill」** —— 免得"没用上"
  这件事静默发生。投放位置固定，遇到用户手写的同名 skill 一律让路，不覆盖。
  每条功能点带一个**需求分块**（`group`，取自文档自己的模块结构），页面按它显示成两级树
  —— 分块 → 功能点 —— 因为上百行平铺在一屏里，你既看不出自己在看哪一块，也看不出有没有
  整块漏搬。分块可折叠、可改名（块内功能点跟着换）、可以直接在块下加一条。
  **两处的分块下拉不一样**：功能点**行**上那个只列**已经建好的分块** —— 它回答的是"把这条点
  归到哪一块"，不是"造一个新分类"；新建分块的入口在底部的**新增区**，那个下拉最后一项是
  「+ 新分块」，选中它会在**分块下拉与分派人下拉之间**长出一个文本框，填好名字点【新增功能点】
  —— 分块和功能点一起建出来（不会留下"有块没有点"的空块）。两个下拉都带一个**空的隐藏占位项**：
  没有它的话，一块都还没建时浏览器会把「+ 新分块」当成当前值显示出来，而点它又不产生任何变化
  （这是"新分块加不了"的真因）。分析里没写分块、
  名字里也看不出模块的会落进「未分组」，它固定排在最后，并说明怎么把它们归位。
  每个版本行都有自己的【AI 分析】按钮（已有分析时变成【继续优化】—— 指令要求它在现有内容
  上继续改，不是从零重写），以及一个【删除】—— 原件、正文、这一版的分析**一起删**
  （功能点保留：它们可能已经派了人、写了方案）。点某一版的版本号，下面显示的就是**那一版**
  的分析。想看原文点【查看原文】展开。原文一个字都没丢，只是不再排在分析前面。
  澄清问答另有一份记录。
- **版本对比（一次选两版）** —— 同时给出**文档差异**和**分析差异**，并顺手做一次合理性判断：
  版本号跳了一大截而正文几乎没动，多半是**这一版上传错了文件**（或者同一份传了两次）；
  正文改了很多而分析几乎没动，说明分析可能是拿旧正文做的。两个阈值都刻意保守 ——
  误报一次，人就再也不看这个提示了。
- **不绑定需求与会话** —— 所有 AI 动作（文档分析、出方案、方案汇总、各阶段产物）都发到
  **你当前正在用的那个会话**里。插件不会替你建会话，也不会把你切到别的会话去：
  在哪个会话里工作是你的决定，不是需求的属性。需求之间本来也不会互相污染 ——
  每条需求的产物都在自己的目录里，插件发出去的指令写的都是绝对路径。
- **每个模块一个子 agent** —— 需求 / 方案 / 开发 / 测试 / 提版 的指令都要求 AI 在**只做本模块
  的子 agent**里完成，上游内容只读。这五个模块的产物互相咬合（方案读需求、开发读方案……），
  一个什么都看的上下文很容易「顺手」改到上游文件，而那种改动事后极难追查。
- **关键时间** —— 提版 / 测试封板 / 上线三个日期，顶部内容条有实时倒计时；
  先后顺序受约束（`提版 < 封板 < 上线`）。
- **开发人员** —— 一个需求支持多人。每人是一个标签，且**方案 / 开发 / 测试 是按人分开的
  管线**，而**需求与提版是公共管线**。需求分析的功能点可以分派到人。
  名单里的第一个人是**主导者**，可变更 —— 但只有现任主导者能把位置交出去。
- **两套编辑权** —— **每个人自己的方案只有本人能改**，别人打开是只读的；
  **方案汇总只有主导者能改**，其他人只能看。两者判定依据不同（前者看「这是不是我的
  管线」，后者看「我是不是主导者」），所以是两条独立规则，不是一个开关。
- **方案（按人）** —— 方案正文 / 影响面分析 / 任务拆分 / **接口清单** / **页面清单** / **方案文档**
  依次落在 `Pipeline/方案/<开发人员>/` 下。**正文由 AI 读需求后出稿**：点【让 AI 出方案】会把一段
  写死了目标路径与产物形状的指令送进当前对话，由对话里的 AI 用它自己的文件工具写盘；
  写完页面自动刷新，你直接在页面上改，也可以留存版本快照并与最近一版对比。
  **接口清单与页面清单是结构化的表格**（可逐行增删改）—— 现实里的方案就是回答
  "后端要改或新增哪些接口、前端要改或新增哪些页面"，写成一篇长文之后人改不动、下游也引用不了。
  两张清单也是 AI 的写作顺序：**先出清单，再写正文**（正文是清单的叙述版）。
- **方案文档（按模板生成）** —— 点【生成方案文档】把清单、正文、影响面、任务按模板渲染成一份
  **能交出去的文档**：**先生成、后落盘**（缺字段会当场列出来，写下去就晚了），也可以【复制全文】
  直接粘进流程系统。模板放在工作台根 `templates/<阶段>/`（**一套全工作台共用**，不在需求文件夹里），
  找不到就用内置默认；界面上有【把内置模板写到 templates/方案/】，内网拿到手就能在正确的占位符上
  改成公司模板。占位符只有三种（`{{字段}}` / `{{#each}}` / `{{#if}}`），刻意不支持嵌套循环；
  取不到值的字段渲染成「（待补：路径）」并列成清单 —— **缺内容必须看得见**。
  生成物带一行生成头（用了哪份模板、什么时候、读了哪些数据），重生成直接覆盖。
- **方案汇总（共享一份）** —— 协同开始时主导者要先知道**整体开发概念**。点【汇总方案】
  让 AI 读**所有人**的方案，产出一份横向对照：各人对照表、分歧点（点名是谁与谁）、
  **覆盖缺口**（谁还没写方案）、依赖顺序、投入合计、风险汇总。页面另外用纯数据列出每个人
  的任务数与人天 —— 即使汇总还没生成，缺口也一眼可见。**汇总只有主导者能编辑**，
  其他人打开是只读的。
- **开发 / 测试 / 提版（三个阶段页）** —— 每个阶段三块产物，与管线上的三个菜单项一一对应：
  **开发**＝变更清单 / 提交记录 / 开发自测；**测试**＝测试用例 / 执行结果 / 缺陷跟踪；
  **提版**＝版本号 / 变更日志 / 发布说明。开发与测试按人分开（只有本人能改），提版是公共
  管线。每一页都能点【让 AI 写这一阶段】—— AI 读完上游阶段的产物再写这三块；开发页另有
  每个任务一条的【执行】、测试页每条用例也有一条【执行】（见下两条）。
  **这三个页面不是三段各写一遍的代码**，而是同一张声明表加同一个渲染器；加阶段或加一块
  只是往表里加一行，页面、落盘、状态推导、给 AI 的指令会同时跟上。
- **开发页的「我的任务」** —— 把方案里属于你的任务列出来，并显示每一条的执行情况。
  任务的定义只有一份（在方案的 `tasks.json` 里），**执行情况是从开发页自己的变更清单派生的**：
  一条变更都没挂 = 未开工，挂了没勾完 = 进行中，全勾完 = 已完成。两个页面于是各管一头 ——
  方案页管「做什么」，开发页管「做了什么」，中间不存在两份状态对不上的可能。
  除了「还没开工的任务」，它还会点名**一个任务都没有的功能点** —— 那种活在开发页上
  根本不会出现，最容易漏掉。这两组名单是**带计数的标签组**，不是一句用顿号串起来的长句：
  33 个任务名连成一句话就是一堵墙，谁也不会去读它。
  每行任务后面有一个**【执行】**：点开是这条指令的全文（要读哪些方案文件、这次只做哪一个任务、
  变更清单里 `taskId` 要填什么），**可以先改再发**。先弹窗而不是点一下就发，是因为指令一发出
  AI 就开始动代码、那一步收不回来。执行只给自己那条管线显示。
- **测试页每条用例后面也有【执行】**（挨在【删除】前面）—— 让 AI 去跑这一条，并把结果**落回文件**：
  这一条的「结果」改成通过 / 失败并写清实际验了什么、往「执行结果」追加一条记录、失败时往
  「缺陷跟踪」记一条。只有**能被跑一遍**的行才有这个按钮（执行记录、缺陷记录没有），哪些块有由
  `STAGE_BLOCKS` 里的 `execute` 一行声明，渲染器不认识阶段名。
  **跑不了就说跑不了**：没有工程、起不了服务时指令要求 AI 如实说清缺什么、把结果留在「未做」——
  编一个「通过」是最坏的结果，它会把一条根本没验过的用例变成绿色证据，而页面上完全看不出来。
  用例没有 id，所以指令里用「用例名 + 预期 + 第几条」三者一起定位，对不上或重名时要求它停下来问。
- **切走再切回来不重读** —— 读到的内容**活过组件卸载**（一层只在本机内存里的小缓存），
  所以反复打开各个页块时直接就有内容，再在后台读一次确认。保存之后也不会闪白：页面保留
  上一屏，等新数据到了再替换。实测每次 RPC 只要 1.5–3 ms、打开页签 16 个请求合计不到
  40 ms，所以「慢」几乎总是加载状态造成的观感，而不是真的在等磁盘。
  任何**写操作都会清空这个缓存** —— 宁可多读一次，也不拿旧内容骗人；
  换需求 / 换人时同样会清空，那时旧数据是别人的。
- **状态不说谎** —— 管线徽标来自真实产物：变更清单全部勾完且自测全通过，开发才算「已审核」；
  用例全通过且没有未关闭的缺陷，测试才算；版本号与发布说明都填了，提版才算。
  一份**空的**方案即使被点了「定稿」也不会变绿。
- **按身份只读** —— 首次打开输入一次姓名；只有自己的管线可改，别人的一律只读。
- **逾期处理** —— 标记完成且已过上线日期的需求会触发铃铛提醒，若三天内未处理则自动归档。
  归档是往 `requirement.json` 写 `archivedAt`，**目录原地不动**；已归档需求仍可从可搜索的
  下拉框访问，也可以恢复。
- **删除需求（不可逆，要再点一次确认）** —— 需求列表的【更多操作】里。它和归档是两件事：
  归档只是一个标记、随时能恢复，删除则是**整个需求文件夹一起删**（文档原件、解析出的正文、
  每一版分析、功能点、方案、测试记录都在里面，删掉之后没有任何地方还留着副本）。
  所以它在菜单里用错误色单独占一个位置，点了之后**整条菜单换成确认屏**（原来那些按钮此刻
  根本不在 DOM 里，点不到），确认屏上点名编号与标题、写明代价；失败时错误留在原地不关屏。

所有内容都在工作区的 `docs/requirements/` 下 —— 目录结构与"协同开发不冲突"的规则见
[`docs/storage-format.md`](docs/storage-format.md)。

## 特点

- **零依赖**。没有 `dependencies`、没有 `devDependencies`、没有 lockfile、
  没有 `node_modules`。浏览器半边是手写的，唯一 require 的模块 `react` 由 DSH 外壳提供。
- **完全离线安装**。不需要 npm、不需要 pnpm、不访问 registry。见
  [离线安装](#离线安装)。
- **无构建步骤**。改 `lib/client.js` 后宿主约半秒内热替换 —— 不用重启，不用刷新页面。
- **自带验证**。`npm test` 跑 624 条断言 —— bundle 形态、slot 注册、文案键完整性、
  组件渲染冒烟、主题 token 有效性、各条业务规则、离线就绪性 —— 再加一轮端到端
  安装/卸载测试。不需要 DSH、浏览器或网络。
- **面向协同的存储**。一个可独立编辑的东西一个文件，因此两人同时改同一个需求不会在 git 里撞车。
- **双语**（`zh` / `en`），样式全部来自 DSH 设计 token，亮色/暗色主题都正常。

## 环境要求

| | |
|---|---|
| DSH | `0.1.5-rc.1` 或更新，且已初始化 `web` profile |
| Node.js | `>= 20`（只给安装器和测试脚本用，运行时不依赖 Node） |
| 操作系统 | Windows / macOS / Linux（安装器是跨平台 Node 脚本） |

插件只用到 `react`，而它由 DSH Web 外壳通过模块表在运行时提供——这就是
「什么都不用下载」的原因。

---

## 安装

### 离线安装

这是给隔离网络的机器用的路径，也是本项目「零依赖」的根本原因。
**安装过程中不会发起任何网络请求。**

**在有源码的机器上**（git 检出，或下载的 release 源码包）先构建离线产物：

```bash
npm run pack:offline
```

确定性地生成：

```
dist/dsh-client-ui-workbench-0.1.0.tgz
dist/SHA256SUMS.txt
```

#### DSH 本身是用 setup.exe 装的？

那台机器上未必有 `node` 在 PATH 上，而 `tools/install.mjs` 需要它。
这时用 `tools/install.ps1` —— **纯 Windows PowerShell，不需要 Node，也不需要 npm**：

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1 -DryRun   # 先看计划，不写文件
powershell -ExecutionPolicy Bypass -File tools\install.ps1           # 真的装
```

它做的是同一件事：定位 `$DSH_HOME`（`-DshHome` > `$env:DSH_HOME` > `~\.dsh`）、
找到含 `cordis.patch.yml` 的那个 profile（默认 `web`，找不到就自动在 `profiles\` 下找）、
把包拷进 `profiles\node_modules\`、**备份补丁层**后再追加一行宿主行；已经装过就不重复追加。
**它从不删除任何东西。**

**关键一点**：插件只装在 `$DSH_HOME` 下，**不碰 DSH 自己的程序目录** ——
所以 DSH 是 exe 装的、npm 装的还是别的装法，都不影响。`$DSH_HOME` 默认是
`%USERPROFILE%\.dsh`（除非设了 `DSH_HOME` 环境变量）。

参数：`-DshHome <path>`、`-Profile <name>`、`-Source <解包目录>`、`-DryRun`。

**把 `.tgz` 拷到目标机器后**（那台机器上没有源码树，所以**先解包** —— 安装器本身就在包里）：

```bash
# 校验完整性
sha256sum --check SHA256SUMS.txt        # Windows: certutil -hashfile <file> SHA256

# 解包，然后进到 package/
tar -xzf dsh-client-ui-workbench-0.1.0.tgz
cd package

# 可选但推荐：先在本地跑一遍契约自检（不需要 DSH、不需要浏览器、不需要网络）
node tools/verify.mjs

# 安装 —— 默认从当前目录装，无需网络、无需 npm
node tools/install.mjs
```

**★ 第一次装到一台机器上时，必须重启一次 DSH。**
宿主半边（`index.js`）是**开机时**加载的，`/api/rpc/workbench` 这条路由由它注册。
不重启的话页签会出现，但每次读写都会失败（HTTP 404）—— **看起来像装坏了，其实只差一次重启**。

| DSH 是怎么装的 | 怎么重启 |
|---|---|
| **setup.exe** | 从托盘图标 / 开始菜单**退出应用，再启动一次**（简单、可靠） |
| **npm（有 `dsh` 命令）** | `tools\restart-host.ps1` —— 它会自己找监听端口所属的 pid |

`restart-host.ps1` **只适用于 npm 装的 DSH**。在 exe 装的机器上它找不到 `dsh` 入口，
会明确告诉你改用「退出再启动」，而不是静默失败。

重启后浏览器刷新 `http://127.0.0.1:3080`：会话头部页签应出现「需求执行工作台」，排在「轨迹」右边。
之后再改 `lib/client.js` 就不需要重启了（宿主约半秒内热替换）。

安装器是约 400 行纯 Node 代码，只用内置模块（`node:fs`、`node:zlib`，以及
`tools/lib/tar.mjs` 里一个极简 ustar 读写器）。它**从不调用** `npm`、`pnpm` 或
`dsh plugin`。

每个 [GitHub Release](https://github.com/OWNER/dsh-client-ui-workbench/releases)
都附带预构建产物——离线用户直接从那里下载 `.tgz`。

常用参数：

```bash
node tools/install.mjs --dry-run            # 只打印计划，不写任何文件
node tools/install.mjs --skip-verify        # 不探测 localhost 启动图
node tools/install.mjs --skip-contract      # 不跑契约自检
node tools/install.mjs --tarball ../dsh-client-ui-workbench-0.1.0.tgz   # 直接从归档读（不必先解包）
node tools/install.mjs --dsh-home /path/.dsh --profile web
node tools/install.mjs --help
```

### 从源码目录安装

```bash
git clone https://github.com/OWNER/dsh-client-ui-workbench.git
cd dsh-client-ui-workbench
node tools/install.mjs
```

Windows 上 `.\deploy.ps1` 是同一个脚本的薄封装。

### 安装器做了什么

1. 跑离线契约自检（`tools/verify.mjs`），不通过就中止。
2. 把包拷进 `$DSH_HOME/profiles/node_modules/dsh-client-ui-workbench/`。
3. 备份 profile 的 `cordis.patch.yml`，再追加一段带哨兵注释的 `insert:` 块。
4. 探测 `http://127.0.0.1:3080`，确认宿主已把插件编进浏览器启动图。
   宿主没在跑只算警告，不算失败。

**顺序很重要**：先放包，再改补丁层。反过来 loader 会看到一行指向不存在的包。

---

## 验证安装

三级验证，从最便宜的开始，都不需要点浏览器。

**第 1 级 · 契约自检**（不需要 DSH、不需要浏览器、不联网、不写文件）：

```bash
npm run verify
```

**第 2 级 · 宿主已把插件编进 `window.__DSH_BOOT__`**：

```bash
node tools/probe.mjs
```

退出码 `0` = 在启动图里，`1` = 宿主在跑但没有这个 entry，`2` = 连不上宿主。

这个探测是**鉴权感知**的。如果 Web UI 挂在鉴权插件后面（例如 `dsh-webui-auth`），
未认证请求的链路是 `GET / → 302 /?token=… → 303 / + Set-Cookie`，而朴素的
`fetch(url, { redirect: 'follow' })` **不保存 cookie**，于是会在这个环里一直转到抛
`redirect count exceeded` —— 看起来像「宿主挂了」，实际含义是「你没登录」。
探测脚本自带 cookie jar，两种情况都能用。

条目形如：

```json
{"id":"dsh-client-ui-workbench","url":"/plugins/??dsh-client-ui-workbench/client.js&rev=<nonce>-<n>","rev":"<nonce>-<n>"}
```

**第 3 级 · bundle 真的能取到**：

```bash
curl -sI 'http://127.0.0.1:3080/plugins/??dsh-client-ui-workbench/client.js&rev=<上面拿到的 rev>'
# 期望：200，content-type: text/javascript; charset=utf-8
```

最后打开 `http://127.0.0.1:3080` 按 **F5**，头部应显示
`对话 | 轨迹 | 需求执行工作台`。

---

## 卸载

```bash
node tools/uninstall.mjs
```

会移除补丁层里那段托管块和包目录。幂等，而且**是外科式移除**——同一补丁层里
别的插件的行不受影响。支持 `--dry-run`；`--keep-patch` 只删包目录、保留补丁行。

---

## 管线

五个阶段里两个是公共的，三个是按人的：

```
需求 Requirement   把原始诉求收敛为可验收的需求条目      ┐ 公共
提版 Release       整理变更、版本号与发布说明            ┘
方案 Design        确定技术方案、影响面与改动清单        ┐
开发 Develop       落地实现，保持可回滚的提交粒度        │ 按人
测试 Test          开发者自测与调试                      ┘
```

- **公共阶段** —— `需求` 与 `提版` 属于整个需求。
- **按人阶段** —— `方案`、`开发`、`测试` 为名单里每位开发人员各记一条。
  「开发人员」方框右上角的下拉框选择当前查看谁的管线，管线显示以它为准。
- **只有自己的可改。** 首次打开输入一次姓名，存在
  `$DSH_HOME/workbench/identity.json`；查看别人的管线是只读的。
- **「测试」指开发者自测**，不是正式 QA —— 正式测试在提版后走专门的流程系统。

阶段状态来自 `lib/client.js` 的 `deriveStageStatus(meta, developer, stageStates)`。
它只负责**拼装**，判定由 `designStageStatus()` / `stageVerdict()` 负责 ——
所以它不需要知道任何一种产物的形状，产物怎么改它都不用动。

**五个阶段现在都有真实状态**：读得到产物就以产物为准（有内容 = 进行中，满足该阶段的完成
条件 = 已审核），读不到才回退。唯一的占位规则只剩下「方案还没有任何产物时，分到功能点即
算进行中」。

### 方案页：AI 出稿，人改稿

方案的主体不该手搓。这一页的闭环是：

1. 点【让 AI 出方案】。插件把一段指令送进**当前对话** —— 里面写死了需求编号、
   要读的需求文件、**五个产物**的落盘路径，以及**四个 JSON** 的字段形状；
2. 对话里的 AI 用它**自己的文件工具**读需求、写文件。插件不调用任何模型，
   也没有自己的 API key —— 它只是把活交给正在跟你说话的那个 AI；
3. 会话从「执行中」回到「空闲」时页面**自动重读**一次，稿子就出现了（不做轮询：
   AI 写盘期间读到的半成品比晚几秒看到更容易误导人）;
4. 你在页面上直接改、保存、留存版本快照，或与最近一版做行级对比。
   任务拆分可以一键从「分派给你的功能点」生成骨架。

用的是平台通道 `ctx.sessions.scope(id).conversation.send(text)`。送不出去时（比如空白
会话还没有会话作用域）会**把指令原文摆出来让你自己粘贴**，功能不会因此失效。

#### 两张变更清单，和生成出来的可交付文档

现实里方案要回答的是**「后端要新增或修改哪些接口、前端要新增或修改哪些页面」**。
这天然是**两张可以逐行改的清单**，不是一篇文章 —— 混在长文里，人改不动（改一个接口要
去正文里找）、AI 只能整篇重写、下游也引用不了：

- `apis.json` —— 来源功能点 · 任务号 · 接口名 · 方法 · 路径 · 新增/修改 · 入参 · 出参 · 备注
- `pages.json` —— 来源功能点 · 任务号 · 页面名 · 路由 · 新增/修改 · 页面区块 · 关键交互 · 备注

两块复用与其它阶段同一套行表格。两个刻意的选择：**`change` 是自由文本而不是下拉**
（下拉的默认值会把「还没想清楚」变成一个具体态度，那是替用户编数据）；
**「（路径待确认）」是合法值**（没有可改的既有工程时，它就是老实答案，
编一个像真的路径比留空更糟）。

这两张清单就是【生成方案文档】的数据来源。它是刻意不合并的三步：
**生成 → 预览（缺哪些字段当场列出来）→ 复制全文 *或* 写入文件**。
模板在需求之上的一层：`<工作区>/docs/requirements/templates/方案/方案文档.md`，
**一套全工作台共用**。完整的占位符契约与模板语法见
[`docs/document-generation-plan.md`](docs/document-generation-plan.md)。

**汇总方案**是同一条通道的另一种用法，区别在读者：出稿是给我自己写方案，汇总是给主导者
看全局。所以那段指令要的是横向对照，并且明确**禁止 AI 修改任何人的方案文件** ——
"顺手把别人的稿子也改了"正是这个动作最危险的失败方式。汇总的结果是一份**共享的**
`Pipeline/方案/汇总.md`：它在页面上永远显示（包括正在看别人管线的时候），还能就地编辑。
写者只有主导者一个人 —— 一份文档一个 owner，这正是协作规则允许的那种共享。

## 存储与协同

所有状态都是 `<工作区>/docs/requirements/` 下的纯文件：

```
<需求编号>/
├── requirement.json              共享标量（标题、状态、三个日期、开发人员）
├── feature-points/<id>.json      一个功能点一个文件
├── clarifications/<id>.json       一条问答一个文件
├── documents/<版本>.json          一条版本记录一个文件
├── pipelines/<开发人员>.json      每人一份
└── Pipeline/                     管线相关的一切
    ├── 需求/{source,parsed,analysis}/
    │                             原件 .docx · 解析出的正文 · 一版一份的 AI 分析（.md + .points.json）
    ├── 方案/汇总.md               共享一份，写者是主导者
    ├── 方案/<开发人员>/           draft.md · versions/ · impact.json · tasks.json
    │                              · apis.json · pages.json（两张变更清单）
    │                              · 方案文档.md（生成物，不要手改）
    ├── 开发/<开发人员>/           changes.json · commits.json · selftest.json
    ├── 测试/<开发人员>/           cases.json · runs.json · defects.json
    └── 提版/                      release.json · changelog.md · notes.md
```

文档模板**不按需求分**——一套服务整个工作台，所以放在工作台根：
`<工作区>/docs/requirements/templates/<阶段>/`。见
[`docs/document-generation-plan.md`](docs/document-generation-plan.md)。

让它对并发 git 安全的规则只有一条：

> **同一份数据只能由一个人写；不同人写的东西必须落在不同文件。**

git 的冲突判定是「两个分支改了同一个文件的同一处」。满足上面这条，同一个需求就不需要
任何锁、合并工具或自定义 merge driver。**反过来同样重要**：凡是「换个人打开就该不一样」
的东西，都不能放在这个目录里 —— 身份和逾期提醒的计时存在 `$DSH_HOME`，
正在看谁的管线存在浏览器本地。

### 逾期提醒按人分开

「谁先注意到这条需求逾期了」不是需求的事实，是**你**的事实。所以提醒的登记时间与已读
状态存在 `$DSH_HOME/workbench/notices.json`，和身份放在一起，两者都是**写一次、
永不覆盖**。放进共享文件的话，每个人第一次打开工作台都会去改同一行 —— 只要有两个人
同一天打开就是一次冲突。

首次看到时仍会**继承共享文件里的旧计时**，所以换个人打开不会把 3 天窗口重置。

### 归档是标记，不是搬家

归档往 `requirement.json` 写 `archivedAt`，**目录永不移动**。这是刻意的，一次消掉三个问题：

- git 不存 rename，搬目录会被记成「一批删除 + 一批新增」，`git log -- <路径>` 从此接不上；
- 甲归档的同时乙在改目录里的文件，会撞成 `CONFLICT (modify/delete)` —— 这是唯一无法靠
  约定避免的硬冲突。改成标记后两人改的是不相交的文件，merge 干净；
- Windows 上只要有人用 Word 开着目录里的 `.docx`、或杀软正在扫描，`rename` 就抛
  `EPERM`/`EBUSY`，归档当场失败。

随之而来三条规则：`archivedAt` 非空即已归档；它**写一次就不覆盖**（否则每打开一次工作台
就会把所有已归档需求的时间戳重刷一遍）；`requirement.json` 缺失或损坏一律**当活跃**处理
—— 宁可多显示，也不能静默吞掉一条需求。

数据是用旧版本归档的（`_history/`）？跑一次 `node tools/migrate-history.mjs` 迁移
（默认预演，加 `--apply` 才动磁盘）。

逐字段的冲突分析、目标格式与迁移方案见
[`docs/storage-format.md`](docs/storage-format.md)。其中
`feature-points` / `clarifications` / `documents` 由数组改为目录的迁移**尚未实施**。

## 原理：一个页签是怎么出现的

### 这里的宿主半边不是空实现

大多数客户端 UI 插件的宿主半边是空的 `apply()`。这个不是：**浏览器读不到磁盘**，
而工作台本质上就是"文件之上的一层视图"。所以宿主半边注册了一个精确的 HTTP 路由，
并拥有全部文件读写：

```
POST /api/rpc/workbench
{ type: 'client-request', rpcId, method: 'rpc/workbench',
  payload: { op, sessionId?, args? } }
```

试过并被否掉的两条路（都记在 `index.js` 里）：

- **Typert Remote**（`@Remote` 命名空间）无法 out-of-tree 添加：客户端半边挂的是写死的
  静态 import 表，而且 `/api` 的 rpc 拦截器是独占的、已被 gateway 占走。
- **自建顶层前缀**（比如 `/workbench`）**不受鉴权保护**：`dsh-webui-auth` 把
  `PROTECTED_PREFIXES` 写死为 `['/api', '/plugins']`。

挂在 `/api` 下的**精确**路由在网关拦截器**之前**匹配，并自动继承 Host/Origin 围栏与
浏览器登录态 —— 所以插件自身不做任何鉴权。客户端能寻址的每个路径都被限制在一个
需求文件夹内。

DSH 客户端插件是**双面包**（dual-face package）：一个 npm 包，一个 Node 半边、
一个浏览器半边。

```
① 包位于 $DSH_HOME/profiles/node_modules/<name>/
        │
        │  cordis.patch.yml 里一行宿主行把它挂上 loader
        ▼
② loader 加载宿主半边 index.js（本插件是空 apply()）
        │
        │  @deepseek-ai/dsh-client-modules 扫描 loader 的「行」
        │  —— 它不扫文件系统
        ▼
③ 发现 dsh.client.platform === "web"
  且 exports["./client"] → lib/client.js
        │
        │  把 bundle 字节编进启动图
        ▼
④ window.__DSH_BOOT__ = { entries: [ { id, url: "/plugins/??<pkg>/client.js&rev=...", ... } ] }
        │
        │  浏览器为每个 entry 执行 loader.create({ name })
        ▼
⑤ 浏览器用 <script async src=...> 拉 bundle；脚本执行只做一件事：
   window.__ModuleLoader__.load({ id, factory })
        │
        │  factory 首次 import 时物化，返回 { apply, inject }
        ▼
⑥ cordis 在浏览器里跑 apply(ctx)
        │
        │  ctx.slots.inject('conversation.view', () => ctx.slots.register({...}, View))
        ▼
⑦ ui-conversation 把 slot 名册投影成页签
   → 头部出现「需求执行工作台」
```

三个需要记住的结论：

1. **只把包放进 `node_modules` 不会生效**——必须有宿主行把它挂上 loader（第 ② 步）。
2. **宿主和浏览器是两个独立的 cordis 世界**。同一个包各有一个半边：`index.js` 是
   Node 半边（UI 插件通常是空的），`lib/client.js` 是浏览器半边（真正的 UI）。
3. **页签只由 `ctx.slots.register({ name: 'conversation.view', ... })` 产生**。
   `ctx.uiConversation.views.register(...)` 是另一套机制——它注册的是 Conversation
   *数据构建器*，不给页签。本插件不需要它。

---

## 契约（硬性约束）

以下都是针对 DSH `0.1.5-rc.2` 实测出来的硬约束。违反任意一条 = 白屏或静默不出现。
`npm run verify` 会逐条检查。

### `package.json`

```jsonc
{
  "name": "dsh-client-ui-workbench",   // ① 等于浏览器模块 id，必须逐字一致
  "type": "module",
  "main": "index.js",                  // ② 宿主半边；loader 行靠它解析
  "exports": {
    ".": "./index.js",
    "./client": { "default": "./lib/client.js" },  // ③ 浏览器半边；缺了会硬抛错
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",               // ④ 必须恰为 "web"，其它值会被静默忽略
      "inject": [ /* 包名，不是服务名 */ ]
    }
  }
}
```

### `index.js`（宿主半边）

通过 `ctx.connection.fetch.register()` 注册一个**精确**的
`/api/rpc/workbench` Fetch 路由，并在 `node:fs/promises` 之上实现全部 op：
目录布局、按需求编号寻址、文档与版本文件、归档/恢复、身份读写。

它需要 `inject = ['connection', 'sessions', 'sandboxPolicy']`，并且**绝不能导出普通对象
`Config`**。cordis 会执行 `Config["~standard"].validate(...)`，普通对象没有 `~standard`，
抛 `TypeError: Cannot read properties of undefined (reading 'validate')`，
导致**整棵插件树加载失败**，`dsh web` 跟着退出。需要配置就用
`@deepseek-ai/schemastery` 的 schema，或者干脆不导出 `Config`。

### `lib/client.js`（浏览器半边）

```js
window.__ModuleLoader__.load({
  id: 'dsh-client-ui-workbench',   // 必须等于包名
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    /* ... 所有副作用都在这里面 ... */
    exports.apply = apply;
    exports.inject = inject;       // cordis **服务名**，不是包名
    return module.exports;
  }
});
```

| 规则 | 违反后果 |
|---|---|
| 必须是 classic script——不能有顶层 `import`/`export`、不能顶层 await | 宿主用 `<script async src>` 加载，ESM 语法直接 SyntaxError |
| 顶层只调用 `load(...)`，副作用（含样式注入）全放 factory 内 | 脚本执行只注册；factory 懒物化、只跑一次 |
| `require()` 只能取基线模块表里的词，或 `dsh.client.external` 声明过且有供给方的包 | 否则 `require("...") missed the module table` |
| factory 必须返回 `apply`；`inject` 里每个服务都必须存在 | 服务缺失 → entry 停在 pending → `web boot: N entries did not activate` → **整个 GUI 白屏** |

**基线模块表**（DSH `0.1.5-rc.2` 实测，就这 9 个，白名单）：

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

本插件只 `require('react')`。

### 页签注册

```js
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'workbench',
  order: 20,                          // 升序：chat = 0，trajectory = 10
  locale: NS,
  label: () => t('view.workbench'),   // 用 thunk，语言切换才会刷新
}, WorkbenchView));
```

- **必须用 `slots.inject` 包一层**；直接 `register` 可能跑在声明方
  （`ui-conversation`）挂载之前。
- `conversation.view` 是 `list` + `session` 作用域。组件收到：
  - owner props：`viewRequest`、`openView(view, focus)`、`completeViewRequest()`
  - session 标准 props：`sessionId`、`useSession`、`useProjection`
  - global 标准 props：`useSessions`、`useSessionPendingInteraction`、`useWorkspaces`
  - 声明 `locale:` 才有 `t`；声明 `store:` 才有 `useStore`/`actions`；
    `inject:` 回调里的 `hooks` 会变成 `use<Name>`
- **页签数少于 2 时头部不渲染页签条**。本机已有 chat + trajectory = 2，
  所以第 3 个会出现。
- 新页签**不会被自动选中**，默认仍停在 chat。

---

## 扩展指南：往某个阶段加功能

唯一扩展点是 `lib/client.js` 的 `STAGES` 数组。按复杂度，四种落地方式：

### 1. 真面板，不需要后端

在 `WorkbenchView` 里加一个「选中的菜单」状态，按 `(stage.id, menu.id)` 分发：

```js
const menuState = react.useState(null);
const activeMenu = menuState[0];
// 渲染：activeMenu === null ? 菜单网格 : 具体面板
```

数据只在内存里，刷新即丢。适合先验证交互。

### 2. 按会话持久化，不需要后端

给注册项加 `store:`，用 `@deepseek-ai/dsh-client-store`（基线模块，可直接 require）：

```js
ctx.slots.register({
  name: 'conversation.view',
  id: 'workbench',
  order: 20,
  locale: NS,
  store: workbenchStore,          // 加了这行，组件才有 useStore / actions
  label: () => t('view.workbench'),
}, WorkbenchView);
```

组件会多出 `useStore(selector)` 和 `actions`。`persist` key 建议带命名空间
（如 `dsh.workbench`）。

### 3. 读当前会话既有数据，不需要后端

组件本来就拿得到会话状态：

```js
const running   = useSession((s) => s.running);
const openState = useSession((s) => s.openState);   // 'cold' | 'loading' | 'open' | 'error'
const queued    = useSession((s) => s.queue.length);
```

其它可用数据源（由别的插件提供，运行时存在，但类型上是有条件的）：
`useConversation`（会话装配快照）、`useInput` + `inputActions`（输入框：草稿/队列/提交）、
`useTrajectory`（轨迹数据，来自 `ui-trajectory`）、`useProjection`（宿主算好的投影值）。

想把「需求条目」和工具调用/待办关联起来，**从 `useProjection` 或 `useTrajectory` 取**
是最省事的路子——不需要自己写后端。

### 4. 真正读写数据，需要宿主侧能力

工作台要自己存需求条目、跨会话共享、或驱动 agent，就必须有宿主侧支持。三条路：

1. **写工作区文件的 custom tool**。加一个工具插件（`defineTool` +
   `ctx.tools.register`）读写 `requirements.json` 之类，工作台通过会话事件看到变化。
   **最省事，先走这条。**
2. **宿主 HTTP 路由**。宿主半边 `index.js` 里 `ctx.webServer.register(...)`，
   浏览器侧 `fetch` 调用。适合结构化 CRUD，注意 DSH 的鉴权前缀。
3. **发布 cordis 服务**。宿主半边 `ctx.provide('workbench', ...)`，行上加 `isolate`
   realm。最重量级，只有多方复用才值得。

### 跨页签跳转

owner props 里的 `openView` 可以跳页签（骨架里已演示）：

```js
openView('trajectory', '');   // 第二个参数是目标页签自己的「焦点标识」
```

反过来，`viewRequest` 让别的页签跳进工作台；处理完记得 `completeViewRequest()`。

---

## 开发

**改了哪半边，决定了改动怎么生效 —— 两者不一样。**

| 改动 | 生效方式 |
|---|---|
| `lib/client.js` | 宿主轮询 bundle，约半秒内热替换。不用重启、不用刷新。 |
| `index.js`、`package.json` | **必须重启 `dsh web`。** 模块热重载是 opt-in：`hmr` 行默认 `disabled: true`，而 `patchReload: live` 只重载**配置**，从不重载已 import 的模块。 |
| `cordis.patch.yml` 里的行 | 宿主 live 重载，不用重启（**重新引入一个曾被移除的 entry** 例外，见排错表）。 |
| **新增**一个客户端插件 | 页面的启动图在加载时定死——**必须 F5**。 |
| `index.js` 里**新增宿主 op** | 必须重启。op 是开机注册的，旧宿主只会回 `workbench/unknown-op`。 |

用 `tools/restart-host.ps1`（或 `tools/restart-host.cmd`），它会自己找监听端口所属的 pid。

做宿主半边时有个省事的路子：`node tools/rpc.mjs <op>` 能直接从命令行调用任意工作台 op，
**完全不用打开浏览器**就能验证文件通道。参数一律**走文件**（`--args-file`），别写内联：
PowerShell 会把引号吃掉。

不知道该看哪份文档？入口是 [`docs/README.md`](docs/README.md)。

```bash
npm run verify     # 契约验证——不需要 DSH、浏览器、网络，不写文件
npm run selftest   # 端到端离线安装/卸载，对着一个临时 DSH home 跑
npm test           # 两个都跑
```

`selftest` 会在临时目录里伪造一个 DSH home，把真实的安装器完整跑一遍：
打包 → 从归档安装 → 再装一次（幂等）→ 卸载 → 从目录安装 → DRY-RUN → 卸载。
其中特别断言了补丁层手术**不会误伤别的插件的行**。

### 迭代循环

改 UI 时的最小循环：

```bash
cp lib/client.js "$DSH_HOME/profiles/node_modules/dsh-client-ui-workbench/lib/client.js"
# 等约 1 秒，浏览器里已经是新的了
```

---

## 排错

| 症状 / 错误信息 | 原因 | 修法 |
|---|---|---|
| `dsh web` 启动即退出，日志有 `Cannot read properties of undefined (reading 'validate')` | 宿主半边导出了普通对象 `Config` | 删掉 `Config`，或改用 `schemastery` 的 schema |
| `client-modules: <pkg> declares dsh.client but exports no "./client" bundle` | `package.json` 缺 `exports["./client"]` | 补上 |
| `client-modules: <pkg> exports["./client"] must be a string or an object with a string default` | `exports["./client"]` 写法不对 | 用字符串或 `{ "default": "..." }` |
| 启动图里没有本包 | ① 没有宿主行 ② `platform` 不是 `"web"` ③ 行 disabled ④ 行加载失败 | 按这个顺序查，看宿主 stderr |
| 包在、补丁层内容也对，启动图里就是没有本插件 | 这个 entry 之前被移除过（例如刚跑完 `uninstall`），而那次补丁层写入没被 live 重载消费 | `tools/install.mjs` 会自动再触发一次重载并重试；若仍不行，重启 `dsh web` |
| `bundle ... loaded without registering "<id>" via __ModuleLoader__.load` | bundle 里的 `id` 与包名不一致 | 改成逐字一致 |
| `require("X") missed the module table` | require 了基线表之外的词且没声明 | 只用 9 个基线词；确有需要就加 `dsh.client.external` 并确认有供给方 |
| `web boot: N entries did not activate ... pending (waiting for service: ...)` → **白屏** | `inject` 里写了不存在的 cordis 服务名 | 只列确认存在的服务（本插件：`slots`、`locale`） |
| 页签不出现，但启动图里有 | slot 名写错，或没用 `slots.inject` 包一层 | 用 `conversation.view`；等声明后再 register |
| 页签位置不对 | `order` 值 | chat = 0，trajectory = 10，本插件 = 20 |
| 手工检查启动图时报 `fetch failed: redirect count exceeded` | Web UI 挂在鉴权插件后面；`fetch` 不保存 cookie，于是在 `GET / → 302 → 303 + Set-Cookie → GET /` 之间死循环 | 用 `node tools/probe.mjs`，它自带 cookie jar |
| `tools/install.mjs` 跑完了，新加的宿主功能却不生效 | `install.mjs` 只负责拷文件；loader 仍用着已经 import 过的宿主半边 | 重启 DSH（setup.exe 装的：退出应用再启动；npm 装的：`tools/restart-host.ps1`）。浏览器半边不需要重启。 |
| 装完刷新页面，**页签根本没出现** | 两种原因、修法相反：**装错了 home**（setup.exe 装的 DSH 最容易这样，它是装到 `%USERPROFILE%\.dsh` 而应用读别处）或**装对了但没被加载** | 跑 `node tools/doctor.mjs` —— 它把两种原因分开，并给出可直接复制执行的修复命令 |
| **新建需求成功，紧接着操作它却报 `requirement.json not found`** | 有调用没带 `sessionId`，读写便落到**回落的工作区根**而不是会话 cwd。开发机上这两条路径常相同，所以本地测不出来 | 已修：`callWorkbench` 统一给工作区 op 补 `sessionId`，补不上就直接抛错。只改客户端，**不需要重启宿主** |
| `tools/rpc.mjs` 报 `workbench/unknown-op: unknown op "…"` | 同上：正在跑的宿主半边比这个 op 更早 | 重启 `dsh web`。 |
| 脚本/命令输出中文乱码 | Windows PowerShell 5.1 无 BOM 时按 ANSI 读文件 | `.ps1` 存 UTF-8 **带 BOM**，或保持纯 ASCII（`deploy.ps1` 就是后者） |
| `dsh --profile web --dump-config` 报 `EPERM ... cordis.yml` | 那条命令会**写** `cordis.yml`，而且只打印宿主行、从不评估 `dsh.client` | 别用它验证客户端插件，用启动图检查 |

### 本机踩过的坑

- `_restart-dsh-web.ps1` 里的 `$oldPid` 是写死的过期值，直接用会跳过停旧进程、
  导致端口 3080 重复绑定。要用先更新 PID：
  ```powershell
  netstat -ano | Select-String '127.0.0.1:3080.*LISTENING'
  ```
  而且它在沙箱内会被杀（工具子进程在 kill-on-close job 里），需在沙箱外的终端启动。
- `profiles/<profile>/cordis.yml` **每次启动都会被重写**（它是 loader 的锚点）。
  永远不要往里写行，要写就写 `cordis.patch.yml`。
- `profiles/node_modules/` 下的 `@deepseek-ai/*` 大多是 junction，指向全局 npm 安装。
  自己的包要建成**物理目录**。
- `profiles/<profile>/node_modules/` 是 pnpm 的 hoisted 目录，手工放进去的目录会被下次
  `dsh plugin install` 当 extraneous 删掉。放 `profiles/node_modules/` 才安全。

---

## 仓库结构

```
.
├── package.json                  清单：dsh.client 声明 + exports["./client"]
├── index.js                      宿主半边：/api/rpc/workbench 路由 + 文件读写 op
├── lib/client.js                 浏览器半边 ★ 所有 UI 改动都在这里
├── cordis.patch.yml              包自带补丁层（仅作为 bundle 安装时用）
├── docs/                         开发文档（也会打进离线包 —— 两个 README 里的链接
│                                 解包后不能是死的）
│   ├── README.md                 索引：哪个问题看哪一份
│   ├── storage-format.md         协同存储规范：同一份数据只有一个写者
│   ├── document-generation-plan.md  模板 + 占位符契约 + 内网填写步骤
│   └── workflow-gap.md           决策记录：目标流程 vs. 工作台当时的样子
├── tools/
│   ├── verify.mjs                离线契约自检（624 条断言）
│   ├── install.mjs               跨平台、完全离线的安装器
│   ├── uninstall.mjs             外科式、幂等的卸载器
│   ├── pack-offline.mjs          生成 dist/*.tgz + SHA256SUMS.txt
│   ├── migrate-history.mjs       一次性：旧 `_history/` → 原地 + 标记
│   ├── migrate-layout.mjs        一次性：平铺阶段目录 → Pipeline/<阶段>
│   ├── selftest.mjs              端到端离线安装/卸载自测
│   ├── probe.mjs                 鉴权感知的启动图探测 + 宿主通道 ping
│   ├── check-bundle.mjs          把浏览器实际拿到的 bundle 抓下来查标志位（部署后核对内容）
│   ├── doctor.mjs                安装诊断：把「不在启动图里」分成两种原因并给出修复命令
│   ├── rpc.mjs                   命令行调用任意 op，不需要浏览器
│   ├── restart-host.ps1/.cmd     重启 dsh web，让宿主半边改动生效
│   └── lib/
│       ├── http.mjs              cookie jar + 有界重定向跟随
│       ├── tar.mjs               极简 ustar 读写（不依赖系统 tar，也不依赖 npm）
│       ├── theme-tokens.mjs      DSH 主题真实定义的全部 --dsw-* token
│       ├── home-detect.mjs       在多个候选里找出**活着**的 $DSH_HOME
│       └── doctor-verdict.mjs    doctor.mjs 四条结论背后的纯函数规则
├── deploy.ps1                    Windows 薄封装，纯 ASCII，转调 tools/install.mjs
├── .github/                      CI、Release、issue 表单、PR 模板
├── README.md · README.zh.md      双语配对（同等效力）
├── README.i18n.yaml              配对记录：两侧的 git blob 哈希
├── CHANGELOG.md · CONTRIBUTING.md · SECURITY.md · LICENSE
└── .editorconfig · .gitattributes · .gitignore
```

安装后的位置：

```
$DSH_HOME/profiles/node_modules/dsh-client-ui-workbench/   包
$DSH_HOME/profiles/<profile>/cordis.patch.yml              托管的 insert 块
$DSH_HOME/workbench/identity.json                          我是谁（按用户）
<工作区>/docs/requirements/                                工作台的全部数据
<工作区>/docs/requirements/templates/                      文档模板（方案 / 测试 / 提版，全工作台共用一套）
```

## 兼容性

在 `web` profile 下的 DSH `0.1.5-rc.2` 验证通过。客户端插件契约——`dsh.client`、
`exports["./client"]`、`/plugins` 路由、基线模块表、`conversation.view` 槽位——
在 `0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.6-alpha.1` 之间是稳定的。

更新的 DSH 版本可能新增 `@deepseek-ai/dsh-client-runtime` 之类在旧版本里不存在的名字。
除非你确认目标版本有这个包，否则不要把它们写进 `dsh.client.inject`。

---

## 参考实现

想对照官方写法，这些已安装的包是活的参考：

| 看什么 | 文件 |
|---|---|
| 最小的客户端页签插件（含 `conversation.view` 注册） | `…/node_modules/@deepseek-ai/dsh-client-ui-jobs/lib/client.js` |
| 官方「轨迹」页签完整实现 | `…/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js` |
| **手写 bundle 的同类范本**（零构建、`react.createElement`） | `…/@deepseek-ai/dsh-webui-auth/lib/client.js` |
| slot 声明与 owner props 的类型真源 | `…/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts` |
| 宿主半边为空实现的写法 | `…/@deepseek-ai/dsh-client-ui-trajectory/lib/index.js` |
| 官方源码仓库 | <https://github.com/deepseek-ai/deepseek-harness> |

---

## 参与贡献

欢迎贡献。请先读 [CONTRIBUTING.md](CONTRIBUTING.md)——两条硬规矩是
**永远不加依赖** 和 **两个 README 同步改**。

## 安全

信任边界、本插件做什么/不做什么、以及如何私下报告漏洞，见 [SECURITY.md](SECURITY.md)。

## 许可

[MIT](LICENSE)
