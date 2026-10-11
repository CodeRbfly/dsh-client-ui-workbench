/**
 * dsh-client-ui-workbench — 安装诊断。
 *
 * 为什么需要它：`probe.mjs` 只回答「插件在不在启动图里」。答案是否定的时，
 * 后面还有两种**完全不同**的原因，而它们的修法相反：
 *
 *   A. **装错了地方** —— 安装器写进了 `%USERPROFILE%\.dsh`，但跑着的 DSH 用的是
 *      另一个 home（setup.exe 装的 DSH 尤其容易这样）。表现：启动图没有、宿主通道也 ping 不通。
 *   B. **装对了地方，但没被加载** —— 补丁层那行没被消费（例如 entry 曾被移除过），
 *      或者宿主半边已加载而浏览器半边没被发现。表现：启动图没有，但宿主通道 ping 得通。
 *
 * 这个脚本把两者分开：它枚举候选 DSH home、逐项核对包与补丁层、
 * 再去问运行中的宿主「你实际用的是哪个 home」（ping 返回的 identityPath 就是答案），
 * 最后给出**可以直接复制执行的修复命令**。
 *
 * 它是**只读**的：只读文件、只发 GET/POST 查询，不写任何东西。
 *
 * 用法：
 *   node tools/doctor.mjs
 *   node tools/doctor.mjs --web-url http://127.0.0.1:3080
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callWorkbench, fetchIndexHtml, findBootEntry } from './lib/http.mjs';
import { diagnose } from './lib/doctor-verdict.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ownName = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).name;

function parseArgs(argv) {
  const options = { webUrl: process.env.DSH_WEB_URL || 'http://127.0.0.1:3080' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--web-url') {
      options.webUrl = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--help' || argv[index] === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('\n用法: node tools/doctor.mjs [--web-url <url>]\n');
  process.exit(0);
}

const ok = (text) => `  \u2713 ${text}`;
const bad = (text) => `  \u2717 ${text}`;
const info = (label, value) => `  ${String(label).padEnd(16)}: ${value}`;

function listDirSafe(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** 目录下最新的修改时间（毫秒），用来判断哪个 home 是"活的"。 */
function newestMtime(path, depth = 2) {
  let newest = 0;
  const walk = (dir, left) => {
    const entries = listDirSafe(dir);
    if (entries === null) return;
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        const stats = statSync(full);
        if (stats.mtimeMs > newest) newest = stats.mtimeMs;
        if (entry.isDirectory() && left > 0) walk(full, left - 1);
      } catch {
        /* 单个条目读不到就跳过 */
      }
    }
  };
  walk(path, depth);
  return newest;
}

console.log(`\n== ${ownName} 安装诊断 ==\n`);

// ── 1. 候选 DSH home ────────────────────────────────────────────────────────
const candidates = [];
const pushCandidate = (path, why) => {
  if (path && !candidates.some((one) => one.path === path)) candidates.push({ path, why });
};
if (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '') {
  pushCandidate(resolve(process.env.DSH_HOME), '环境变量 DSH_HOME');
}
pushCandidate(join(homedir(), '.dsh'), '默认值 ~/.dsh');
for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.ProgramFiles]) {
  if (!base) continue;
  for (const entry of listDirSafe(base) ?? []) {
    if (!entry.isDirectory()) continue;
    if (!/deepseek|harness|dsh/i.test(entry.name)) continue;
    pushCandidate(join(base, entry.name), `扫到的 ${entry.name}`);
    pushCandidate(join(base, entry.name, '.dsh'), `扫到的 ${entry.name}\\.dsh`);
  }
}

/**
 * 在整个用户目录下找出**所有** profile。
 *
 * 为什么非这样不可：setup.exe 装的 DSH，它的 home 可能叫任何名字
 * （未必含 deepseek / harness / dsh），按名字猜就会漏掉 —— 而漏掉的表现恰恰是
 * 「诊断说找不到，可插件明明装了」。直接找 `cordis.patch.yml` 这个标志物更可靠，
 * 它与目录怎么命名无关。
 *
 * 跳过符号链接/联接点（Windows 上它们会让递归绕圈）与 node_modules（通常几万项）。
 */
function scanForProfiles(roots, maxDepth = 6, limit = 40) {
  const found = [];
  const seen = new Set();
  const add = (home, profile, patchPath) => {
    if (found.length >= limit) return;
    if (found.some((one) => one.patchPath === patchPath)) return;
    found.push({ home, profile, patchPath });
  };
  const walk = (dir, left) => {
    if (found.length >= limit || left < 0) return;
    for (const entry of listDirSafe(dir) ?? []) {
      if (found.length >= limit) return;
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '$Recycle.Bin' || entry.name === 'Windows') continue;
      const full = join(dir, entry.name);
      try {
        if (statSync(full).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const key = full.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (entry.name === 'profiles') {
        // <home>/profiles/<profile>/cordis.patch.yml —— 这里就是 home 本身
        for (const profile of listDirSafe(full) ?? []) {
          if (!profile.isDirectory()) continue;
          const patchPath = join(full, profile.name, 'cordis.patch.yml');
          if (existsSync(patchPath)) add(dir, profile.name, patchPath);
        }
        continue;
      }
      walk(full, left - 1);
    }
  };
  for (const root of roots) {
    if (root && existsSync(root)) walk(root, maxDepth);
  }
  return found;
}

console.log('[1] 候选 DSH home');
for (const candidate of candidates) {
  const profiles = join(candidate.path, 'profiles');
  const hasProfiles = existsSync(profiles);
  const fresh = hasProfiles ? newestMtime(join(candidate.path, 'sessions')) : 0;
  const activity = fresh === 0 ? '' : `   最近活动 ${new Date(fresh).toLocaleString()}`;
  console.log(hasProfiles
    ? ok(`${candidate.path}   (${candidate.why})${activity}`)
    : bad(`${candidate.path}   (${candidate.why}) — 没有 profiles\\`));
}

// 按名字猜不够：把用户目录下**所有** profile 挖出来，home 叫什么名字都能找到。
// 临时目录排除在外 —— 自检会在那里留一次性的 home，它们不是"装在哪"的候选。
const tempRoot = resolve(tmpdir()).toLowerCase();
const scannedProfilesAll = scanForProfiles([
  homedir(),
  process.env.LOCALAPPDATA,
  process.env.APPDATA,
  process.env.ProgramData,
]);
const scannedProfiles = scannedProfilesAll.filter((found) => !resolve(found.home).toLowerCase().startsWith(tempRoot));
const skippedTemp = scannedProfilesAll.length - scannedProfiles.length;
for (const found of scannedProfiles) pushCandidate(found.home, `扫到 profile ${found.profile}`);

console.log('\n[1b] 用户目录下扫到的 profile（不看目录名，只看有没有 cordis.patch.yml）');
if (scannedProfiles.length === 0) {
  console.log('  （一个都没扫到 —— 说明这台机器上还没有任何 DSH profile，或它们在别的盘上）');
}
for (const found of scannedProfiles) {
  const fresh = newestMtime(join(found.home, 'sessions'));
  const activity = fresh === 0 ? '（该 home 下没有 sessions，多半不是活的）' : `最近活动 ${new Date(fresh).toLocaleString()}`;
  const patch = readFileSync(found.patchPath, 'utf8');
  const referenced = patch.includes(`'${ownName}'`) || patch.includes(`"${ownName}"`);
  console.log(`  home: ${found.home}`);
  console.log(`    profile ${found.profile}   ${activity}`);
  console.log(referenced
    ? ok(`补丁层引用了 ${ownName}`)
    : bad(`补丁层**没有**引用 ${ownName}  ← 如果你装的是这个 home，请检查安装是否真的写成了`));
}
if (skippedTemp > 0) console.log(`  （另有 ${skippedTemp} 个在临时目录里的 profile 已忽略）`);

/** 一个 home 的明细。 */
function inspect(homePath) {
  const profilesRoot = join(homePath, 'profiles');
  const profiles = (listDirSafe(profilesRoot) ?? []).filter((entry) => entry.isDirectory());
  const detail = [];
  for (const profile of profiles) {
    const patchPath = join(profilesRoot, profile.name, 'cordis.patch.yml');
    if (!existsSync(patchPath)) continue;
    const patch = readFileSync(patchPath, 'utf8');
    detail.push({
      name: profile.name,
      patchPath,
      referenced: patch.includes(`'${ownName}'`) || patch.includes(`"${ownName}"`),
      disabled: new RegExp(`id:\\s*${ownName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,200}?disabled:\\s*true`).test(patch),
    });
  }
  const pkgDir = join(profilesRoot, 'node_modules', ownName);
  const pkg = existsSync(pkgDir)
    ? {
      dir: pkgDir,
      index: existsSync(join(pkgDir, 'index.js')),
      client: existsSync(join(pkgDir, 'lib', 'client.js')),
      manifest: existsSync(join(pkgDir, 'package.json')),
    }
    : null;
  return { profiles: detail, pkg };
}

const inspected = [];
console.log('\n[2] 各 home 的明细');
for (const candidate of candidates) {
  if (!existsSync(join(candidate.path, 'profiles'))) continue;
  const detail = inspect(candidate.path);
  inspected.push({ home: candidate.path, ...detail });
  console.log(`  ${candidate.path}`);
  if (detail.profiles.length === 0) console.log('    （没有带 cordis.patch.yml 的 profile）');
  for (const profile of detail.profiles) {
    console.log(profile.referenced
      ? ok(`profile ${profile.name}：补丁层引用了 ${ownName}${profile.disabled ? '（但被 disabled: true 关掉了！）' : ''}`)
      : bad(`profile ${profile.name}：补丁层**没有**引用 ${ownName}`));
  }
  if (detail.pkg === null) {
    console.log(bad(`包目录不存在：profiles\\node_modules\\${ownName}`));
  } else {
    const missing = ['index', 'client', 'manifest'].filter((key) => detail.pkg[key] !== true);
    console.log(missing.length === 0
      ? ok(`包已安装，且 index.js / lib\\client.js / package.json 都在`)
      : bad(`包目录在，但缺少：${missing.join(', ')}`));
  }
}

// ── 3. 运行中的宿主 ────────────────────────────────────────────────────────
console.log(`\n[3] 运行中的宿主 (${options.webUrl})`);
const { html, reason } = await fetchIndexHtml(options.webUrl);
let bootPresent = null;
if (html === null) {
  console.log(bad(`取不到首页：${reason}`));
} else {
  bootPresent = findBootEntry(html, ownName).present;
  const total = [...new Set([...html.matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]))].length;
  console.log(bootPresent === true
    ? ok(`启动图命中（启动图共 ${total} 个 entry）`)
    : bad(`启动图**未命中**（启动图共 ${total} 个 entry）`));
}

const ping = await callWorkbench(options.webUrl, 'ping');
let hostHome = null;
if (ping.ok) {
  const value = ping.value ?? {};
  console.log(ok('宿主通道 /api/rpc/workbench：ping 成功'));
  console.log(info('工作区根', `${value.workbenchRoot ?? '(未返回)'}   ← 无会话时的回落值`));
  if (typeof value.identityPath === 'string' && value.identityPath !== '') {
    // <home>\workbench\identity.json —— 这一行就是"运行中的宿主到底用哪个 home"的铁证
    hostHome = dirname(dirname(value.identityPath));
    console.log(info('身份文件', value.identityPath));
    console.log(info('=> 宿主的 home', hostHome));
  }
} else {
  console.log(bad(`宿主通道 ping 失败：${ping.reason ?? '未知原因'}`));
  if (ping.error) console.log(`      ${ping.error.code}: ${ping.error.message}`);
}

// ── 4. 结论 ────────────────────────────────────────────────────────────────
console.log('\n[4] 结论');
const verdict = diagnose({
  hostHome,
  pingOk: ping.ok === true,
  bootPresent,
  homesWithPackage: inspected.filter((one) => one.pkg !== null).map((one) => one.home),
  anyReferenced: inspected.some((one) => one.profiles.some((profile) => profile.referenced)),
  packageDir: inspected.find((one) => one.pkg !== null)?.pkg?.dir ?? null,
  packageName: ownName,
});
console.log(`  ${verdict.title}`);
for (const line of verdict.lines) console.log(line);
console.log('');
process.exit(verdict.code === 'ok' ? 0 : 1);
