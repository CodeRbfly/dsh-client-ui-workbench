/**
 * dsh-client-ui-workbench — 卸载器（install.mjs 的逆操作）。
 *
 * 做三件事：
 *   1. 从 profile 的补丁层里整块删除宿主行（含它的说明注释）。
 *   2. 删除 profiles/node_modules/<包名> 目录。
 *   3. 删除投放到 $DSH_HOME/skills/ 的随包 skill（**只在带本插件标记时才删**）。
 *
 * 三个方向都幂等：已经卸载过再跑一次不会报错。
 *
 * 用法：
 *   node tools/uninstall.mjs                    # 从 web profile 卸载
 *   node tools/uninstall.mjs --dry-run          # 只打印将要做什么
 *   node tools/uninstall.mjs --keep-patch       # 只删包目录，保留补丁层那行
 */
import { existsSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const packageName = pkg.name;

const SENTINEL = 'dsh-client-ui-workbench';

/**
 * 随包 skill 的名字与"这是我投放的"标记。
 *
 * 卸载时**必须**先看到标记才删目录：`$DSH_HOME/skills/` 是用户自己的地盘，
 * 里面完全可能有同名的手写 skill。没有标记就说明那不是我们装的 —— 删掉它
 * 是在毁用户的数据，而且不可逆。
 */
const SKILL_NAME = 'requirement-doc-reader';
const SKILL_MARKER = '.installed-by-dsh-client-ui-workbench';

function parseArgs(argv) {
  const options = {
    profile: 'web',
    dshHome: process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'),
    rowId: undefined,
    dryRun: false,
    keepPatch: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case '--profile': options.profile = next(); break;
      case '--dsh-home': options.dshHome = next(); break;
      case '--row-id': options.rowId = next(); break;
      case '--dry-run': options.dryRun = true; break;
      case '--keep-patch': options.keepPatch = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** 由包名推导补丁层行 id（与 install.mjs 保持一致）。 */
function deriveRowId(name) {
  return name.replace(/^@[^/]+\//, '').replace(/^dsh-/, '');
}

/**
 * 从补丁层文本里移除本插件的宿主行。
 *
 * 两条路径：
 *   A. 有 managed 哨兵注释（install.mjs 写的）→ 按哨兵整块删。
 *   B. 没有哨兵（老版本装的）→ 定位 `- id: <rowId>`，向外扩到所属的顶层列表项，
 *      并把紧贴其上的说明注释块一并带走。
 *
 * @returns {{ text: string, removed: boolean }}
 */
export function removePatchBlock(text, rowId) {
  const lines = text.split('\n');

  // ── 路径 A：哨兵 ────────────────────────────────────────────────────────
  const startSentinel = lines.findIndex((line) => line.includes(`>>> ${SENTINEL}`));
  const endSentinel = lines.findIndex((line) => line.includes(`<<< ${SENTINEL}`));
  if (startSentinel !== -1 && endSentinel > startSentinel) {
    let from = startSentinel;
    if (from > 0 && lines[from - 1].trim() === '') from -= 1;
    lines.splice(from, endSentinel - from + 1);
    return { text: lines.join('\n'), removed: true };
  }

  // ── 路径 B：按行 id 定位 ────────────────────────────────────────────────
  const escaped = rowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowPattern = new RegExp(`^\\s*-\\s*id:\\s*['"]?${escaped}['"]?\\s*$`);
  const rowIndex = lines.findIndex((line) => rowPattern.test(line));
  if (rowIndex === -1) return { text, removed: false };

  // 向前扩到所属顶层列表项（行首的 `- `）。
  let start = rowIndex;
  while (start > 0 && !/^-\s/.test(lines[start])) start -= 1;
  // 向后扩到下一个顶层列表项或文件末尾。
  let end = rowIndex + 1;
  while (end < lines.length && !/^-\s/.test(lines[end])) end += 1;

  // 向上吞掉紧贴的说明注释块，以及它与本块之间的空行。
  let from = start;
  while (from > 0) {
    const previous = lines[from - 1];
    if (previous.trim().startsWith('#')) { from -= 1; continue; }
    if (previous.trim() === '' && from - 2 >= 0 && lines[from - 2].trim().startsWith('#')) { from -= 1; continue; }
    break;
  }

  lines.splice(from, end - from);
  return { text: lines.join('\n'), removed: true };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('\n用法: node tools/uninstall.mjs [--profile web] [--dsh-home <dir>] [--dry-run] [--keep-patch]\n');
  process.exit(0);
}

const profilesRoot = join(options.dshHome, 'profiles');
const patchPath = join(profilesRoot, options.profile, 'cordis.patch.yml');
const targetDir = join(profilesRoot, 'node_modules', packageName);
const rowId = options.rowId ?? deriveRowId(packageName);
const skillDir = join(options.dshHome, 'skills', SKILL_NAME);
const skillMarkerPath = join(skillDir, SKILL_MARKER);

console.log('\n== dsh-client-ui-workbench 卸载 ==');
console.log(`dsh home : ${options.dshHome}`);
console.log(`profile  : ${options.profile}`);
console.log(`模式     : ${options.dryRun ? 'DRY-RUN（不写文件）' : '实际卸载'}\n`);

// 步骤 1：补丁层
if (options.keepPatch) {
  console.log('[1/3] --keep-patch：保留补丁层宿主行');
} else if (!existsSync(patchPath)) {
  console.log(`[1/3] 补丁层不存在（${patchPath}），跳过`);
} else {
  const before = readFileSync(patchPath, 'utf8');
  const { text: after, removed } = removePatchBlock(before, rowId);
  if (!removed) {
    console.log(`[1/3] 补丁层没有 '${rowId}' 宿主行，保持不变`);
  } else if (options.dryRun) {
    console.log(`[1/3] DRY-RUN 将从 ${patchPath} 删除宿主行 '${rowId}'`);
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${patchPath}.${stamp}.bak`;
    cpSync(patchPath, backupPath);
    writeFileSync(patchPath, after, { encoding: 'utf8' });
    console.log(`[1/3] 已备份 -> ${backupPath}`);
    console.log(`      已删除宿主行 '${rowId}'`);
  }
}

// 步骤 2：包目录
if (!existsSync(targetDir)) {
  console.log(`[2/3] 包目录不存在（${targetDir}），跳过`);
} else if (options.dryRun) {
  console.log(`[2/3] DRY-RUN 将删除 ${targetDir}`);
} else {
  rmSync(targetDir, { recursive: true, force: true });
  console.log(`[2/3] 已删除 ${targetDir}`);
}

// 步骤 3：随包 skill
// 只认带标记的那一份。没标记 = 用户自己的同名 skill，一个字节都不碰。
if (!existsSync(skillDir)) {
  console.log(`[3/3] skill 目录不存在（${skillDir}），跳过`);
} else if (!existsSync(skillMarkerPath)) {
  console.log(`[3/3] ${skillDir} 没有本插件标记，判定为用户自己的 skill，保留不动`);
} else if (options.dryRun) {
  console.log(`[3/3] DRY-RUN 将删除 ${skillDir}`);
} else {
  rmSync(skillDir, { recursive: true, force: true });
  console.log(`[3/3] 已删除 ${skillDir}`);
}

console.log('\n== 完成 ==');
if (!options.dryRun) {
  console.log('浏览器 F5 刷新后页签消失。宿主无需重启（补丁层是 live 重载的）。');
}
console.log('');
