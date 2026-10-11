/**
 * 构建离线安装产物。
 *
 * 输出（默认写到 dist/）：
 *   dsh-client-ui-workbench-<version>.tgz   归档，内部为 package/... 结构
 *   SHA256SUMS.txt                          校验和，在离线机器上验证完整性
 *
 * 为什么自己打 tar 而不用 `npm pack`：本产物要在**没有网络、也可能没有 npm**
 * 的机器上消费。自己打保证零外部工具依赖；结构又与 npm pack 一致，
 * 所以 `npm install -g <file>.tgz` 也能吃同一个文件。
 *
 * 归档内容 = package.json 的 `files` + npm 一定会带的 package.json / README / LICENSE。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { writeTar } from './lib/tar.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

/** npm 无论 files 怎么写都会带上的文件。 */
const ALWAYS = ['package.json', 'README.md', 'LICENSE'];

/**
 * 只进离线归档、不进 npm 包的文件。
 *
 * tools/ 让离线机器也能跑契约自检与卸载，是「离线可用」的一部分；
 * 但它不属于运行时，所以不写进 package.json 的 files（保持 npm 产物干净）。
 *
 * docs/ 与 CHANGELOG.md 同理：内网那台机器拿到的是一个解包后的目录，
 * 两个 README 都链到 `docs/storage-format.md` —— 不收它，那个链接在解包后就是死的，
 * 而那份文档恰恰是「团队该怎么协同」的正本（谁写哪个文件、为什么这么切）。
 */
const ARCHIVE_ONLY = ['tools', 'docs', 'CHANGELOG.md'];

/**
 * 递归列目录，跳过隐藏项与 node_modules。
 *
 * ★ 成员名一律用**正斜杠**。用 `join()` 拼出来的路径在 Windows 上是反斜杠，
 * 而 tar 的成员名是**路径**不是文件名：写成 `tools/lib\http.mjs` 之后，
 * Linux / macOS 上会解出一个**真的叫 `lib\http.mjs` 的文件**，于是
 * `tools/verify.mjs` 的 `import './lib/http.mjs'` 就找不到它了；
 * Windows 的 tar.exe 也可能直接拒绝这种名字。
 * 这个缺陷只会在**别人的机器上**才现形 —— 所以下面还有一条断言盯着它。
 */
function listDirectory(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const nested of listDirectory(absolute)) out.push(`${entry.name}/${nested}`);
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out;
}

/** 把 package.json 的 files 条目（文件或目录）展开成相对路径列表。 */
function expand(pattern) {
  const absolute = join(packageRoot, pattern);
  if (!existsSync(absolute)) return [];
  const stats = statSync(absolute);
  if (stats.isFile()) return [pattern];
  if (!stats.isDirectory()) return [];
  return listDirectory(absolute).map((file) => `${pattern}/${file}`);
}

/** 收集、去重、排序后的归档成员相对路径。 */
function collectMembers() {
  const declared = [
    ...(Array.isArray(pkg.files) ? pkg.files : []),
    ...ALWAYS,
    ...ARCHIVE_ONLY,
  ];
  const members = new Set();
  for (const pattern of declared) {
    for (const file of expand(pattern)) members.add(file);
  }
  return [...members].sort();
}

const members = collectMembers();
if (members.length === 0) throw new Error('pack-offline: no files to archive');

// 硬性要求：宿主半边与浏览器半边必须在归档里，否则装完就是白屏。
for (const required of ['package.json', 'index.js', 'lib/client.js']) {
  if (!members.includes(required)) {
    throw new Error(`pack-offline: "${required}" is missing from the archive (check package.json "files")`);
  }
}

// 归档必须先能通过契约自检：install.mjs 会在解包后的目录上跑 verify.mjs，
// 少了它需要的输入文件，安装就会（正确地）失败在中途。
if (members.some((file) => file === 'README.md' || file === 'README.zh.md')) {
  if (!members.includes('README.i18n.yaml')) {
    throw new Error(
      'pack-offline: the bilingual READMEs are archived but "README.i18n.yaml" is not; '
      + 'tools/verify.mjs records the pairing there and would fail in the extracted archive',
    );
  }
  for (const readme of ['README.md', 'README.zh.md']) {
    if (!members.includes(readme)) {
      throw new Error(`pack-offline: "${readme}" is missing; the bilingual pair must ship together`);
    }
  }
}

if (!members.some((file) => file.startsWith('tools/'))) {
  throw new Error('pack-offline: "tools/" is missing; the extracted archive could not self-verify offline');
}

// 归档成员名必须是正斜杠：它是 tar 里的**路径**，不是本机文件名。
// 一处反斜杠就能让归档在 Linux / macOS 上解出一堆名字奇怪的文件 ——
// 而打包在 Windows 上、解包在别人的机器上，这个错误自己看不见。
const backslashed = members.filter((file) => file.includes('\\'));
if (backslashed.length > 0) {
  throw new Error(`pack-offline: archive members must use forward slashes: ${backslashed.join(', ')}`);
}

// 确定性：mtime 固定，保证同样的源码打出同样的 tar 字节。
const FIXED_MTIME = 0;
const entries = members.map((file) => ({
  name: `package/${file}`,
  data: readFileSync(join(packageRoot, file)),
  mtimeSeconds: FIXED_MTIME,
}));

const tarBytes = writeTar(entries);
const gzipBytes = gzipSync(tarBytes, { level: 9, mtime: FIXED_MTIME });

const distDir = join(packageRoot, 'dist');
mkdirSync(distDir, { recursive: true });

const archiveName = `${pkg.name}-${pkg.version}.tgz`;
const archivePath = join(distDir, archiveName);
writeFileSync(archivePath, gzipBytes);

const sha256 = createHash('sha256').update(gzipBytes).digest('hex');
const sumsPath = join(distDir, 'SHA256SUMS.txt');
writeFileSync(sumsPath, `${sha256}  ${archiveName}\n`, 'utf8');

console.log('== 离线产物已生成 ==\n');
console.log(`  ${relative(packageRoot, archivePath)}  (${gzipBytes.length} bytes)`);
console.log(`  ${relative(packageRoot, sumsPath)}`);
console.log(`\n  sha256  ${sha256}`);
console.log(`  成员 ${members.length} 个：`);
for (const file of members) console.log(`    package/${file}`);
console.log('\n离线安装（目标机器无需网络、无需 npm）：');
console.log('  node tools/install.mjs --tarball dist/' + archiveName);
