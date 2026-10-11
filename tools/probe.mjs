/**
 * dsh-client-ui-workbench — 启动图探测。
 *
 * 回答一个问题：**宿主是否已经把这个客户端插件编进了 window.__DSH_BOOT__？**
 * 不需要浏览器，也不需要在页面里翻 DevTools。
 *
 * 它是鉴权感知的：DSH 的 web 端可能挂着鉴权插件（如 dsh-webui-auth），
 * 未认证请求会走 302 → 303 + Set-Cookie 的链路。Node 的 fetch 默认不保存
 * cookie，直接用 `fetch(url, { redirect: 'follow' })` 会掉进重定向环并抛
 * `redirect count exceeded`——把「需要登录」误报成「连不上宿主」。
 * 这里复用 tools/lib/http.mjs 的 cookie jar 走通该链路。
 *
 * 用法：
 *   node tools/probe.mjs                        # 探测本插件
 *   node tools/probe.mjs --list                 # 顺带列出启动图里全部 entry
 *   node tools/probe.mjs --package <name>       # 探测别的包
 *   node tools/probe.mjs --web-url <url>
 *
 * 退出码：
 *   0 = 已在启动图中，且宿主通道 /api/rpc/workbench 的 ping 成功
 *   1 = 宿主在跑，但启动图里没有这个 entry（或 bundle 取不到）
 *   2 = 宿主不可达，或拿不到首页内容
 *   3 = 启动图正常，但宿主通道 ping 失败（多半是 host 半边改动后没有重启 dsh web）
 */
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  callWorkbench,
  createCookieJar,
  fetchFollowingRedirects,
  fetchIndexHtml,
  findBootEntry,
} from './lib/http.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ownName = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).name;

function parseArgs(argv) {
  const options = {
    webUrl: process.env.DSH_WEB_URL || 'http://127.0.0.1:3080',
    packageName: ownName,
    list: false,
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
      case '--web-url': options.webUrl = next(); break;
      case '--package': options.packageName = next(); break;
      case '--list': options.list = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('\n用法: node tools/probe.mjs [--web-url <url>] [--package <name>] [--list]\n');
  process.exit(0);
}

console.log(`\n探测 ${options.webUrl}`);
console.log(`目标 entry: ${options.packageName}\n`);

const { html, reason } = await fetchIndexHtml(options.webUrl);
if (html === null) {
  console.log(`  无法获取首页内容：${reason}`);
  console.log('  排查：宿主是否在跑（dsh web）、端口是否正确、是否需要先在浏览器登录。\n');
  process.exit(2);
}

const entries = [...new Set([...html.matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]))];
if (options.list) {
  console.log(`  启动图共 ${entries.length} 个 entry：`);
  for (const id of entries) console.log(`    ${id}`);
  console.log('');
}

const { present, url } = findBootEntry(html, options.packageName);
let bundleOk = true;
if (present) {
  console.log(`  命中：'${options.packageName}' 已在启动图中`);
  if (url !== null) {
    console.log(`  bundle url: ${url}`);
    const probe = await fetchFollowingRedirects(options.webUrl.replace(/\/$/, '') + url, createCookieJar());
    if (probe === null) {
      console.log('  bundle：取不到（鉴权未通过或连接中断）');
      bundleOk = false;
    } else {
      console.log(`  bundle：HTTP ${probe.status} ${probe.headers.get('content-type') ?? ''}`
        + (probe.ok ? '' : '  ← 期望 200'));
      bundleOk = probe.ok;
    }
  }
} else {
  bundleOk = false;
  console.log(`  未命中：'${options.packageName}' 不在启动图中。`);
  // ★ 这里**不再退出**。宿主通道那次探测恰恰是最需要的信息：
  //   它把「未命中」分成两种原因，而两者的修法相反 ——
  //   ping 通 = 装对了、只是没被加载（重启即可）；ping 不通 = 多半装错了 home（要重装）。
  //   早期版本在这里就 exit 了，于是最关键的一行永远看不到。
  console.log('');
  console.log('  ★ 先看下面的宿主通道探测 —— 它会把原因分成两种，修法相反：');
  console.log('      ping 通   → 装对了，只是没被加载（重启 DSH 即可）');
  console.log('      ping 不通 → 多半装到了另一个 DSH home（setup.exe 装的 DSH 未必用 ~/.dsh）');
  console.log('    想要一步到位：node tools/doctor.mjs');
}

// ── 宿主通道 ────────────────────────────────────────────────────────────────
// 浏览器读不到磁盘，工作台的文件读写全靠宿主半边的 /api/rpc/workbench。
// 这条 ping 同时验证四件事：宿主半边已激活、精确路由已注册、鉴权自动继承、
// 线协议信封正确。
console.log('\n宿主通道 /api/rpc/workbench');
const ping = await callWorkbench(options.webUrl, 'ping');
let rpcOk = false;
if (ping.ok) {
  rpcOk = true;
  const value = ping.value ?? {};
  console.log('  PASS  ping 成功');
  console.log(`        工作区根   : ${value.workbenchRoot ?? '(未返回)'}`);
  console.log('                     （这里没带 sessionId，所以是**无会话时的回落值**；'
    + '页面实际读写的目录由会话 cwd 决定，两者不一定是同一个）');
  console.log(`        固定目录   : ${value.workbenchRootRelative ?? '(未返回)'}`);
  console.log(`        阶段目录   : ${(value.stages ?? []).join(' / ') || '(未返回)'}`);
  console.log(`        模板目录   : ${(value.templateDirs ?? []).join(' / ') || '(未返回)'}`);
  // 归档方式能一眼看出宿主半是否已刷新：旧版会返回 historyDir（搬目录），
  // 新版返回 archiveMode:'flag'。这一行省得为了确认重启成功去翻源码。
  const archive = value.archiveMode === 'flag'
    ? `标记（${value.archiveField ?? '?'}），目录不搬家`
    : (value.archiveMode ?? (value.historyDir === undefined ? '(未返回)' : `旧版：搬进 ${value.historyDir}/（宿主未重启）`));
  console.log(`        归档方式   : ${archive}`);
  // 通知表落在用户数据目录（每人一份）。旧宿主不会返回这个字段。
  console.log(`        通知表     : ${value.noticesPath ?? '(未返回：宿主未重启，提醒仍写在共享文件里)'}`);
  console.log(`        身份文件   : ${value.identityPath ?? '(未返回)'}`);
  if (value.pong !== true) {
    rpcOk = false;
    console.log('  FAIL  返回里没有 pong:true');
  }
} else {
  console.log(`  FAIL  ${ping.reason ?? '未知原因'}`);
  if (ping.error !== undefined && ping.error !== null) {
    console.log(`        ${ping.error.code}: ${ping.error.message}`);
  }
  if (ping.text !== undefined && ping.text !== '') console.log(`        ${String(ping.text).slice(0, 200)}`);
  if (ping.status === 404) {
    console.log('  404 = 这条路由根本没注册 ⇒ 宿主半边没加载（不是"重启一下就好"的那种）。');
  }
  console.log('  排查：宿主半边是否已随本次安装刷新；host 半边的改动需要重启 DSH。');
}

// ── 判定：把「未命中」分成两种，因为修法相反 ────────────────────────────────
if (!present) {
  console.log('');
  if (rpcOk) {
    console.log('  ==> 判定：宿主半边**已经加载**（ping 通），缺的只是浏览器半边没被编进启动图。');
    console.log('      最常见的原因：补丁层那行刚加、live 重载没接住。**重启 DSH** 即可。');
    console.log('      setup.exe 装的 DSH：从托盘图标 / 开始菜单退出应用，再启动一次。');
  } else {
    console.log('  ==> 判定：宿主半边**也没起来**，说明补丁层那行没有被加载。');
    console.log('      最常见的原因：装到了另一个 DSH home —— setup.exe 装的 DSH 未必用 ~/.dsh。');
    console.log('      node tools/doctor.mjs 会打印「宿主实际使用的 home」并给出修复命令。');
  }
}

console.log('');
if (!bundleOk) process.exit(1);
process.exit(rpcOk ? 0 : 3);
