/**
 * dsh-client-ui-workbench — 「浏览器实际拿到的是哪一份 bundle」检查。
 *
 * 为什么需要它：`tools/install.mjs` 退出码 0、安装目录里的文件看着也是新的，
 * **都不代表浏览器拿到的是那一份**。真实踩过一次：
 *
 *   - `install.mjs` 在复制那一步失败了，退出码 1，而我只看了一半输出、报了"已部署"；
 *   - 启动图里的 `rev` 变了（它由宿主按内容算），但我没有核对**内容**；
 *   - 于是用户刷新后看到的仍是旧 bundle，症状是"改了怎么还是不对"。
 *
 * 所以这个脚本做的是最后一公里的核对：把 `window.__DSH_BOOT__` 里本插件的 bundle
 * 用**浏览器同一条链路**（含鉴权重定向）抓下来，然后在内容里查几个标志位。
 * 抓不到时退出码 2；标志位缺失时退出码 1。
 *
 * 用法：
 *   node tools/check-bundle.mjs
 *   node tools/check-bundle.mjs --expect 'groupOptions(false),hidden: true'
 *   node tools/check-bundle.mjs --web-url http://127.0.0.1:3080
 *
 * 只依赖 Node 内置模块与 `tools/lib/http.mjs`（与 probe / install / rpc 共用一份实现）。
 */
import { createCookieJar, fetchFollowingRedirects, fetchIndexHtml } from './lib/http.mjs';

/**
 * 默认要确认在线上的标志位：它们分别代表"两处分块下拉""删除的二次确认""空占位项"。
 * 注意：标志位是**示例默认值**，真正要查什么应该用 `--expect` 传（见用法）。
 */
const DEFAULT_MARKERS = ['groupOptions(false)', 'groupOptions(true)', 'wcw-btnDanger', 'hidden: true'];

function parseArgs(argv) {
  const options = {
    webUrl: process.env.DSH_WEB_URL || 'http://127.0.0.1:3080',
    entry: 'dsh-client-ui-workbench',
    markers: DEFAULT_MARKERS,
    waitSeconds: 12,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === '--web-url') options.webUrl = next();
    else if (arg === '--entry') options.entry = next();
    else if (arg === '--expect') options.markers = next().split(',').map((one) => one.trim()).filter((one) => one !== '');
    else if (arg === '--wait') options.waitSeconds = Number(next());
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help === true) {
  console.log('用法: node tools/check-bundle.mjs [--web-url <url>] [--entry <id>] [--expect "a,b,c"] [--wait <秒>]');
  process.exit(0);
}

const base = options.webUrl.replace(/\/$/, '');
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

/**
 * 抓一次并查标志位。
 *
 * ★ **必须重试**：安装器写完文件之后，浏览器拿到的 bundle 不是立刻换的 ——
 * 宿主那侧要走一遍「发现文件变了 → 重算 revision → 发布重建帧」。
 * 实测这段延迟在秒级，于是"装完立刻查"会**假报**成"内容还是旧的"。
 * 这个假警报真的发生过两次（其中一次是真问题、另一次纯属抢跑），
 * 而假警报的代价很实在：会让人去翻安装器、翻沙箱权限，查半天发现什么都没坏。
 * 所以这里等一等、轮询到 revision 真的换了为止；只有等到超时仍然缺标志位才算失败。
 */
async function inspect() {
  const index = await fetchIndexHtml(base);
  if (index.html === null) return { hard: `拿不到首页（${base}）—— 宿主没起、端口不通，或鉴权链路没走通` };
  const escaped = options.entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`"id":"${escaped}","url":"([^"]+)"`).exec(index.html);
  if (found === null) return { hard: `'${options.entry}' 不在 window.__DSH_BOOT__ 启动图里` };
  const bundleUrl = found[1].replace(/&amp;/g, '&');
  const response = await fetchFollowingRedirects(base + bundleUrl, createCookieJar());
  if (response === null || !response.ok) {
    return { hard: `bundle 取不到（HTTP ${response === null ? '?' : response.status}）` };
  }
  const text = await response.text();
  return {
    bundleUrl,
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    length: text.length,
    missing: options.markers.filter((marker) => !text.includes(marker)),
  };
}

const deadline = Date.now() + options.waitSeconds * 1000;
let result = await inspect();
let attempt = 1;
while (result.hard === undefined && result.missing.length > 0 && Date.now() < deadline) {
  if (attempt === 1) {
    console.log(`      标志位暂时没齐（rev 还在换），等最多 ${options.waitSeconds}s 再确认…`);
  }
  await sleep(2000);
  attempt += 1;
  result = await inspect();
}

if (result.hard !== undefined) {
  console.error(`FAIL  ${result.hard}`);
  process.exit(2);
}

console.log(`entry : ${options.entry}`);
console.log(`bundle: ${result.bundleUrl}`);
console.log(`http  : ${result.status} ${result.type} · ${result.length} 字节`);
for (const marker of options.markers) {
  console.log(`  ${result.missing.includes(marker) ? 'MISS' : 'HAS '} ${marker}`);
}

if (result.missing.length > 0) {
  console.error(`\nFAIL  等了 ${options.waitSeconds}s，浏览器拿到的 bundle 里仍少 ${result.missing.length} 个标志位 —— 内容不是刚构建的那一份。`);
  console.error('     先看安装目录里的文件是不是新的（与源文件比哈希），再确认复制那一步没有报错（install.mjs 的退出码）。');
  process.exit(1);
}
console.log(`\nPASS  浏览器拿到的就是这一份（轮询 ${attempt} 次）。`);
process.exit(0);
