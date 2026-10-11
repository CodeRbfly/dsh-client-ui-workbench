/**
 * dsh-client-ui-workbench — 跨平台离线安装器。
 *
 * 设计目标（按重要性排序）：
 *
 *   1. **完全不联网**。不调用 npm / pnpm / `dsh plugin`，不解析 registry，
 *      不读取任何远程元数据。安装期间唯一的 I/O 是本地文件与 localhost 上的
 *      一次可选探测。
 *   2. **只依赖 Node 内置模块**。没有 node_modules，没有 postinstall。
 *      因此在没有网络、也可能没有 npm 的机器上直接可跑。
 *   3. **跨平台**。Windows / macOS / Linux 同一份脚本（不需要 PowerShell）。
 *   4. **幂等**。反复执行结果一致；补丁层只在缺失时追加。
 *
 * 为什么不用 `dsh plugin --profile web add`：那条路转发给 pnpm，会走网络、
 * 会在 profile 里生成 pnpm 元数据，而且下次 `dsh plugin install` 会把手工放入的
 * 目录当 extraneous 删除。本插件零运行时依赖，根本不需要包管理器参与。
 *
 * 用法：
 *   node tools/install.mjs                                   # 从本仓库目录安装
 *   node tools/install.mjs --tarball dist/<name>.tgz         # 从离线归档安装
 *   node tools/install.mjs --dry-run                         # 只打印计划
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createCookieJar, fetchFollowingRedirects, fetchIndexHtml } from './lib/http.mjs';
import { resolveHome } from './lib/home-detect.mjs';
import { readTar, stripArchiveRoot } from './lib/tar.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 参数解析 ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const options = {
    from: undefined,
    tarball: undefined,
    profile: 'web',
    dshHome: process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'),
    rowId: undefined,
    webUrl: process.env.DSH_WEB_URL || 'http://127.0.0.1:3080',
    dryRun: false,
    skipContract: false,
    skipVerify: false,
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
      case '--from': options.from = next(); break;
      case '--tarball': options.tarball = next(); break;
      case '--profile': options.profile = next(); break;
      case '--dsh-home': options.dshHome = next(); options.dshHomeExplicit = true; break;
      case '--row-id': options.rowId = next(); break;
      case '--web-url': options.webUrl = next(); break;
      case '--dry-run': options.dryRun = true; break;
      case '--skip-contract': options.skipContract = true; break;
      case '--skip-verify': options.skipVerify = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const HELP = `
用法: node tools/install.mjs [选项]

  --from <dir>       从目录安装（默认：本仓库根目录）
  --tarball <file>   从离线 .tgz 归档安装（与 --from 二选一）
  --profile <name>   DSH profile 名（默认 web）
  --dsh-home <dir>   DSH home（默认 $DSH_HOME，否则 ~/.dsh）
  --row-id <id>      补丁层行的 id（默认由包名推导）
  --web-url <url>    启动图验证地址（默认 $DSH_WEB_URL，否则 http://127.0.0.1:3080）
  --dry-run          只打印将要执行的动作，不写任何文件
  --skip-contract    跳过离线契约自检
  --skip-verify      跳过启动图验证
  -h, --help         显示本帮助
`;

/** 由包名推导补丁层行 id：dsh-client-ui-workbench -> client-ui-workbench */
function deriveRowId(packageName) {
  return packageName.replace(/^@[^/]+\//, '').replace(/^dsh-/, '');
}

/** 补丁层要追加的块。结尾带换行；使用 LF（与 .gitattributes 的 eol=lf 一致）。 */
function patchBlock(rowId, packageName) {
  return [
    '',
    '# >>> dsh-client-ui-workbench（由 tools/install.mjs 管理，可整块删除以卸载）',
    '# Out-of-tree web client (browser) UI plugin: 需求执行工作台 页签。',
    '# 普通宿主行：本插件不发布 cordis 服务，只往浏览器 slot 注册表贡献 UI，',
    '# 因此不需要 isolate realm。浏览器半边由 package.json 的 dsh.client',
    '# 声明 + exports["./client"] 被发现并编入 window.__DSH_BOOT__。',
    '- insert:',
    `    - id: ${rowId}`,
    `      name: '${packageName}'`,
    '# <<< dsh-client-ui-workbench',
    '',
  ].join('\n');
}

// ── 装载源（目录或归档）────────────────────────────────────────────────────
/** @returns {{ root: string, cleanup: () => void }} */
function stageSource(options) {
  if (options.tarball !== undefined) {
    const archivePath = resolve(options.tarball);
    if (!existsSync(archivePath)) throw new Error(`tarball not found: ${archivePath}`);

    const staging = mkdtempSync(join(tmpdir(), 'dsh-workbench-install-'));
    const cleanup = () => { rmSync(staging, { recursive: true, force: true }); };

    let files;
    try {
      files = readTar(gunzipSync(readFileSync(archivePath)));
    } catch (error) {
      cleanup();
      throw new Error(`cannot read tarball ${archivePath}: ${error.message}`);
    }

    let written = 0;
    for (const file of files) {
      const relative = stripArchiveRoot(file.name);
      if (relative === null) continue;
      const target = join(staging, relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.data);
      written += 1;
    }
    if (written === 0) {
      cleanup();
      throw new Error(`tarball ${archivePath} contains no "package/..." entries`);
    }
    return { root: staging, cleanup };
  }

  const root = resolve(options.from ?? packageRoot);
  if (!existsSync(join(root, 'package.json'))) {
    throw new Error(`no package.json under --from ${root}`);
  }
  return { root, cleanup: () => {} };
}

// ── 安装文件清单 ────────────────────────────────────────────────────────────
const REQUIRED_FILES = ['package.json', 'index.js', 'lib/client.js'];
const OPTIONAL_FILES = ['cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md'];
/**
 * 整个目录递归安装（相对根）。
 *
 * `skills/` 是随包分发的 DSH skill（目前只有 requirement-doc-reader）。
 * 它必须跟着装进来：宿主半边要在加载时把它投放到 `$DSH_HOME/skills/`，
 * 否则「分析需求文档」就用不上它。少了这一项，装完的机器上 skill 静默缺席 ——
 * 而症状只是"分析结果比预期粗"，不会报任何错。
 */
const DIRECTORY_TREES = ['lib', 'skills'];

/** @returns {string[]} 相对路径列表 */
function collectInstallFiles(root) {
  const out = new Set();
  for (const file of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    if (existsSync(join(root, file))) out.add(file);
  }
  for (const tree of DIRECTORY_TREES) {
    const absolute = join(root, tree);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) continue;
    for (const nested of listFiles(absolute)) out.add(`${tree}/${nested}`);
  }
  for (const file of REQUIRED_FILES) {
    if (!out.has(file)) throw new Error(`source is missing required file "${file}" (looked in ${root})`);
  }
  return [...out].sort();
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
if (options.help) { console.log(HELP); process.exit(0); }

// ★ 默认的 home 对 setup.exe 装的 DSH 来说是**错的** —— 它把 home 放在
//   %LOCALAPPDATA%\<App>\.dsh 这类位置。往错的地方装，插件不会生效，而症状
//   （页签不出现）与「没重启」几乎一样。所以没显式指定时，先自己找活着的那个。
if (!options.dshHomeExplicit) {
  const picked = resolveHome(options.dshHome, false);
  if (picked.switched) {
    console.log('');
    console.log(`注意：默认位置 ${options.dshHome} 看起来没被使用过`
      + `（${picked.reason === 'requested-unused' ? '没有 sessions/' : '最近的会话太久远'}）。`);
    console.log(`      另一个 home 明显是活的，改用它：${picked.home}`);
    console.log('      （想强行指定就加 --dsh-home "<路径>"）');
    options.dshHome = picked.home;
  } else if (picked.alternatives.length > 0 && picked.requestedAlive === 0) {
    console.log('');
    console.log(`注意：${options.dshHome} 下没有 sessions/，但还扫到这些 home：`);
    for (const one of picked.alternatives) console.log(`        ${one.home}`);
    console.log('      没敢替你换（无法判断哪个是活的）。确认后可用 --dsh-home 指定。');
  }
}

const profilesRoot = join(options.dshHome, 'profiles');
const profileDir = join(profilesRoot, options.profile);
const patchPath = join(profileDir, 'cordis.patch.yml');

console.log('\n== dsh-client-ui-workbench 离线安装 ==');
console.log(`dsh home : ${options.dshHome}`);
console.log(`profile  : ${options.profile}`);
console.log(`来源     : ${options.tarball !== undefined ? `归档 ${resolve(options.tarball)}` : `目录 ${resolve(options.from ?? packageRoot)}`}`);
console.log(`模式     : ${options.dryRun ? 'DRY-RUN（不写文件）' : '实际安装'}`);

if (!existsSync(profileDir)) {
  console.error(`\n错误：找不到 profile 目录 ${profileDir}`);
  console.error('多半是 --dsh-home 指错了地方（setup.exe 装的 DSH 未必用 ~/.dsh）。');
  console.error('跑 `node tools/doctor.mjs` 会打印宿主实际使用的 home，并给出修复命令。');
  process.exit(1);
}

const { root, cleanup } = stageSource(options);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageName = pkg.name;
const rowId = options.rowId ?? deriveRowId(packageName);
const targetDir = join(profilesRoot, 'node_modules', packageName);

console.log(`包       : ${packageName}@${pkg.version}`);
console.log(`安装到   : ${targetDir}`);
console.log(`补丁行   : ${rowId} / '${packageName}'`);

// 步骤 1：离线契约自检（在源目录上跑，不写文件）
if (options.skipContract) {
  console.log('\n[1/4] 跳过契约自检');
} else {
  const verifier = join(root, 'tools', 'verify.mjs');
  if (!existsSync(verifier)) {
    console.log('\n[1/4] 源中不含 tools/verify.mjs，跳过契约自检');
  } else {
    console.log('\n[1/4] 离线契约自检');
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [verifier], { stdio: 'inherit', cwd: root });
    if (result.status !== 0) {
      console.error(`\n契约自检未通过（退出码 ${result.status}），已中止安装。`);
      process.exit(1);
    }
  }
}

// 步骤 2：拷贝包文件
const files = collectInstallFiles(root);
if (options.dryRun) {
  console.log(`\n[2/4] DRY-RUN 将写入 ${files.length} 个文件到 ${targetDir}`);
} else {
  mkdirSync(targetDir, { recursive: true });
  for (const file of files) {
    const target = join(targetDir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  console.log(`\n[2/4] 已写入 ${files.length} 个文件到 ${targetDir}`);
  for (const file of files) console.log(`        ${file}`);

  // ★ 这一步是血的教训：装进一个**没被使用过**的 home 时，插件永远不会生效，
  //   而现场表现只是「页签不出现」—— 与「没重启」几乎一样，极难分辨。
  //   所以这里用「sessions/ 是否最近有活动」当作"这个 home 是不是活的"的旁证，当场提醒。
  const sessionsDir = join(options.dshHome, 'sessions');
  let newest = 0;
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        const info = statSync(full);
        if (info.mtimeMs > newest) newest = info.mtimeMs;
        if (entry.isDirectory()) walk(full, depth - 1);
      } catch {
        /* 单个条目读不到就跳过 */
      }
    }
  };
  walk(sessionsDir, 2);
  if (newest === 0) {
    console.log('');
    console.log('  ⚠ 注意：这个 home 下没有 sessions/（没有任何会话记录）。');
    console.log('    如果 DSH 用的是**另一个 home**，插件不会生效 —— 页签不会出现，');
    console.log('    而且症状和「没重启」几乎一样。确认办法：');
    console.log('      node tools/doctor.mjs        （会打印宿主实际使用的 home）');
    console.log('    若是另一个：node tools/install.mjs --dsh-home "<那个 home>"');
  } else {
    const ageHours = (Date.now() - newest) / 3600000;
    if (ageHours > 24) {
      console.log('');
      console.log(`  ⚠ 注意：这个 home 最近一次会话活动是 ${Math.round(ageHours)} 小时前。`);
      console.log('    如果 DSH 现在用的是**另一个 home**，插件不会生效。');
      console.log('    确认办法：node tools/doctor.mjs');
    }
  }
}

// 步骤 3：补丁层插入宿主行
//
// 补丁层不存在时**自己建一个**，而不是报错退出。
// 某些安装方式（例如 setup.exe）建出来的 profile 里没有 cordis.patch.yml；旧版本在这里
// 硬失败，报错只有一句「找不到补丁层」，完全没提示「新建即可」—— 于是卡死在这里，
// 而现场表现只是「页签不出现」。这个文件是 DSH 文档化的标准格式：顶层一个 YAML 数组。
if (!existsSync(patchPath)) {
  if (options.dryRun) {
    console.log(`\n[3/4] DRY-RUN 将新建补丁层 ${patchPath} 并写入宿主行 '${rowId}'`);
  } else {
    const header = [
      '# Your patch layer for this dsh profile, applied after every bundle layer:',
      '# a top-level YAML array of loader patch entries (id-targeted config',
      '# overrides, disables, and insert lists; `!!js` expressions allowed).',
      '#',
      '# This file was created by the dsh-client-ui-workbench installer because the',
      '# profile had none. Delete this whole file to restore the previous state.',
    ].join('\n');
    writeFileSync(patchPath, `${header}\n${patchBlock(rowId, packageName)}`, { encoding: 'utf8' });
    console.log(`\n[3/4] 这个 profile 原本没有补丁层，已新建 ${patchPath}`);
    console.log(`      并写入宿主行 '${rowId}' -> '${packageName}'`);
  }
}

const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
if (patchText.includes(`'${packageName}'`) || patchText.includes(`"${packageName}"`)) {
  console.log(`\n[3/4] 补丁层已引用 '${packageName}'，保持不变`);
} else if (options.dryRun) {
  console.log(`\n[3/4] DRY-RUN 将向 ${patchPath} 追加宿主行 '${rowId}'`);
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${patchPath}.${stamp}.bak`;
  cpSync(patchPath, backupPath);
  const suffix = patchText.endsWith('\n') ? '' : '\n';
  writeFileSync(patchPath, `${patchText}${suffix}${patchBlock(rowId, packageName)}`, { encoding: 'utf8' });
  console.log(`\n[3/4] 已备份补丁层 -> ${backupPath}`);
  console.log(`      已追加宿主行 '${rowId}' -> '${packageName}'`);
}

// 步骤 4：验证启动图（软检查：宿主没起不算安装失败）
if (options.skipVerify) {
  console.log('\n[4/4] 跳过启动图验证');
} else if (options.dryRun) {
  console.log('\n[4/4] DRY-RUN 跳过启动图验证');
} else {
  console.log(`\n[4/4] 验证启动图（${options.webUrl}）`);

  const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

  // 鉴权感知的探测：cookie jar 与重定向跟随都在 tools/lib/http.mjs 里，
  // 和 tools/probe.mjs 共用同一份实现（见该文件顶部关于 dsh-webui-auth 的说明）。
  const cookieJar = createCookieJar();
  const fetchIndex = async () => (await fetchIndexHtml(options.webUrl)).html;

  /**
   * 再触发一次补丁层文件变更。
   *
   * 为什么需要：补丁层是 live 重载的，但实测发现——若某个客户端 entry 之前被
   * 移除过（例如刚跑完 uninstall），紧接其后的那次补丁层写入有时不会被宿主消费：
   * 文件内容完全正确，启动图里却没有这个 entry。此时只要再改一次文件就会恢复。
   * 与其让用户去猜，不如安装器自己重试一次。
   */
  async function nudgePatchReload() {
    const current = readFileSync(patchPath, 'utf8');
    writeFileSync(patchPath, `${current}\n`, { encoding: 'utf8' });
    await sleep(1500);
    writeFileSync(patchPath, current, { encoding: 'utf8' });
    await sleep(2000);
  }

  let html = await fetchIndex();
  if (html !== null && !html.includes(`"id":"${packageName}"`)) {
    console.log('      启动图里暂时没有它；再触发一次补丁层重载后重试…');
    await nudgePatchReload();
    html = await fetchIndex();
  }

  if (html === null) {
    console.log('      跳过：拿不到首页内容（宿主没起、端口不通，或鉴权链路没走通）。');
    console.log('      这不影响安装本身；在浏览器里刷新页面确认即可，或手动复查：');
    console.log(`        (Invoke-WebRequest ${options.webUrl}).Content -match '"id":"${packageName}"'`);
  } else if (html.includes(`"id":"${packageName}"`)) {
    console.log(`      PASS  '${packageName}' 已在 window.__DSH_BOOT__ 启动图中`);
    const match = html.match(new RegExp(`"id":"${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}","url":"([^"]+)"`));
    if (match) {
      console.log(`      bundle url: ${match[1]}`);
      const probe = await fetchFollowingRedirects(options.webUrl.replace(/\/$/, '') + match[1], cookieJar);
      if (probe === null) {
        console.log('      FAIL  bundle 取不到（宿主不可达或鉴权未通过）');
      } else {
        console.log(`      ${probe.ok ? 'PASS' : 'FAIL'}  bundle 可服务：HTTP ${probe.status} ${probe.headers.get('content-type') ?? ''}`);
      }
    }
  } else {
    console.log(`      FAIL  '${packageName}' 不在启动图中（重试过一次仍未出现）。排查顺序：`);
    console.log('        1) 宿主是否还活着（看 dsh web 的 stderr）');
    console.log(`        2) package.json 的 dsh.client.platform 是否恰为 'web'`);
    console.log(`        3) exports['./client'] 是否存在且文件存在`);
    console.log('        4) 补丁层那行是否 enabled 且成功加载');
    console.log('        5) 以上都正常时重启 dsh web —— 重新引入一个曾被移除的');
    console.log('           客户端 entry 不保证能被 live 重载接住。');
  }
}

const webUrl = options.webUrl;
console.log('\n== 完成 ==');
if (options.dryRun) {
  console.log('这是 DRY-RUN，未写入任何文件。去掉 --dry-run 执行真实安装。');
} else {
  console.log('');
  console.log('★ 第一次装到一台机器上时，必须重启一次 DSH：');
  console.log('  宿主半边（index.js）是开机时加载的，它注册 /api/rpc/workbench 这条路由。');
  console.log('  不重启的话页签会出现，但每次读写都会失败（HTTP 404）—— 看起来像装坏了。');
  console.log('    · DSH 是用 setup.exe 装的：从托盘/开始菜单退出，再启动一次');
  console.log('    · DSH 是用 npm 装的：node tools/restart-host.ps1（或 powershell -File tools/restart-host.ps1）');
  console.log('');
  console.log(`然后浏览器 F5 刷新 ${webUrl}`);
  console.log('  期望：会话头部页签出现「需求执行工作台」，排在「轨迹」右边。');
  console.log('\n之后只改 lib/client.js 不需要重启宿主（~500ms 热替换）。');
  console.log('卸载：node tools/uninstall.mjs');
}
console.log('');
