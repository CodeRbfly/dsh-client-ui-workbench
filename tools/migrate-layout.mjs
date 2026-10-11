/**
 * 一次性迁移：把平铺的阶段目录收进 `Pipeline/`。
 *
 * 背景：五个阶段目录（需求 / 方案 / 开发 / 测试 / 提版）早期直接躺在需求文件夹根部，
 * 后来改成收在 `<reqId>/Pipeline/` 之下 —— 需求文件夹根部只放数据文件
 * （`requirement.json` / `feature-points/` / `clarifications/` / `documents/`），
 * 谁是元数据、谁是产物一眼可辨。新建的需求已经是新布局，老需求需要搬一次。
 *
 * 这个脚本还要**重写 `requirement.json` 里已持久化的路径**：`documents[]` 的
 * `file` / `textFile` 是相对需求文件夹的路径（例如 `需求/source/v1-0-原件.docx`），
 * 目录层级一变它们就失效。整目录归档不会破坏它们（相对路径依然成立），
 * 但层级调整会 —— 而且已归档的需求不会有人再去读一遍"顺手修好"。
 *
 * 用法：
 *   node tools/migrate-layout.mjs                 # 预演（默认）：只打印将要做什么
 *   node tools/migrate-layout.mjs --apply         # 真正执行
 *   node tools/migrate-layout.mjs --root <dir>    # 显式指定工作台根目录
 *
 * 安全边界（与 migrate-history.mjs 一致，刻意保守）：
 *   - `Pipeline/<阶段>` 已存在 → 该阶段**跳过并报错**，绝不覆盖、绝不合并；
 *   - 默认预演，只有显式 `--apply` 才动磁盘。
 *
 * 常量直接从 `../index.js` 导入，不在这里复制一份。
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPELINE_DIR, REQUIREMENT_FILE, REQUIREMENT_ID_PATTERN, STAGE_DIRS, WORKBENCH_ROOT } from '../index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法: node tools/migrate-layout.mjs [--apply] [--root <工作台根目录>]');
  console.log('');
  console.log('  把 <reqId>/{需求,方案,开发,测试,提版} 搬进 <reqId>/Pipeline/，');
  console.log('  并重写 requirement.json 里 documents[].file / textFile 的路径前缀。');
  console.log('  不带 --apply 时只预演，不碰磁盘。');
  process.exit(0);
}

const apply = argv.includes('--apply');

/** 读一个 `--name value` 形式的选项。 */
function option(name) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

/** 工作台根目录：显式参数 > 仓库旁边的工作区 > 当前目录。 */
function resolveWorkbenchRoot() {
  const explicit = option('--root');
  if (explicit !== undefined && explicit !== '') return resolve(explicit);
  const candidates = [
    resolve(packageRoot, '..', ...WORKBENCH_ROOT.split('/')),
    resolve(process.cwd(), ...WORKBENCH_ROOT.split('/')),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0];
}

/**
 * 把一条相对路径从「平铺」改写成「收在 Pipeline 下」。
 * 已经带 `Pipeline/` 前缀的、以及不认识的前缀，一律原样返回。
 */
function rewriteStagePath(value) {
  if (typeof value !== 'string' || value === '') return { value, changed: false };
  if (value === PIPELINE_DIR || value.startsWith(`${PIPELINE_DIR}/`)) return { value, changed: false };
  for (const stage of STAGE_DIRS) {
    if (value === stage || value.startsWith(`${stage}/`)) {
      return { value: `${PIPELINE_DIR}/${value}`, changed: true };
    }
  }
  return { value, changed: false };
}

const root = resolveWorkbenchRoot();
console.log('工作台根目录 :', root);
console.log('目标布局     :', `<reqId>/${PIPELINE_DIR}/{${STAGE_DIRS.join(',')}}`);
console.log('模式         :', apply ? '执行（--apply）' : '预演（加 --apply 才会动磁盘）');
console.log('');

if (!existsSync(root)) {
  console.log(`工作台根不存在：${root}`);
  process.exit(1);
}

const entries = await readdir(root, { withFileTypes: true });
const ids = entries
  .filter((entry) => entry.isDirectory() && REQUIREMENT_ID_PATTERN.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (ids.length === 0) {
  console.log('没有需求文件夹。');
  process.exit(0);
}

const conflicts = [];
let movedStages = 0;
let rewrittenFiles = 0;
let touchedRequirements = 0;

for (const id of ids) {
  const dir = join(root, id);
  const nested = await readdir(dir, { withFileTypes: true });
  const flat = nested.filter((entry) => entry.isDirectory() && STAGE_DIRS.includes(entry.name)).map((e) => e.name);
  const hasPipeline = nested.some((entry) => entry.isDirectory() && entry.name === PIPELINE_DIR);

  // ── 1. 阶段目录搬家 ───────────────────────────────────────────────────────
  const notes = [];
  if (flat.length > 0) {
    if (apply) await mkdir(join(dir, PIPELINE_DIR), { recursive: true });
    for (const stage of flat) {
      const target = join(dir, PIPELINE_DIR, stage);
      if (existsSync(target)) {
        conflicts.push(`${id}/${stage}`);
        notes.push(`冲突：${stage}（${PIPELINE_DIR}/${stage} 已存在，未处理）`);
        continue;
      }
      if (apply) await rename(join(dir, stage), target);
      movedStages += 1;
      notes.push(`${stage}`);
    }
  }

  // ── 2. 重写 requirement.json 里已持久化的路径 ─────────────────────────────
  const metaPath = join(dir, REQUIREMENT_FILE);
  let meta = null;
  try {
    const parsed = JSON.parse(await readFile(metaPath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object') meta = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') notes.push(`元数据读取失败：${error.message}`);
  }

  if (meta !== null && Array.isArray(meta.documents)) {
    let dirty = false;
    for (const doc of meta.documents) {
      if (doc === null || typeof doc !== 'object') continue;
      for (const field of ['file', 'textFile']) {
        const result = rewriteStagePath(doc[field]);
        if (!result.changed) continue;
        notes.push(`${field}: ${doc[field]} → ${result.value}`);
        doc[field] = result.value;
        dirty = true;
        rewrittenFiles += 1;
      }
    }
    if (dirty) {
      touchedRequirements += 1;
      if (apply) await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    }
  }

  const alreadyNested = hasPipeline && flat.length === 0;
  if (notes.length === 0 && alreadyNested) {
    console.log(`  已是最新布局 : ${id}`);
    continue;
  }
  const head = apply ? '已迁移' : '将迁移';
  console.log(`  ${head}       : ${id}${notes.length > 0 ? ` —— ${notes.join('；')}` : ' —— 无需改动'}`);
}

// 布局完成后，需求文件夹根部应当只剩数据文件：列出来给人一眼确认。
if (apply) {
  console.log('');
  for (const id of ids) {
    const dir = join(root, id);
    const list = await readdir(dir, { withFileTypes: true });
    const leftover = list
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== PIPELINE_DIR)
      .map((entry) => entry.name);
    if (leftover.length > 0) {
      for (const name of leftover) {
        const info = await stat(join(dir, name)).catch(() => null);
        // 只提示空目录：非空的说明还有别的东西住在那儿，值得人看一眼。
        const empty = info !== null && (await readdir(join(dir, name))).length === 0;
        if (empty) console.log(`  提示：${id}/${name} 是空目录且不在新布局里，可人工确认后删除`);
      }
    }
  }
}

console.log('');
console.log(`汇总：需求 ${ids.length} 个，阶段目录 ${apply ? '已迁移' : '待迁移'} ${movedStages} 个，`
  + `路径 ${apply ? '已重写' : '待重写'} ${rewrittenFiles} 条，冲突 ${conflicts.length} 个`);

if (conflicts.length > 0) {
  console.log('冲突清单（脚本刻意不替你做决定，请人工判断保留哪一份）：');
  for (const item of conflicts) console.log(`  - ${item}`);
  process.exit(1);
}

if (touchedRequirements > 0) {
  console.log(`（${touchedRequirements} 个需求的 requirement.json ${apply ? '已更新' : '需要更新'}）`);
}

process.exit(0);
