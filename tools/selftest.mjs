/**
 * dsh-client-ui-workbench — 离线安装路径的端到端自测。
 *
 * 这是 CI 的主力测试。它**不需要 DSH、不需要网络、不需要 npm**，
 * 在一个临时目录里伪造一个 DSH home，然后把真实的安装/卸载脚本跑一遍：
 *
 *   打包 → 从归档安装 → 断言 → 重复安装（幂等）→ 卸载 → 断言
 *        → 从目录安装 → 断言 → 卸载 → 断言
 *
 * 重点验证三件事：
 *   1. 离线归档确实能装起来（文件落到正确位置）。
 *   2. 补丁层的外科手术**不会误伤别人家的宿主行**。
 *   3. 安装/卸载都是幂等的。
 *
 * 用法：
 *   node tools/selftest.mjs
 * 退出码 0 = 全部通过。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const packageName = pkg.name;

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

/** 用 inherit 而不是 pipe：沙箱下 piped stdio 会 EPERM，inherit 才是允许的形态。 */
function run(scriptRelativePath, args) {
  const result = spawnSync(process.execPath, [join(packageRoot, scriptRelativePath), ...args], {
    stdio: 'inherit',
    cwd: packageRoot,
  });
  if (result.error !== undefined) throw result.error;
  return result.status;
}

/**
 * 异步版本。给"安装器需要回连一个本地 HTTP 服务"的那一步用：
 * spawnSync 会阻塞事件循环，父进程就没法应答子进程的请求，必然死锁。
 */
function runAsync(scriptRelativePath, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(packageRoot, scriptRelativePath), ...args], {
      stdio: 'inherit',
      cwd: packageRoot,
    });
    child.on('error', reject);
    child.on('close', (code) => { resolvePromise(code); });
  });
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-workbench-selftest-'));
const dshHome = join(scratch, 'dsh-home');
const profileDir = join(dshHome, 'profiles', 'web');
const patchPath = join(profileDir, 'cordis.patch.yml');
const installedDir = join(dshHome, 'profiles', 'node_modules', packageName);

/** 一个"别人家的"宿主行：用来证明补丁层手术不会误伤无关内容。 */
const FOREIGN_ROW = [
  '# 别人家的插件（自测期间必须始终存在）',
  '- insert:',
  '    - id: someone-else',
  "      name: 'someone-else-plugin'",
  '',
].join('\n');

console.log(`\n== ${packageName} 离线安装端到端自测 ==`);
console.log(`临时 DSH home: ${dshHome}\n`);

try {
  // ── 准备 ──────────────────────────────────────────────────────────────
  console.log('[0] 准备临时 DSH home');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(patchPath, `# fake profile patch layer\n${FOREIGN_ROW}`, 'utf8');
  check('临时补丁层已创建', existsSync(patchPath));

  // ── 打包 ──────────────────────────────────────────────────────────────
  console.log('\n[1] 构建离线归档');
  const packStatus = run('tools/pack-offline.mjs', []);
  check('pack-offline.mjs 退出码为 0', packStatus === 0, `实际 ${packStatus}`);
  const archivePath = join(packageRoot, 'dist', `${packageName}-${pkg.version}.tgz`);
  check('归档已生成', existsSync(archivePath), archivePath);
  check('SHA256SUMS.txt 已生成', existsSync(join(packageRoot, 'dist', 'SHA256SUMS.txt')));

  // ── 从归档安装 ────────────────────────────────────────────────────────
  console.log('\n[2] 从离线归档安装');
  const installStatus = run('tools/install.mjs', [
    '--tarball', archivePath,
    '--dsh-home', dshHome,
    '--profile', 'web',
    '--skip-verify',
  ]);
  check('install.mjs 退出码为 0', installStatus === 0, `实际 ${installStatus}`);
  check('宿主半边已落地', existsSync(join(installedDir, 'index.js')));
  check('浏览器半边已落地', existsSync(join(installedDir, 'lib', 'client.js')));
  check('包清单已落地', existsSync(join(installedDir, 'package.json')));

  const afterInstall = readFileSync(patchPath, 'utf8');
  check('补丁层已含本插件的宿主行', afterInstall.includes(`'${packageName}'`));
  check('补丁层仍含别人家的宿主行（未误伤）', afterInstall.includes("'someone-else-plugin'"));
  check('补丁层带 managed 哨兵', afterInstall.includes('>>> dsh-client-ui-workbench'));

  // ── 幂等 ──────────────────────────────────────────────────────────────
  console.log('\n[3] 重复安装（幂等）');
  const reinstallStatus = run('tools/install.mjs', [
    '--tarball', archivePath,
    '--dsh-home', dshHome,
    '--profile', 'web',
    '--skip-verify',
  ]);
  check('第二次安装退出码为 0', reinstallStatus === 0, `实际 ${reinstallStatus}`);
  const afterReinstall = readFileSync(patchPath, 'utf8');
  const occurrences = afterReinstall.split(`'${packageName}'`).length - 1;
  check('宿主行没有被重复插入', occurrences === 1, `出现 ${occurrences} 次`);

  // ── 卸载 ──────────────────────────────────────────────────────────────
  console.log('\n[4] 卸载（从归档装的）');
  const uninstallStatus = run('tools/uninstall.mjs', ['--dsh-home', dshHome, '--profile', 'web']);
  check('uninstall.mjs 退出码为 0', uninstallStatus === 0, `实际 ${uninstallStatus}`);
  check('包目录已删除', !existsSync(installedDir));

  const afterUninstall = readFileSync(patchPath, 'utf8');
  check('补丁层已移除本插件的宿主行', !afterUninstall.includes(`'${packageName}'`));
  check('补丁层仍含别人家的宿主行（未误伤）', afterUninstall.includes("'someone-else-plugin'"));
  check('managed 哨兵已一并清除', !afterUninstall.includes('>>> dsh-client-ui-workbench'));
  check('补丁层仍是合法 YAML 形态（以 - insert: 起始块）', /^-\s/m.test(afterUninstall) || afterUninstall.trim() === '# fake profile patch layer');

  // ── 从目录安装 ────────────────────────────────────────────────────────
  console.log('\n[5] 从目录安装（开发路径）');
  const dirInstallStatus = run('tools/install.mjs', [
    '--from', packageRoot,
    '--dsh-home', dshHome,
    '--profile', 'web',
    '--skip-verify',
  ]);
  check('install.mjs --from 退出码为 0', dirInstallStatus === 0, `实际 ${dirInstallStatus}`);
  check('宿主半边已落地', existsSync(join(installedDir, 'index.js')));
  check('浏览器半边已落地', existsSync(join(installedDir, 'lib', 'client.js')));

  // ── DRY-RUN 不写文件 ──────────────────────────────────────────────────
  console.log('\n[6] DRY-RUN 不产生副作用');
  const beforeDryRun = readFileSync(patchPath, 'utf8');
  const dryRunStatus = run('tools/install.mjs', ['--from', packageRoot, '--dsh-home', dshHome, '--profile', 'web', '--skip-verify', '--dry-run']);
  check('DRY-RUN 退出码为 0', dryRunStatus === 0, `实际 ${dryRunStatus}`);
  check('DRY-RUN 未改动补丁层', readFileSync(patchPath, 'utf8') === beforeDryRun);

  // ── 启动图探测：鉴权链路 + 自动重试 ────────────────────────────────────
  // 两件事一起验：
  //   1. 假宿主复刻 dsh-webui-auth 的鉴权链（302 → 带 token → 303 → Set-Cookie）。
  //      Node 的 fetch 不保存 cookie，只有安装器自己实现了 cookie jar 才走得通。
  //   2. 第 1 次"已认证正文"故意不含本插件，模拟补丁层写入没被 live 重载消费。
  //      只有安装器真的走了 nudge + 重试，最终才会拿到含本插件的正文。
  console.log('\n[7] 启动图探测：鉴权链路 + 自动重试');
  const AUTH_COOKIE = 'dsh-auth-selftest';
  let totalRequests = 0;
  let contentRequests = 0;
  const fakeHost = createServer((request, response) => {
    totalRequests += 1;
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const authenticated = String(request.headers.cookie ?? '').includes(`${AUTH_COOKIE}=ok`);

    if (!authenticated) {
      if (url.searchParams.has('token')) {
        response.writeHead(303, { location: '/', 'set-cookie': `${AUTH_COOKIE}=ok; Path=/; HttpOnly` });
        response.end();
        return;
      }
      response.writeHead(302, { location: `/?token=selftest-${totalRequests}` });
      response.end();
      return;
    }

    contentRequests += 1;
    const body = contentRequests === 1
      ? '<html><body>no client entry here yet</body></html>'
      : `<html><body>{"id":"${packageName}","url":"/plugins/??${packageName}/client.js&rev=selftest"}</body></html>`;
    response.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise((listening) => fakeHost.listen(0, '127.0.0.1', listening));
  const fakeHostUrl = `http://127.0.0.1:${fakeHost.address().port}`;
  try {
    const status = await runAsync('tools/install.mjs', [
      '--from', packageRoot,
      '--dsh-home', dshHome,
      '--profile', 'web',
      '--web-url', fakeHostUrl,
    ]);
    check('开启启动图验证的安装退出码为 0', status === 0, `实际 ${status}`);
    check('鉴权重定向链被走通（cookie jar 生效）', contentRequests >= 1,
      `假宿主返回正文 ${contentRequests} 次，总请求 ${totalRequests} 次`);
    check('第 1 次未命中后自动重试了', contentRequests >= 2,
      `假宿主只返回正文 ${contentRequests} 次`);
    check('安装结果仍然正确', existsSync(join(installedDir, 'lib', 'client.js')));
  } finally {
    await new Promise((closed) => fakeHost.close(closed));
  }

  // ── 收尾卸载 ──────────────────────────────────────────────────────────
  console.log('\n[8] 最终卸载');
  const finalStatus = run('tools/uninstall.mjs', ['--dsh-home', dshHome, '--profile', 'web']);
  check('卸载退出码为 0', finalStatus === 0, `实际 ${finalStatus}`);
  check('包目录已删除', !existsSync(installedDir));
  check('补丁层已干净', !readFileSync(patchPath, 'utf8').includes(`'${packageName}'`));

  // ── 仍能通过契约自检 ──────────────────────────────────────────────────
  console.log('\n[9] 契约自检仍然通过');
  const verifyStatus = run('tools/verify.mjs', []);
  check('verify.mjs 退出码为 0', verifyStatus === 0, `实际 ${verifyStatus}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
if (failures === 0) {
  console.log('离线安装端到端自测全部通过。\n');
  process.exit(0);
} else {
  console.log(`${failures} 项失败。\n`);
  process.exit(1);
}
