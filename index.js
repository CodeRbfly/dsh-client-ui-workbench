/**
 * dsh-client-ui-workbench — 宿主半边（host half）。
 *
 * 这个包是「双面包」（dual-face package）：
 *
 *   - 宿主半边（本文件，Node 侧）：由 cordis loader 作为普通行加载。它做两件事：
 *       1. 让 @deepseek-ai/dsh-client-modules 在扫描 loader 行时发现本包的
 *          `dsh.client` 声明，从而把 `exports["./client"]` 指向的浏览器 bundle
 *          编进 window.__DSH_BOOT__ 启动图；
 *       2. 提供工作台真正需要的**文件读写通道**（浏览器读不到磁盘）。
 *
 *   - 浏览器半边（lib/client.js）：UI。
 *
 * ── 为什么是 HTTP 路由而不是别的机制 ────────────────────────────────────────
 *
 * 试过的三条路里只有一条通：
 *
 *   ✗ Typert Remote（`@Remote` 命名空间）：机制存在，但 out-of-tree 加不进去。
 *     `@deepseek-ai/dsh-api-remotes/client` 里挂的是一张**写死的静态 import 表**，
 *     外挂包无法把自己加进去；而且 `/api` 的 rpc 拦截器是**独占**的，已被
 *     Typert gateway 占走（重复拦截会抛 "already has an interceptor"）。
 *
 *   ✗ 自己在顶层注册 `/workbench` 前缀：**不受鉴权保护**。dsh-webui-auth 的
 *     PROTECTED_PREFIXES 是写死的 `['/api', '/plugins']`，新前缀不在其中，
 *     而且会被它的 catch-all 前缀路由当成页面请求 302 掉。
 *
 *   ✓ `ctx.connection.fetch.register()` 注册一个**精确**的 `/api/...` 路由：
 *     精确路由在共享 fetch handler 里**先于**拦截器匹配，且因为落在 `/api`
 *     前缀路由内，**自动继承** Host/Origin 围栏 + 浏览器登录态，插件什么都不用做。
 *
 * ── 目录结构 ────────────────────────────────────────────────────────────────
 *
 *   <工作区>/docs/requirements/            ← WORKBENCH_ROOT
 *   ├── templates/{方案,测试,提版}/         ← 用户提供的模板
 *   └── XQ20260810-0031/                   ← 一条需求；归档与否只看 requirement.json
 *       ├── requirement.json               ←   里的 archivedAt，目录位置永不参与判定
 *       └── Pipeline/{需求,方案,开发,测试,提版}/
 *
 * 归档 = **写 `requirement.json` 的 `archivedAt`，目录原地不动**。不搬目录是刻意的：
 * 搬家会让 git 把归档看成「一批删除 + 一批新增」，`git log -- <path>` 就此断裂，
 * 还会和「别人正在改这条需求」撞成 modify/delete 冲突，Windows 上更会因为有人
 * 开着文档而让 `rename` 直接失败。改成标记后，归档对 git 只剩一行改动，而那个
 * 文件本来就归这条需求独占 —— 详见 {@link ARCHIVE_FIELD}。
 *
 * ── 路径安全 ────────────────────────────────────────────────────────────────
 *
 * 所有文件操作都被限制在需求文件夹之内，且只接受「需求编号 + 需求内相对路径」，
 * 绝不接受客户端传来的绝对路径。
 *
 * @module dsh-client-ui-workbench
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 定位 DSH 用户数据目录（`$DSH_HOME`，默认 `~/.dsh`）。
 *
 * `@deepseek-ai/dsh-home-paths` 由宿主提供（和浏览器半边的 `react` 一样，不是本包的依赖）。
 * 用动态 import + 兜底，是为了万一将来它换了位置也不会让整棵插件树加载失败。
 */
let resolveDshHomeImpl
try {
  const homePaths = await import('@deepseek-ai/dsh-home-paths')
  if (typeof homePaths.resolveDshHome === 'function') resolveDshHomeImpl = homePaths.resolveDshHome
} catch {
  resolveDshHomeImpl = undefined
}

function dshHome() {
  if (resolveDshHomeImpl !== undefined) {
    try {
      const resolved = resolveDshHomeImpl()
      if (typeof resolved === 'string' && resolved !== '') return resolved
    } catch {
      // 落到下面的兜底
    }
  }
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/** 稳定 loader 身份。 */
export const name = 'client-ui-workbench'

// ──────────────────────────────────────────────────────────────────────────────
// 随包分发的 skill
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 随包分发的 skill 名（`skills/<名>/SKILL.md`）。
 *
 * 「分析需求文档」这条链路**优先**用它：它写清了需求文档该怎么读 ——
 * 怎么判断是「多系统 + 多处修订记录表」还是单一文档、怎么按修订记录表里声明的
 * 变更底色只抽本次变更、怎么区分新增功能与变更功能、功能点写到什么粒度。
 *
 * 但它是**增强项，不是硬依赖**：装不上时分析会退回插件自带的通用指令
 * （见客户端 `documentAnalysisPrompt` 里的「先试着加载 skill」一节）。
 * 所以下面所有相关失败都只告警，绝不抛 —— 一个可选的增强项不该让整棵插件树加载失败。
 */
export const SKILL_NAME = 'requirement-doc-reader'

/** 本包安装目录 —— 用来定位随包资源（与安装方式无关）。 */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

/** 随包 skill 的源文件。 */
function bundledSkillFile() {
  return join(PACKAGE_DIR, 'skills', SKILL_NAME, 'SKILL.md')
}

/**
 * 投放目标：`$DSH_HOME/skills/<名>/SKILL.md`。
 *
 * 选用户 skill 根（而不是工作区的 `.dsh/skills`）是因为它**一定**在 DSH 的扫描表里
 * （`dsh-skill-filesystem` 的 user-dsh 根），跟工作区是不是 git 项目根无关。
 * 装进去之后它就是一个一等 skill，agent 能用 skill 工具按名字加载。
 */
function installedSkillFile() {
  return skillPathsAt(dshHome()).file
}

/**
 * 投放标记文件名，与 SKILL.md 同目录。
 *
 * **只有带这个标记的 skill 目录才是本插件投放的**，才允许被覆盖或被卸载删除。
 * 没有它就说明 `$DSH_HOME/skills/` 下已经有一个**别人的**同名 skill ——
 * 那是用户自己的东西，插件没有资格动它（覆盖掉一个手写 skill 是不可逆的损失），
 * 所以这时放弃投放并回报原因，让分析退回通用指令。
 */
const SKILL_MARKER = '.installed-by-dsh-client-ui-workbench'

/**
 * 某个 DSH home 下，这个 skill 的三个相关路径。
 *
 * 单独抽出来是为了**让测试能算出预期路径**，而不是在测试里把 join 再抄一遍 ——
 * 抄一遍就意味着路径改了测试还绿。
 *
 * @param {string} home $DSH_HOME
 */
export function skillPathsAt(home) {
  const dir = join(home, 'skills', SKILL_NAME)
  return { dir, file: join(dir, 'SKILL.md'), marker: join(dir, SKILL_MARKER) }
}

/** 路径是否存在（不区分文件/目录，权限错误也算不存在）。 */
async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 把随包 skill 投放进指定 DSH home 的 `skills/`，使其成为一等 DSH skill。
 *
 * 幂等：内容逐字相同就**不写盘** —— 既不必要地碰文件，也会白白触发一次
 * DSH 的目录监听与 skill 目录重建。
 *
 * 安全：只在**目标不存在**或**目标带本插件标记**时才写。遇到同名但无标记的
 * skill 一律让路（见 {@link SKILL_MARKER}）。
 *
 * **永不抛**：任何失败都回报 `ok: false` 与原因，由调用方决定要不要提示。
 * 这条是刻意的 —— skill 只是让分析更准的增强项，装不上不该让插件加载失败。
 *
 * @param {string} home $DSH_HOME
 * @returns {Promise<{ok: boolean, path: string, changed: boolean, reason?: string}>}
 */
export async function installSkillInto(home) {
  const { dir, file, marker } = skillPathsAt(home)
  try {
    const body = await readFile(bundledSkillFile(), 'utf8')
    if (await pathExists(file)) {
      if (!(await pathExists(marker))) {
        return {
          ok: false,
          path: file,
          changed: false,
          reason: `同名 skill 已存在且不是本插件投放的，跳过以免覆盖用户的文件：${file}`,
        }
      }
      const current = await readFile(file, 'utf8').catch(() => null)
      if (current === body) return { ok: true, path: file, changed: false }
    }
    await mkdir(dir, { recursive: true })
    await writeFile(file, body, 'utf8')
    await writeFile(marker, `${SKILL_NAME}\n`, 'utf8')
    return { ok: true, path: file, changed: true }
  } catch (error) {
    return { ok: false, path: file, changed: false, reason: String(error?.message ?? error) }
  }
}

/** 把随包 skill 投放进**本机** `$DSH_HOME/skills/`（见 {@link installSkillInto}）。 */
async function installSkill() {
  return installSkillInto(dshHome())
}

/**
 * 需要的 cordis 服务。
 *
 * 三个都是确认存在的宿主服务（`dsh-api-workspace-files` 的宿主半边注入同一组）：
 *   connection      ← 提供 /api 精确 fetch 路由注册能力
 *   sessions        ← 用 sessionId 反查该会话的工作区根（header.cwd）
 *   sandboxPolicy   ← 兜底的工作区根
 */
export const inject = ['connection', 'sessions', 'sandboxPolicy']

/**
 * 工作台在**工作区根**下的固定目录。
 *
 * 改这一个常量就能换位置（例如改成 `requirements`）。
 */
export const WORKBENCH_ROOT = 'docs/requirements'

/**
 * 管线目录：五个阶段都收在这一个文件夹下。
 *
 * 这样需求文件夹的根部只剩数据文件（requirement.json / feature-points/ …），
 * 管线产物一眼可辨，也不会和元数据混在一起。
 */
export const PIPELINE_DIR = 'Pipeline'

/** 管线目录下的五个阶段（顺序即管线顺序）。 */
export const STAGE_DIRS = ['需求', '方案', '开发', '测试', '提版']

/** 模板目录（根/templates）下按阶段分的子目录。 */
export const TEMPLATE_DIRS = ['方案', '测试', '提版']

/**
 * 归档标记字段。**归档 = 写这个字段，不搬目录。**
 *
 * 为什么不用「搬进 `_history/`」来表达归档：搬家是一次路径变更，代价有三层 ——
 *   - git 不存 rename，会把整目录移动记成「一批删除 + 一批新增」，
 *     `git log -- <path>` 从此断裂，要 `--follow` 才能接上；
 *   - 归档方搬目录、别人同时在改目录里的文件，会撞成 modify/delete 冲突 ——
 *     这是 git 层面唯一无法靠约定避免的硬冲突；
 *   - Windows 上只要有人开着目录里的文档（Word/Excel）或杀软正在扫描，
 *     `rename` 就抛 EPERM/EBUSY，归档直接失败（Linux 没这个问题）。
 *
 * 改成标记之后，归档对 git 就只剩 `requirement.json` 里一行改动，而那个文件
 * 本来就归这条需求独占，不会跟任何人冲突；相对路径也永远不变。
 */
export const ARCHIVE_FIELD = 'archivedAt'

/** 需求编号格式：XQ + 8 位日期 + '-' + 4 位序号。 */
export const REQUIREMENT_ID_PATTERN = /^XQ\d{8}-\d{4}$/

/** 需求元数据文件名（位于需求文件夹根部）。 */
export const REQUIREMENT_FILE = 'requirement.json'

/**
 * 「我是谁」和「我什么时候看到过哪条逾期提醒」都存在用户数据目录，而不是项目里。
 *
 * 两者都是**本用户状态**：前者跨项目跟着人走，后者更是「谁先看到」——
 * 写进共享的 `requirement.json` 就会变成每个人都在改同一个文件。
 */
const IDENTITY_DIR = 'workbench'
const IDENTITY_FILE = 'identity.json'
const NOTICE_FILE = 'notices.json'

/** 精确路由路径 —— 必须落在 `/api` 之下才会继承鉴权。 */
const ROUTE_PATH = '/api/rpc/workbench'

/** 端点名 = 路由路径去掉 `/api/` 前缀。请求体里的 `method` 必须逐字等于它。 */
const ROUTE_METHOD = 'rpc/workbench'

/** 读文件上限：超过就拒绝，避免把宿主内存打爆。 */
const MAX_TEXT_BYTES = 8 * 1024 * 1024

// ──────────────────────────────────────────────────────────────────────────────
// 工作区根解析与路径约束
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 用 sessionId 反查该会话的工作区根目录。
 *
 * 这是 DSH 自己的做法（见 `dsh-api-workspace-files` 宿主半边的
 * `workspaceFileScope`）：会话头部的 cwd 就是工作区根，取不到时回落到
 * sandboxPolicy 的工作区根。
 *
 * @param {any} ctx 宿主 cordis 上下文
 * @param {unknown} sessionId 客户端传来的会话 id
 * @returns {string} 绝对路径
 */
function workspaceRootFor(ctx, sessionId) {
  if (typeof sessionId === 'string' && sessionId !== '') {
    const header = ctx.sessions.get(sessionId)?.header
    if (header !== undefined && typeof header.cwd === 'string' && header.cwd !== '') return header.cwd
  }
  const fallback = ctx.sandboxPolicy?.workspaceRoot
  if (typeof fallback === 'string' && fallback !== '') return fallback
  throw new WorkbenchError('workbench/no-workspace', 'workbench: cannot resolve a workspace root for this session')
}

/** 工作台根目录的绝对路径。 */
function workbenchRootFor(ctx, sessionId) {
  return join(workspaceRootFor(ctx, sessionId), ...WORKBENCH_ROOT.split('/'))
}

/**
 * 用**字面量路径段**拼到某个基目录之下（内部调用：目录布局）。
 * @param {string} base @param {readonly string[]} segments
 * @returns {string} 绝对路径
 */
function confineSegments(base, segments) {
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment === '' || segment === '.' || segment === '..') {
      throw new WorkbenchError('workbench/bad-path', `workbench: invalid internal path segment ${JSON.stringify(segment)}`)
    }
  }
  return assertInside(base, resolve(base, ...segments))
}

/**
 * 用**客户端传来的相对路径**拼到某个基目录之下。
 *
 * 路径里允许分隔符（要能表达 `需求/source/v1.0-x.docx` 这种嵌套），但会逐段检查，
 * 且最终解析结果必须仍在基目录之内。
 *
 * @param {string} base @param {unknown} relativePath
 * @returns {string} 绝对路径
 */
function confineRelative(base, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new WorkbenchError('workbench/bad-path', 'workbench: path must be a non-empty string')
  }
  if (relativePath.includes('\0')) {
    throw new WorkbenchError('workbench/bad-path', 'workbench: path must not contain NUL')
  }
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) {
    throw new WorkbenchError('workbench/bad-path', 'workbench: absolute paths are not accepted; send a path relative to the requirement folder')
  }
  for (const segment of normalized.split('/')) {
    if (segment === '..') {
      throw new WorkbenchError('workbench/bad-path', 'workbench: path must not contain ".."')
    }
  }
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.')
  return assertInside(base, resolve(base, ...segments))
}

/**
 * 断言解析结果没有跑出基目录。
 *
 * `resolve()` 会折叠 `..`，所以即使逐段检查过，也必须对**最终绝对路径**
 * 再做一次前缀校验。
 */
function assertInside(base, target) {
  if (target !== base && !target.startsWith(base + sep)) {
    throw new WorkbenchError('workbench/bad-path', 'workbench: resolved path escapes the workbench root')
  }
  return target
}

/** 校验需求编号，返回它的文件夹路径（不保证存在）。 */
function requirementDir(base, id) {
  if (typeof id !== 'string' || !REQUIREMENT_ID_PATTERN.test(id)) {
    throw new WorkbenchError('workbench/bad-id', `workbench: requirement id must match ${REQUIREMENT_ID_PATTERN.source}`)
  }
  return confineSegments(base, [id])
}

/**
 * 定位一个需求文件夹。
 *
 * 归档不再搬家，所以只有一处位置 —— 已归档的需求同样住在 `base/<id>/`。
 * 找不到时也返回它应该在的路径：写操作需要在那里创建它。
 *
 * @param {string} base @param {unknown} id
 * @returns {Promise<{ dir: string, exists: boolean }>}
 */
async function locateRequirement(base, id) {
  const dir = requirementDir(base, id)
  return { dir, exists: await exists(dir) }
}

/**
 * 归档判定：只看 {@link ARCHIVE_FIELD}，非空串即已归档。
 *
 * 元数据缺失或损坏时一律当「活跃」—— 宁可让一条需求多显示一次，
 * 也不能因为一个字段读不出来就把它从列表里静默吞掉。
 *
 * @param {any} meta 需求元数据（可为 null）
 * @returns {boolean}
 */
function isArchived(meta) {
  return meta !== null && meta !== undefined
    && typeof meta[ARCHIVE_FIELD] === 'string' && meta[ARCHIVE_FIELD] !== ''
}

/** 带错误码的工作台错误，会被映射成 RPC 的 error 结果。 */
class WorkbenchError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.name = 'WorkbenchError'
    this.code = code
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 具体操作
// ──────────────────────────────────────────────────────────────────────────────

const EMPTY_REQUIREMENT = {
  schema: 1,
  id: '',
  title: '',
  /** 'active'（默认）| 'paused'（暂停）| 'done'（已完成）。归档是正交维度，看 archivedAt。 */
  status: 'active',
  createdAt: '',
  updatedAt: '',
  /** 归档时间；未归档为空串。**非空即已归档**，目录位置不参与判定。 */
  archivedAt: '',
  /** 提版日期 YYYY-MM-DD。 */
  releaseDate: '',
  /** 测试封板日期 YYYY-MM-DD。 */
  testFreezeDate: '',
  /** 上线日期 YYYY-MM-DD。 */
  goLiveDate: '',
  /** [{ version, file, textFile, sourceName, importedAt, chars }] */
  documents: [],
  /** [{ id, question, answer, askedAt, answeredAt }] */
  clarifications: [],
}

/** 今天（本地时区）的 YYYYMMDD。 */
function todayStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

/** 读需求元数据；文件不存在时返回 null。 */
async function readRequirementFile(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(dir, REQUIREMENT_FILE), 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    return { ...EMPTY_REQUIREMENT, ...parsed }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** 判断路径是否存在。 */
async function exists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** 把工作台根下的一层需求文件夹读成摘要。 */
async function scanArea(area) {
  let entries
  try {
    entries = await readdir(area, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !REQUIREMENT_ID_PATTERN.test(entry.name)) continue
    const dir = join(area, entry.name)
    const meta = await readRequirementFile(dir)
    out.push({
      id: entry.name,
      title: meta?.title ?? '',
      status: meta?.status ?? 'active',
      archived: isArchived(meta),
      createdAt: meta?.createdAt ?? '',
      updatedAt: meta?.updatedAt ?? '',
      archivedAt: meta?.archivedAt ?? '',
      releaseDate: meta?.releaseDate ?? '',
      testFreezeDate: meta?.testFreezeDate ?? '',
      goLiveDate: meta?.goLiveDate ?? '',
      documentCount: Array.isArray(meta?.documents) ? meta.documents.length : 0,
      clarificationCount: Array.isArray(meta?.clarifications) ? meta.clarifications.length : 0,
      hasMetadata: meta !== null,
    })
  }
  return out
}

/**
 * 列出需求。
 *
 * 默认只返回未归档的（含暂停的）；`includeArchived` 打开时把已归档的一起返回，
 * 这样客户端可以在同一个列表里按 `archived` 分组显示。
 *
 * 归档与否看每份 `requirement.json` 的 {@link ARCHIVE_FIELD}，不再看目录位置 ——
 * 已归档的需求始终待在原地，所以这里是**一次**目录扫描 + 逐个读元数据。
 */
async function listRequirements(base, options) {
  const includeArchived = options?.includeArchived === true
  const all = await scanArea(base)
  const out = includeArchived ? all : all.filter((entry) => !entry.archived)
  // 活跃在前；同组内按编号倒序（新需求在前）。
  out.sort((left, right) => {
    if (left.archived !== right.archived) return left.archived ? 1 : -1
    return left.id < right.id ? 1 : left.id > right.id ? -1 : 0
  })
  return out
}

/** 生成下一个需求编号：同一天内取最大序号 + 1。已归档的也参与，编号永不复用。 */
async function nextRequirementId(base, now = new Date()) {
  const stamp = todayStamp(now)
  const prefix = `XQ${stamp}-`
  let max = 0
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    entries = []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    const tail = entry.name.slice(prefix.length)
    if (!/^\d{4}$/.test(tail)) continue
    max = Math.max(max, Number.parseInt(tail, 10))
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

/** 幂等创建目录结构，返回本次真正新建的目录（相对工作台根）。 */
async function ensureLayout(base) {
  const created = []
  const targets = [
    [],
    ['templates'],
    ...TEMPLATE_DIRS.map((stage) => ['templates', stage]),
  ]
  for (const segments of targets) {
    const target = segments.length === 0 ? base : confineSegments(base, segments)
    if (!(await exists(target))) created.push(segments.join('/') || '.')
    await mkdir(target, { recursive: true })
  }
  return { root: base, created }
}

/** 新建一个需求：建文件夹 + 五个阶段目录 + requirement.json。 */
async function createRequirement(base, args) {
  const id = args?.id
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title === '') throw new WorkbenchError('workbench/bad-title', 'workbench: requirement title must not be blank')
  const dir = requirementDir(base, id)
  if (await exists(dir)) throw new WorkbenchError('workbench/duplicate-id', `workbench: requirement ${id} already exists`)

  await mkdir(dir, { recursive: true })
  for (const stage of STAGE_DIRS) await mkdir(join(dir, PIPELINE_DIR, stage), { recursive: true })

  const now = new Date().toISOString()
  const meta = { ...EMPTY_REQUIREMENT, id, title, createdAt: now, updatedAt: now }
  await writeFile(join(dir, REQUIREMENT_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return { id, title, dir }
}

/**
 * 归档一个需求：只写 {@link ARCHIVE_FIELD}，**目录原地不动**。
 *
 * 幂等：已经归档就直接返回 `already: true`，绝不覆盖已有的时间戳。这一条不是
 * 加固而是正确性前提 —— 归档后需求留在原地，逾期扫描每天都能再看见它一次，
 * 少了这个判断就会每开一次工作台把时间戳重刷一遍，git 里天天多一行冲突。
 * 两个人同一天各自触发自动归档时，第二个人也不会覆盖第一个人的记录。
 */
async function archiveRequirement(base, args) {
  const id = args?.id
  const { dir } = await locateRequirement(base, id)
  const meta = await readRequirementFile(dir)
  if (meta === null) {
    throw new WorkbenchError('workbench/not-found', `workbench: requirement ${id} has no ${REQUIREMENT_FILE}`)
  }
  if (isArchived(meta)) return { id, dir, archived: true, already: true }

  const now = new Date().toISOString()
  const next = { ...meta, [ARCHIVE_FIELD]: now, updatedAt: now }
  await writeFile(join(dir, REQUIREMENT_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { id, dir, archived: true, already: false }
}

/**
 * 取消归档：清掉 {@link ARCHIVE_FIELD}，目录同样不动。
 *
 * `status` 复位成 `active` 是既有行为，客户端 `restorePipeline` 会紧接着把
 * 归档前的状态写回去（见其注释）。
 */
async function restoreRequirement(base, args) {
  const id = args?.id
  const { dir } = await locateRequirement(base, id)
  const meta = await readRequirementFile(dir)
  if (meta === null) {
    throw new WorkbenchError('workbench/not-found', `workbench: requirement ${id} has no ${REQUIREMENT_FILE}`)
  }
  if (!isArchived(meta)) return { id, dir, archived: false, already: true }

  const next = { ...meta, [ARCHIVE_FIELD]: '', status: 'active', updatedAt: new Date().toISOString() }
  await writeFile(join(dir, REQUIREMENT_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { id, dir, archived: false, already: false }
}

/**
 * **彻底删除**一个需求：整个需求文件夹一起删。
 *
 * 和归档是两件完全不同的事，所以是两个 op：
 *
 *   - 归档（{@link archiveRequirement}）**只写一个字段**，目录原地不动，随时可恢复 ——
 *     它回答的是"这条需求还要不要出现在我眼前"。
 *   - 删除是不可逆的：目录、文档原件、解析出的正文、每一版分析、功能点、方案、测试记录
 *     全在里面。删掉之后**没有任何地方还留着副本**，这正是它需要一个 op 而不是复用
 *     `remove` 的原因 —— `remove` 明确拒绝删需求文件夹本身（见 {@link removePath}），
 *     那条守卫是刻意的：删里面某个文件是日常操作，删掉整条需求不该由它顺手完成。
 *
 * 二次确认在客户端（见 RequirementChips）：宿主不该假装自己知道用户点了什么。
 * 这里只负责把那个不可逆的动作做干净 —— 用户确认之后如果只删掉一半（比如元数据没了、
 * 文件夹还在），列表里会留下一条读不出标题的幽灵记录，比不删更糟。
 *
 * `recursive: true` + `force: true`：目录树整体删；`force` 让"已经不存在"不算错误 ——
 * 但**先**用 locate 校验一次存在性，所以真正的不存在仍然报 not-found，不会静默成功。
 */
async function deleteRequirement(base, args) {
  const id = args?.id
  const { dir, exists: present } = await locateRequirement(base, id)
  if (!present) {
    throw new WorkbenchError('workbench/not-found', `workbench: requirement ${id} does not exist`)
  }
  await rm(dir, { recursive: true, force: true })
  return { id, dir, removed: true }
}

/** 读一个需求文件夹内的文本文件。 */
async function readText(base, args) {
  const { dir } = await locateRequirement(base, args?.id)
  const target = confineRelative(dir, args?.path)
  const info = await stat(target).catch((error) => {
    if (error?.code === 'ENOENT') throw new WorkbenchError('workbench/not-found', `workbench: ${args?.path} does not exist`)
    throw error
  })
  if (!info.isFile()) throw new WorkbenchError('workbench/not-file', `workbench: ${args?.path} is not a file`)
  if (info.size > MAX_TEXT_BYTES) {
    throw new WorkbenchError('workbench/too-large', `workbench: ${args?.path} is ${info.size} bytes, over the ${MAX_TEXT_BYTES} limit`)
  }
  return { path: args.path, text: await readFile(target, 'utf8') }
}

/** 写一个需求文件夹内的文本文件（自动建父目录）。 */
async function writeText(base, args) {
  if (typeof args?.text !== 'string') throw new WorkbenchError('workbench/bad-argument', 'workbench: text must be a string')
  const { dir } = await locateRequirement(base, args?.id)
  const target = confineRelative(dir, args?.path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, args.text, 'utf8')
  return { path: args.path, bytes: Buffer.byteLength(args.text, 'utf8') }
}

/** 写二进制文件（上传的 .docx 原件走这条）。 */
async function writeBinary(base, args) {
  if (typeof args?.base64 !== 'string') throw new WorkbenchError('workbench/bad-argument', 'workbench: base64 must be a string')
  const { dir } = await locateRequirement(base, args?.id)
  const target = confineRelative(dir, args?.path)
  await mkdir(dirname(target), { recursive: true })
  const bytes = Buffer.from(args.base64, 'base64')
  await writeFile(target, bytes)
  return { path: args.path, bytes: bytes.length }
}

/** 列一个需求文件夹内的目录。`path` 省略或为 `.` 时列需求文件夹根部。 */
async function listDir(base, args) {
  const { dir } = await locateRequirement(base, args?.id)
  const path = args?.path
  const target = path === undefined || path === '' || path === '.'
    ? dir
    : confineRelative(dir, path)
  const entries = await readdir(target, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const out = []
  for (const entry of entries) {
    const info = await stat(join(target, entry.name)).catch(() => undefined)
    out.push({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      bytes: info?.isFile() === true ? info.size : 0,
      mtime: info?.mtimeMs ?? 0,
    })
  }
  out.sort((left, right) => (left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'dir' ? -1 : 1))
  return { path: path ?? '.', entries: out }
}

/**
 * 模板文件的落点：`<工作台根>/templates/<阶段>/<文件名>`。
 *
 * 为什么模板在**工作台根**而不是需求文件夹里：公司模板是**一套**，不是每条需求一份。
 * 放在这里，所有人、所有需求共用同一份，改一次全生效。这个目录本来就由
 * {@link ensureLayout} 按 {@link TEMPLATE_DIRS} 建好了，只是以前没人用它。
 *
 * @param {string} base 工作台根 @param {unknown} stage @param {unknown} file
 */
function templateTarget(base, stage, file) {
  if (!TEMPLATE_DIRS.includes(stage)) {
    throw new WorkbenchError('workbench/bad-argument', `workbench: unknown template stage ${JSON.stringify(stage)}`)
  }
  const dir = confineSegments(base, ['templates', stage])
  return { dir, target: confineRelative(dir, file) }
}

/** 读一个工作台级模板文件。 */
async function readTemplate(base, args) {
  const { target } = templateTarget(base, args?.stage, args?.file)
  const info = await stat(target).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new WorkbenchError('workbench/not-found', `workbench: template ${args?.stage}/${args?.file} does not exist`)
    }
    throw error
  })
  if (!info.isFile()) {
    throw new WorkbenchError('workbench/not-file', `workbench: template ${args?.stage}/${args?.file} is not a file`)
  }
  if (info.size > MAX_TEXT_BYTES) {
    throw new WorkbenchError('workbench/too-large', `workbench: template is ${info.size} bytes, over the ${MAX_TEXT_BYTES} limit`)
  }
  return { path: `templates/${args.stage}/${args.file}`, text: await readFile(target, 'utf8') }
}

/**
 * 写一个工作台级模板文件 —— **只在文件不存在时创建**。
 *
 * 这个动作的唯一用途是"把内置模板摊出来给人改"。所以它**拒绝覆盖**：
 * 覆盖就等于一次点击抹掉别人已经按公司模板改好的文件，而那种损失是不可逆的。
 * 真要恢复内置版，把文件删掉再点一次即可。
 */
async function writeTemplate(base, args) {
  if (typeof args?.text !== 'string') {
    throw new WorkbenchError('workbench/bad-argument', 'workbench: text must be a string')
  }
  const { target } = templateTarget(base, args?.stage, args?.file)
  if (await exists(target)) {
    throw new WorkbenchError('workbench/exists', `workbench: template ${args.stage}/${args.file} already exists`)
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, args.text, 'utf8')
  return { path: `templates/${args.stage}/${args.file}`, bytes: Buffer.byteLength(args.text, 'utf8') }
}

/** 删除一个需求文件夹内的文件或目录。 */
async function removePath(base, args) {
  const { dir } = await locateRequirement(base, args?.id)
  const target = confineRelative(dir, args?.path)
  if (target === dir) throw new WorkbenchError('workbench/bad-path', 'workbench: refusing to remove the requirement folder itself')
  await rm(target, { recursive: Boolean(args?.recursive), force: true })
  return { path: args.path, removed: true }
}

/** 身份文件的绝对路径。 */
function identityPath() {
  return join(dshHome(), IDENTITY_DIR, IDENTITY_FILE)
}

/** 读身份；文件不存在或损坏时返回空名字。 */
async function readIdentity() {
  try {
    const parsed = JSON.parse(await readFile(identityPath(), 'utf8'))
    const name = parsed !== null && typeof parsed === 'object' ? parsed.name : ''
    return { name: typeof name === 'string' ? name : '', path: identityPath() }
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { name: '', path: identityPath() }
    throw error
  }
}

/** 写身份。 */
async function writeIdentity(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new WorkbenchError('workbench/bad-argument', 'workbench: identity name must not be blank')
  }
  const target = identityPath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({ schema: 1, name: name.trim(), updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  return { name: name.trim(), path: target }
}

/**
 * 逾期通知记录的绝对路径 —— 和身份一样放在用户数据目录，**不进共享树**。
 *
 * 为什么不能继续写在 `requirement.json` 里：那三个字段（何时登记通知、何时已读）
 * 描述的是「**我**什么时候看到的」，不是需求的事实。放在共享文件里，谁先打开工作台
 * 谁就写，两个人同一天打开就会改到同一处 —— 这正是那条协作规则
 * （「同一份数据只能由一个人写」）唯二被违反的地方之一。
 */
function noticePath() {
  return join(dshHome(), IDENTITY_DIR, NOTICE_FILE)
}

/** 从磁盘形状里取出通知表；非对象一律当空表。 */
function noticesOf(parsed) {
  if (parsed === null || typeof parsed !== 'object') return {}
  const raw = parsed.notices
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    out[id] = {
      raisedAt: typeof entry.raisedAt === 'string' ? entry.raisedAt : '',
      readAt: typeof entry.readAt === 'string' ? entry.readAt : '',
    }
  }
  return out
}

/** 读本机的通知表；文件不存在或损坏时返回空表（通知丢了也不该阻塞页面）。 */
async function readNotices() {
  try {
    return { notices: noticesOf(JSON.parse(await readFile(noticePath(), 'utf8'))), path: noticePath() }
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { notices: {}, path: noticePath() }
    throw error
  }
}

/** 整表写回。整个文件只归本机这一个用户写，所以不需要更细的粒度。 */
async function writeNotices(notices) {
  const target = noticePath()
  await mkdir(dirname(target), { recursive: true })
  const payload = { schema: 1, notices, updatedAt: new Date().toISOString() }
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { path: target, count: Object.keys(notices).length }
}

/** 校验通知的目标需求编号（它只是键，但仍然只接受合法编号）。 */
function assertNoticeId(id) {
  if (typeof id !== 'string' || !REQUIREMENT_ID_PATTERN.test(id)) {
    throw new WorkbenchError('workbench/bad-id', `workbench: notice id must match ${REQUIREMENT_ID_PATTERN.source}`)
  }
  return id
}

/**
 * 登记一条通知：**只写一次，绝不覆盖已有时间**。
 *
 * `raisedAt` 由客户端给（它可能是从共享文件里的旧值继承来的），因为自动归档的
 * 3 天窗口必须跨用户保持一致 —— 换个人打开工作台不该把倒计时重置。
 */
async function raiseNotice(args) {
  const id = assertNoticeId(args?.id)
  const { notices } = await readNotices()
  const existing = notices[id]
  if (existing !== undefined && existing.raisedAt !== '') return { ...existing, id, already: true, path: noticePath() }
  const raisedAt = typeof args?.raisedAt === 'string' && args.raisedAt !== '' ? args.raisedAt : new Date().toISOString()
  const entry = { raisedAt, readAt: existing !== undefined && typeof existing.readAt === 'string' ? existing.readAt : '' }
  notices[id] = entry
  await writeNotices(notices)
  return { ...entry, id, already: false, path: noticePath() }
}

/** 标记已读：同样是「只写一次」，先读的人定下时间。 */
async function markNoticeRead(args) {
  const id = assertNoticeId(args?.id)
  const { notices } = await readNotices()
  const existing = notices[id]
  if (existing === undefined || existing.readAt === '') {
    notices[id] = {
      raisedAt: existing !== undefined && typeof existing.raisedAt === 'string' ? existing.raisedAt : '',
      readAt: typeof args?.readAt === 'string' && args.readAt !== '' ? args.readAt : new Date().toISOString(),
    }
    await writeNotices(notices)
    return { ...notices[id], id, already: false, path: noticePath() }
  }
  return { ...existing, id, already: true, path: noticePath() }
}

/** 清掉一条通知（恢复已归档需求时用，给用户一个新的 3 天窗口）。 */
async function clearNotice(args) {
  const id = assertNoticeId(args?.id)
  const { notices } = await readNotices()
  if (notices[id] === undefined) return { id, removed: false, path: noticePath() }
  delete notices[id]
  await writeNotices(notices)
  return { id, removed: true, path: noticePath() }
}

/**
 * 读 `listRequirements` 的「是否包含已归档」开关。
 *
 * 历史包袱：`includeArchived` 曾经是本插件**唯一**一个放在 payload 顶层（而非
 * `payload.args`）的非 session 入参，其余 15 个 op 都读 `args`。于是任何按
 * 「参数放 args」写的调用方传进来的开关会被**静默忽略** —— 不报错、不告警，
 * 只是返回的结果少了一半，看起来像数据丢了（`tools/rpc.mjs --args` 就是这样栽的）。
 *
 * 现在两种写法都接受，`args` 优先；顶层的写法保留是为了兼容已经装好、正在运行的
 * 客户端 bundle（宿主半改动要重启，客户端半是热替换 —— 中间必然存在新旧并存的窗口）。
 *
 * @param {any} payload RPC payload
 * @returns {boolean}
 */
function includeArchivedFlag(payload) {
  const args = payload?.args
  if (args !== null && typeof args === 'object' && typeof args.includeArchived === 'boolean') {
    return args.includeArchived
  }
  return payload?.includeArchived === true
}

/** 操作表 —— 客户端只能通过这些 op 触达磁盘。 */
const OPS = {
  ping: async (ctx, payload) => {
    const root = workbenchRootFor(ctx, payload?.sessionId)
    return {
      pong: true,
      workbenchRoot: root,
      workbenchRootRelative: WORKBENCH_ROOT,
      archiveMode: 'flag',
      archiveField: ARCHIVE_FIELD,
      pipelineDir: PIPELINE_DIR,
      identityPath: identityPath(),
      noticesPath: noticePath(),
      stages: STAGE_DIRS,
      templateDirs: TEMPLATE_DIRS,
      idPattern: REQUIREMENT_ID_PATTERN.source,
      requirementFile: REQUIREMENT_FILE,
    }
  },
  ensureLayout: async (ctx, payload) => ensureLayout(workbenchRootFor(ctx, payload?.sessionId)),
  // 随包 skill 的投放状态。重复调用是幂等的（内容没变就不写盘），
  // 所以客户端/工具可以随时用它确认"skill 到底装上没有"。
  installSkill: async () => installSkill(),
  // 身份和通知都不按会话/项目走，所以这四个 op 不需要 sessionId。
  readIdentity: async () => readIdentity(),
  writeIdentity: async (ctx, payload) => writeIdentity(payload?.args?.name),
  readNotices: async () => readNotices(),
  raiseNotice: async (ctx, payload) => raiseNotice(payload?.args),
  markNoticeRead: async (ctx, payload) => markNoticeRead(payload?.args),
  clearNotice: async (ctx, payload) => clearNotice(payload?.args),
  listRequirements: async (ctx, payload) => {
    const base = workbenchRootFor(ctx, payload?.sessionId)
    return {
      requirements: await listRequirements(base, { includeArchived: includeArchivedFlag(payload) }),
      root: base,
    }
  },
  nextRequirementId: async (ctx, payload) => {
    const base = workbenchRootFor(ctx, payload?.sessionId)
    return { id: await nextRequirementId(base) }
  },
  createRequirement: async (ctx, payload) => createRequirement(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  archiveRequirement: async (ctx, payload) => archiveRequirement(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  restoreRequirement: async (ctx, payload) => restoreRequirement(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  deleteRequirement: async (ctx, payload) => deleteRequirement(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  readRequirement: async (ctx, payload) => {
    const { dir } = await locateRequirement(workbenchRootFor(ctx, payload?.sessionId), payload?.args?.id)
    const meta = await readRequirementFile(dir)
    if (meta === null) {
      throw new WorkbenchError('workbench/not-found', `workbench: ${payload?.args?.id} has no ${REQUIREMENT_FILE}`)
    }
    return { requirement: meta, archived: isArchived(meta) }
  },
  writeRequirement: async (ctx, payload) => {
    const base = workbenchRootFor(ctx, payload?.sessionId)
    const { dir } = await locateRequirement(base, payload?.args?.id)
    const meta = payload?.args?.requirement
    if (meta === null || typeof meta !== 'object') {
      throw new WorkbenchError('workbench/bad-argument', 'workbench: requirement must be an object')
    }
    if (meta.id !== payload.args.id) {
      throw new WorkbenchError('workbench/bad-argument', 'workbench: requirement.id must match the addressed id')
    }
    const next = { ...meta, updatedAt: new Date().toISOString() }
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, REQUIREMENT_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return { requirement: next }
  },
  readText: async (ctx, payload) => readText(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  writeText: async (ctx, payload) => writeText(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  writeBinary: async (ctx, payload) => writeBinary(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  listDir: async (ctx, payload) => listDir(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  remove: async (ctx, payload) => removePath(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  // 工作台级模板（`templates/<阶段>/`）：方案 / 自测 / 提版三份文档都由它驱动。
  // 注意这两个 op 也是**开机时注册**的：宿主没重启时客户端会收到 unknown-op，
  // 界面据此提示"重启一次 DSH"，而不是把模板静默换成内置版（那等于骗人）。
  readTemplate: async (ctx, payload) => readTemplate(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
  writeTemplate: async (ctx, payload) => writeTemplate(workbenchRootFor(ctx, payload?.sessionId), payload?.args),
}

// ──────────────────────────────────────────────────────────────────────────────
// 线协议
// ──────────────────────────────────────────────────────────────────────────────

/** 成功响应：`{type, rpcId, result:{ok:true, value}}`。 */
function okResponse(rpcId, value) {
  return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
}

/** 失败响应：`{type, rpcId, result:{ok:false, error}}`。 */
function errorResponse(rpcId, code, message) {
  return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code, message, details: {} } } })
}

/**
 * 给离线自检用的出口（宿主只读 `apply` / `inject`，多余导出没有影响）。
 *
 * 为什么值得多这么一行：**删除需求是不可逆的**，而它唯一的失败方式是"删了一半"或
 * "该拒绝的时候没拒绝"——两种都不会在页面上报错。放进 `__ops` 之后，
 * `tools/verify.mjs` 就能在一个临时目录上真的调用它，把结果查一遍，
 * 而不是只对着源码做正则。
 */
export const __ops = { deleteRequirement, removePath, locateRequirement, readTemplate, writeTemplate, ensureLayout }

/** 注册宿主路由。 */
export function apply(ctx) {
  // 随包 skill 投放：让「分析需求文档」能用上 requirement-doc-reader。
  //
  // 放在这里（插件加载时）而不是等客户端来调：skill 要在**任何人点分析之前**就位，
  // 否则第一次分析会走通用指令。失败只告警 —— 见 installSkill 的说明。
  void installSkill().then((result) => {
    if (result.ok) {
      ctx.logger?.info?.(
        `client-ui-workbench: skill ${SKILL_NAME} ${result.changed ? '已安装' : '已是最新'} → ${result.path}`,
      )
    } else {
      ctx.logger?.warn?.(`client-ui-workbench: skill ${SKILL_NAME} 投放失败（分析将退回通用指令）：${result.reason}`)
    }
  })

  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',

    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    async fetch(request) {
      if (request.method !== 'POST') return new Response('not found', { status: 404 })

      const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const rpcId = typeof body?.rpcId === 'string' && body.rpcId !== '' ? body.rpcId : 'invalid-request'
      if (body?.type !== 'client-request') {
        return errorResponse(rpcId, 'workbench/bad-request', 'invalid client-request message')
      }
      if (body.method !== ROUTE_METHOD) {
        return errorResponse(
          rpcId,
          'workbench/bad-request',
          `method ${JSON.stringify(typeof body.method === 'string' ? body.method : '(missing)')} does not match endpoint ${JSON.stringify(ROUTE_METHOD)}`,
        )
      }

      const payload = body.payload !== null && typeof body.payload === 'object' ? body.payload : {}
      const op = OPS[payload.op]
      if (typeof op !== 'function') {
        return errorResponse(rpcId, 'workbench/unknown-op', `workbench: unknown op ${JSON.stringify(payload.op)}`)
      }

      try {
        return okResponse(rpcId, await op(ctx, payload))
      } catch (error) {
        if (error instanceof WorkbenchError) return errorResponse(rpcId, error.code, error.message)
        return errorResponse(rpcId, 'workbench/internal', String(error?.message ?? error))
      }
    },
  })
}
