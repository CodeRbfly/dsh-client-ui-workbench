/**
 * 一次性迁移：`_history/` → 原地 + `archivedAt` 标记。
 *
 * 背景：归档语义从「把需求文件夹搬进 `_history/`」改成了「写 requirement.json 的
 * `archivedAt`，目录原地不动」。用旧版本归档过的需求还躺在 `_history/` 下，新代码
 * 根本不会去那里找它们，所以必须搬回工作台根 —— 而且必须保证 `archivedAt` 非空，
 * 否则新代码会把它们当成活跃需求重新显示出来。
 *
 * 用法：
 *   node tools/migrate-history.mjs                 # 预演（默认）：只打印将要做什么
 *   node tools/migrate-history.mjs --apply         # 真正执行
 *   node tools/migrate-history.mjs --root <dir>    # 显式指定工作台根目录
 *
 * 安全边界（刻意保守，宁可停下让人来处理）：
 *   - 目标位置已有同名需求 → **跳过并报错**，绝不覆盖、绝不合并；
 *   - 只在 `_history/` 搬空后才删掉它，否则原样保留并提示；
 *   - 默认预演，只有显式 `--apply` 才动磁盘。
 *
 * 常量直接从 `../index.js` 导入，不在这里复制一份 —— 免得哪天改了工作台根路径，
 * 迁移脚本还照着老路径找一个不存在的目录。这样也顺带验证了 index.js 能在宿主
 * 之外被 import（它顶层的唯一副作用是一个被 try/catch 包住的动态 import）。
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_FIELD, REQUIREMENT_FILE, REQUIREMENT_ID_PATTERN, WORKBENCH_ROOT } from '../index.js';

/** 旧版的归档目录名。只在这个一次性迁移里出现，代码里已彻底删除。 */
const LEGACY_HISTORY_DIR = '_history';

/** 新版管线目录名。用来提示「目录还是旧的平铺布局」。 */
const PIPELINE_DIR = 'Pipeline';

/** 旧版平铺布局下会出现在需求文件夹根部的阶段目录。 */
const FLAT_STAGE_DIRS = ['需求', '方案', '开发', '测试', '提版'];

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法: node tools/migrate-history.mjs [--apply] [--root <工作台根目录>]');
  console.log('');
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

const root = resolveWorkbenchRoot();
const historyDir = join(root, LEGACY_HISTORY_DIR);

console.log('工作台根目录 :', root);
console.log('待迁移目录   :', historyDir);
console.log('模式         :', apply ? '执行（--apply）' : '预演（加 --apply 才会动磁盘）');
console.log('');

if (!existsSync(historyDir)) {
  console.log('没有 `_history/` —— 无需迁移。');
  process.exit(0);
}

const entries = await readdir(historyDir, { withFileTypes: true });
const ids = [];
const ignored = [];
for (const entry of entries) {
  if (entry.isDirectory() && REQUIREMENT_ID_PATTERN.test(entry.name)) ids.push(entry.name);
  else ignored.push(entry.name);
}

for (const name of ignored) console.log(`  跳过非需求目录 : ${LEGACY_HISTORY_DIR}/${name}`);
if (ids.length === 0) console.log('`_history/` 里没有需求文件夹。');

ids.sort();

const conflicts = [];
let moved = 0;

for (const id of ids) {
  const source = join(historyDir, id);
  const target = join(root, id);

  if (existsSync(target)) {
    conflicts.push(id);
    console.log(`  冲突，未处理   : ${id} —— 工作台根下已存在同名需求，请人工判断保留哪一份`);
    continue;
  }

  // 元数据：新代码靠 archivedAt 判定归档，所以这一趟必须把它补上。
  const metaPath = join(source, REQUIREMENT_FILE);
  let meta = null;
  try {
    const parsed = JSON.parse(await readFile(metaPath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object') meta = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.log(`  元数据损坏     : ${id} —— ${error.message}`);
  }

  let note = '';
  if (meta === null) {
    note = '⚠ 读不到 requirement.json，迁移后会被当成**活跃**需求，需要人工处理';
  } else if (typeof meta[ARCHIVE_FIELD] !== 'string' || meta[ARCHIVE_FIELD] === '') {
    // 缺时间戳时用目录的修改时间兜底 —— 比「现在」更接近事实。
    let stamp = new Date().toISOString();
    try {
      stamp = (await stat(source)).mtime.toISOString();
    } catch {
      /* 取不到就退回当前时间 */
    }
    note = `补写 ${ARCHIVE_FIELD}=${stamp}（原本为空）`;
    if (apply) {
      await writeFile(metaPath, `${JSON.stringify({ ...meta, [ARCHIVE_FIELD]: stamp }, null, 2)}\n`, 'utf8');
    }
  }

  // 目录布局提示：旧数据是平铺的 `需求/方案/…`，新约定收在 `Pipeline/` 下。
  let layoutNote = '';
  try {
    const nested = await readdir(source, { withFileTypes: true });
    const flat = nested.filter((entry) => entry.isDirectory() && FLAT_STAGE_DIRS.includes(entry.name)).map((e) => e.name);
    if (flat.length > 0 && !nested.some((entry) => entry.isDirectory() && entry.name === PIPELINE_DIR)) {
      layoutNote = `（仍为旧的平铺布局：${flat.join(' ')} —— 本次不处理，见 docs/storage-format.md）`;
    }
  } catch {
    /* 列不出来就算了，不影响迁移本身 */
  }

  if (apply) {
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
    moved += 1;
  }
  console.log(`  ${apply ? '已迁移' : '将迁移'}       : ${LEGACY_HISTORY_DIR}/${id} → ${id} ${note}${layoutNote}`);
}

if (apply) {
  const leftovers = await readdir(historyDir).catch(() => ['<读不到>']);
  if (leftovers.length === 0) {
    await rmdir(historyDir);
    console.log('');
    console.log(`已删除空的 ${LEGACY_HISTORY_DIR}/`);
  } else {
    console.log('');
    console.log(`${LEGACY_HISTORY_DIR}/ 仍非空（${leftovers.join(', ')}），保留原样，请人工确认后手动删除。`);
  }
}

console.log('');
console.log(`汇总：待迁移 ${ids.length} 条，冲突 ${conflicts.length} 条，${apply ? `已迁移 ${moved} 条` : '预演未改动磁盘'}`);

if (conflicts.length > 0) {
  console.log('冲突清单（需要人工处理，脚本刻意不替你做决定）：');
  for (const id of conflicts) console.log(`  - ${id}`);
  process.exit(1);
}

process.exit(0);
