/**
 * dsh-client-ui-workbench — 从命令行调用宿主通道。
 *
 * 存在的意义：工作台的所有磁盘操作都走 `/api/rpc/workbench`。有了这个调用器，
 * 就能在**不打开浏览器**的情况下验证每一个 op——排查问题时这是最省事的路子，
 * 也让存储层可以被脚本化测试。
 *
 * 它会自己处理鉴权（cookie jar + 有界重定向跟随，见 tools/lib/http.mjs），
 * 所以挂着 dsh-webui-auth 也能用。
 *
 * 用法：
 *   node tools/rpc.mjs ping
 *   node tools/rpc.mjs ensureLayout
 *   node tools/rpc.mjs nextRequirementId
 *   node tools/rpc.mjs listRequirements
 *   node tools/rpc.mjs createRequirement --args '{"id":"XQ20260917-0001","title":"示例需求"}'
 *   node tools/rpc.mjs createRequirement --args-file args.json
 *   node tools/rpc.mjs readText --args '{"id":"XQ20260917-0001","path":"requirement.json"}'
 *   node tools/rpc.mjs writeText --args '{"id":"XQ20260917-0001","path":"需求/notes.md","text":"hi"}'
 *   node tools/rpc.mjs listDir --args '{"id":"XQ20260917-0001"}'
 *
 * 注意 Windows PowerShell 5.1：把带引号的 JSON 直接写在命令行上会被 shell 吃掉引号，
 * 那种情况下用 `--args-file`。
 *
 * 退出码：0 = ok:true，1 = ok:false 或参数错误，2 = 连不上宿主。
 */
import { readFileSync } from 'node:fs';
import { callWorkbench } from './lib/http.mjs';

const HELP = `
用法: node tools/rpc.mjs <op> [--args <json> | --args-file <path>] [--session <id>] [--web-url <url>]

  <op>              工作台操作名（ping / ensureLayout / listRequirements /
                    nextRequirementId / createRequirement / archiveRequirement /
                    restoreRequirement / readRequirement / writeRequirement /
                    readText / writeText / writeBinary / listDir / remove /
                    readIdentity / writeIdentity）
  --args <json>     payload.args —— 操作的参数对象，例如 '{"id":"XQ20260917-0001"}'
  --args-file <p>   同上，但从文件读 JSON（Windows PowerShell 下更可靠）
  --payload <json>  payload 顶层的其它字段（不是 args），例如 '{"includeArchived":true}'
  --payload-file <p> 同上，但从文件读 JSON
  --session <id>    指定会话（决定工作区根）；省略时宿主回落到 sandboxPolicy 的工作区根
  --web-url <url>   DSH web 地址，默认 $DSH_WEB_URL 或 http://127.0.0.1:3080
  --raw             只输出 value 的 JSON，方便管道
`;

function parseArgs(argv) {
  const options = {
    op: undefined,
    args: {},
    payload: {},
    sessionId: undefined,
    webUrl: process.env.DSH_WEB_URL || 'http://127.0.0.1:3080',
    raw: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--raw') { options.raw = true; continue; }
    if (arg === '--args' || arg === '--args-file' || arg === '--payload' || arg === '--payload-file'
      || arg === '--session' || arg === '--web-url') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--args' || arg === '--args-file' || arg === '--payload' || arg === '--payload-file') {
        const text = arg.endsWith('-file') ? readFileSync(value, 'utf8') : value;
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new Error(`${arg} is not valid JSON: ${error.message}`);
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(`${arg} must be a JSON object`);
        }
        if (arg.startsWith('--payload')) Object.assign(options.payload, parsed);
        else options.args = parsed;
      } else if (arg === '--session') {
        options.sessionId = value;
      } else {
        options.webUrl = value;
      }
      continue;
    }
    if (options.op === undefined) { options.op = arg; continue; }
    throw new Error(`unexpected argument: ${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help || options.op === undefined) {
  console.log(HELP);
  process.exit(options.help ? 0 : 1);
}

// 顶层字段要和 `args` 分开：客户端把 op 之外的入参直接摊在 payload 顶层
// （见 lib/client.js 的 callWorkbench），例如 listRequirements 读的是
// payload.includeArchived 而不是 payload.args.includeArchived。
const payload = Object.assign({ args: options.args }, options.payload);
if (options.sessionId !== undefined) payload.sessionId = options.sessionId;

const result = await callWorkbench(options.webUrl, options.op, payload);

if (!result.ok) {
  if (result.reason === '宿主不可达') {
    console.error(`无法连接 ${options.webUrl} —— 宿主没在跑？`);
    process.exit(2);
  }
  console.error(`op ${options.op} 失败：${result.reason ?? '未知'}`);
  if (result.error !== undefined && result.error !== null) {
    console.error(`  ${result.error.code}: ${result.error.message}`);
  }
  if (typeof result.text === 'string' && result.text !== '') {
    console.error(`  ${result.text.slice(0, 400)}`);
  }
  process.exit(1);
}

if (options.raw) {
  console.log(JSON.stringify(result.value));
} else {
  console.log(`op ${options.op} 成功`);
  console.log(JSON.stringify(result.value, null, 2));
}
process.exit(0);
