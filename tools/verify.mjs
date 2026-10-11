/**
 * dsh-client-ui-workbench — 离线契约自检。
 *
 * 为什么需要它：客户端 bundle 的失败模式几乎都是「运行时才炸，而且炸的是整个 GUI」。
 * 典型后果是 `web boot: N entries did not activate` → 白屏。这个脚本不碰浏览器、
 * 不碰 DSH 宿主、不写任何文件、**不联网**，只把 lib/client.js 放进 vm 沙箱跑一遍，
 * 把托管方会做的校验提前做完。
 *
 * 用法：
 *   node tools/verify.mjs
 *   npm test
 * 退出码 0 = 全部通过；1 = 有失败项。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { THEME_TOKENS } from './lib/theme-tokens.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const bundlePath = join(packageRoot, 'lib', 'client.js');
const source = readFileSync(bundlePath, 'utf8');

let failures = 0;
/** @param {string} label @param {boolean} ok @param {string} [detail] */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

console.log(`\n== ${pkg.name} 契约自检 ==`);
console.log(`package: ${pkg.name}@${pkg.version}`);
console.log(`bundle : ${bundlePath}\n`);

// ── 1. classic script：不能有顶层 import / export ────────────────────────────
// 宿主用 <script async src>（无 type="module"）加载，出现 ESM 语法会直接 SyntaxError。
console.log('[1] bundle 是 classic script');
const esmLines = source
  .split('\n')
  .map((line, index) => ({ line: line.trim(), index: index + 1 }))
  .filter(({ line }) => /^(import|export)\s/.test(line));
check('无顶层 import/export', esmLines.length === 0,
  esmLines.map(({ line, index }) => `L${index}: ${line}`).join(' | '));

// ── 2. 在沙箱里执行，捕获 __ModuleLoader__.load 注册 ────────────────────────
console.log('\n[2] bundle 注册契约');
const registrations = [];

function makeElement() {
  return {
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, removeChild() {}, remove() {},
    parentNode: null, textContent: '', dataset: {}, style: {},
    querySelector() { return null; },
  };
}

const sandbox = {
  console,
  window: { __ModuleLoader__: { load(reg) { registrations.push(reg); } } },
  document: {
    createElement: makeElement,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: makeElement(),
  },
  location: { href: '' },
  fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let loadError = null;
try {
  vm.runInContext(source, sandbox, { filename: bundlePath });
} catch (error) {
  loadError = error;
}
check('脚本执行不抛错', loadError === null, loadError === null ? '' : String(loadError));
check('恰好调用一次 __ModuleLoader__.load', registrations.length === 1,
  `实际 ${registrations.length} 次`);

if (registrations.length !== 1) {
  console.log('\n注册失败，后续检查跳过。\n');
  process.exit(1);
}

const registration = registrations[0];
check('id 逐字等于包名', registration.id === pkg.name,
  `bundle="${registration.id}" package="${pkg.name}"`);
check('factory 是函数', typeof registration.factory === 'function');

// ── 3. factory 导出契约 ────────────────────────────────────────────────────
console.log('\n[3] factory 模块导出');
// 浏览器侧由宿主注入真实 react；这里给一个足够用的桩。
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  // useState 必须吃「惰性初值」这种写法：React 允许 `useState(() => x)`，传函数时
  // 取的是**返回值**。替身不认这一手时，组件里的 form 会变成那个函数本身，
  // 取属性全是 undefined —— 冒烟照样"通过"，只是什么都没测到。
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
  Fragment: Symbol('Fragment'),
};

let moduleExports;
let factoryError = null;
try {
  moduleExports = registration.factory((spec) => {
    if (spec === 'react') return reactStub;
    throw new Error(`require("${spec}") missed the module table`);
  });
} catch (error) {
  factoryError = error;
}
check('factory 可物化', factoryError === null, factoryError === null ? '' : String(factoryError));

if (factoryError !== null) {
  console.log('\nfactory 无法物化，后续检查跳过。\n');
  process.exit(1);
}

check('导出 apply 函数', typeof moduleExports.apply === 'function');
check('导出 inject 数组', Array.isArray(moduleExports.inject),
  `实际 ${typeof moduleExports.inject}`);
check('未导出 Config（普通对象 Config 会让宿主整树加载失败）',
  moduleExports.Config === undefined, `实际 ${typeof moduleExports.Config}`);

// ── 4. apply 行为：locale 词典 + conversation.view 注册 ─────────────────────
console.log('\n[4] apply 行为');
const localeRegistrations = [];
const slotInjections = [];
const slotRegistrations = [];

const ctx = {
  effect(fn) {
    const disposer = fn();
    return () => { if (typeof disposer === 'function') disposer(); };
  },
  locale: {
    register(ns, dicts) { localeRegistrations.push({ ns, dicts }); return () => {}; },
    bind(ns) {
      return (key, params) => {
        let text = dictsFor(ns)[key];
        if (text === undefined) return key;
        if (params !== undefined) {
          text = text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
        }
        return text;
      };
    },
  },
  slots: {
    inject(slotName, callback) { slotInjections.push({ slotName, callback }); return () => {}; },
    register(options, Component) { slotRegistrations.push({ options, Component }); return () => {}; },
  },
};

function dictsFor(ns) {
  for (const entry of localeRegistrations) if (entry.ns === ns) return entry.dicts.zh;
  return {};
}

let applyError = null;
try {
  moduleExports.apply(ctx);
} catch (error) {
  applyError = error;
}
check('apply 不抛错', applyError === null, applyError === null ? '' : String(applyError));

check('注册了 locale 命名空间', localeRegistrations.length === 1);
if (localeRegistrations.length === 1) {
  const { dicts } = localeRegistrations[0];
  check('词典同时提供 zh 与 en', dicts.zh !== undefined && dicts.en !== undefined);
  const zhKeys = Object.keys(dicts.zh).sort();
  const enKeys = Object.keys(dicts.en).sort();
  const missing = zhKeys.filter((key) => !(key in dicts.en));
  const extra = enKeys.filter((key) => !(key in dicts.zh));
  check('zh/en 键集一致', missing.length === 0 && extra.length === 0,
    `en 缺 [${missing.join(',')}] zh 缺 [${extra.join(',')}]`);
  check('页签文案存在', dicts.zh['view.workbench'] === '需求执行工作台',
    `实际 ${JSON.stringify(dicts.zh['view.workbench'])}`);
  check('词典含三种阶段状态',
    ['status.pending', 'status.active', 'status.approved'].every((key) => key in dicts.zh && key in dicts.en));
}

check('只通过 slots.inject 延迟注册（未直接 register）', slotInjections.length === 1,
  `实际 ${slotInjections.length}`);
if (slotInjections.length === 1) {
  check('等待的是 conversation.view 槽位',
    slotInjections[0].slotName === 'conversation.view',
    `实际 ${slotInjections[0].slotName}`);
  slotInjections[0].callback();
}

check('完成一次 conversation.view 注册', slotRegistrations.length === 1,
  `实际 ${slotRegistrations.length}`);
if (slotRegistrations.length !== 1) {
  console.log('\n注册未完成，渲染检查跳过。\n');
  process.exit(1);
}

const { options, Component } = slotRegistrations[0];
check('页签 id = workbench', options.id === 'workbench', `实际 ${options.id}`);
check('order > 10（排在 trajectory 之后）', options.order > 10, `实际 ${options.order}`);
check('声明了 locale 命名空间', options.locale === 'workbench', `实际 ${options.locale}`);
check('label 是 thunk（可随语言切换刷新）', typeof options.label === 'function',
  `实际 ${typeof options.label}`);
if (typeof options.label === 'function') {
  const label = options.label();
  check('label 解析为「需求执行工作台」', label === '需求执行工作台', `实际 ${JSON.stringify(label)}`);
}

// cordis 服务 ← 提供它的客户端包。两边必须对齐：只写服务名而不声明提供者，
// 加载顺序就没有保证；声明了一个没人提供的包名，entry 会一直挂着。
// （这一条是被真实缺陷逼出来的：用了 sessions 却漏了它的提供者包。）
{
  const SERVICE_PACKAGES = {
    slots: '@deepseek-ai/dsh-client-ui-renderer',
    locale: '@deepseek-ai/dsh-client-locale',
    uiSession: '@deepseek-ai/dsh-client-ui-session',
    sessions: '@deepseek-ai/dsh-api-session-controller',
    conversation: '@deepseek-ai/dsh-client-ui-conversation',
  };
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const declared = manifest.dsh?.client?.inject ?? [];
  const unresolved = moduleExports.inject.filter((service) => !declared.includes(SERVICE_PACKAGES[service]));
  check('inject 的每个服务都有提供它的包声明在 package.json 里',
    unresolved.length === 0,
    unresolved.map((service) => `${service} ← ${SERVICE_PACKAGES[service] ?? '未登记'}`).join(', '));
  const unused = declared.filter((pkg) => !Object.values(SERVICE_PACKAGES).includes(pkg));
  check('package.json 里没有多声明的客户端包', unused.length === 0, unused.join(', '));
}

// ── 5. 组件渲染冒烟 ────────────────────────────────────────────────────────
console.log('\n[5] 组件渲染冒烟');
const t = ctx.locale.bind('workbench');
const sessionSnapshot = { running: true, openState: 'open', queue: [] };
const listSnapshot = {
  current: 'session-00000000-0000-0000-0000-000000000000',
  byId: {
    'session-00000000-0000-0000-0000-000000000000': {
      displayTitle: '示例需求标题',
      cwd: 'E:\\work\\demo',
    },
  },
};
const viewProps = {
  t,
  sessionId: 'session-00000000-0000-0000-0000-000000000000',
  useSession: (selector) => selector(sessionSnapshot),
  useSessions: (selector) => selector(listSnapshot),
  openView: () => {},
  viewRequest: null,
  completeViewRequest: () => {},
};

let tree = null;
let renderError = null;
try {
  tree = Component(viewProps);
} catch (error) {
  renderError = error;
}
check('组件首次渲染不抛错', renderError === null,
  renderError === null ? '' : String(renderError));

if (tree !== null) {
  const texts = [];
  (function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (typeof node !== 'object') return;
    // 函数组件必须真调用一次：只遍历 children 会漏掉所有嵌套子组件，
    // 那样冒烟测试覆盖不到 RequirementChips / PlaceholderStage 这些。
    if (typeof node.type === 'function') {
      try {
        walk(node.type(node.props));
      } catch (error) {
        texts.push(`<component crashed: ${error && error.message ? error.message : error}>`);
      }
      return;
    }
    if (Array.isArray(node.children)) for (const child of node.children) walk(child);
  })(tree);
  const joined = texts.join(' | ');

  const sample = joined.slice(0, 260);
  check('渲染出需求标题（会话 displayTitle 兜底）', joined.includes('示例需求标题'), sample);
  check('渲染出元信息行（cwd · 状态 · 运行态 · 队列）',
    joined.includes('E:\\work\\demo') && joined.includes('已就绪') && joined.includes('执行中'),
    sample);
  check('渲染出 5 个管线阶段',
    ['需求', '方案', '开发', '测试', '提版'].every((word) => joined.includes(word)),
    sample);
  check('管线卡片带阶段状态', joined.includes('未开始'), sample);
  check('渲染出需求列表入口',
    joined.includes('需求列表') && joined.includes('新建需求'), sample);
  check('等待宿主数据时显示读取中', joined.includes('读取中…'), sample);
  // 词典缺键时 t() 会原样返回 key，页面就会显示 stage.requirement 这种东西。
  // 这条断言把「漏加文案键」变成可检出的失败。
  const leaked = [...joined.matchAll(/\b(?:stage|panel|req|doc|qa|status|menu|tbd|view)\.[a-zA-Z.]+/g)]
    .map((match) => match[0])
    .filter((key) => !key.startsWith('menu.'));
  check('页面里没有未翻译的原始 key', leaked.length === 0, leaked.slice(0, 6).join(', '));
}

// ★ 会话快照的字段名换过，读不到不能把整页带走。
//   真实踩过：DSH 0.2.0（桌面版内置的版本；网页版是 0.1.5）把会话快照里的 `queue`
//   换成了 `pendingSubmissions`。插件直接写 `s.queue.length` → 在 0.2.0 上是
//   `undefined.length` → **渲染期抛错** → 被平台的 slot 错误边界接住 →
//   工作台页完全空白，而应用其余部分毫发无损（最容易被当成"没装上"）。
//   上面那份快照只模拟 0.1.5，所以这个缺陷溜了过去；这里把 0.2.0 的形状也渲染一遍，
//   并且要求计数**真的来自新字段**，而不是"读不到就当 0"糊过去。
{
  const modernSnapshot = { running: true, openState: 'open', pendingSubmissions: [{}, {}] };
  const modernProps = Object.assign({}, viewProps, {
    useSession: (selector) => selector(modernSnapshot),
  });
  let modernError = null;
  let modernTree = null;
  try {
    modernTree = Component(modernProps);
  } catch (error) {
    modernError = error;
  }
  check('会话快照没有 queue（DSH 0.2.0 的字段名）时渲染不抛错', modernError === null,
    modernError === null ? '' : String(modernError));

  const modernTexts = [];
  (function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') { modernTexts.push(String(node)); return; }
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (typeof node !== 'object') return;
    if (typeof node.type === 'function') {
      try {
        walk(node.type(node.props));
      } catch (error) {
        modernTexts.push(`<component crashed: ${error && error.message ? error.message : error}>`);
      }
      return;
    }
    if (Array.isArray(node.children)) for (const child of node.children) walk(child);
  })(modernTree);
  const modernJoined = modernTexts.join(' | ');
  check('排队计数改读 pendingSubmissions（不是静默变 0）',
    modernJoined.includes('队列 2'), modernJoined.slice(0, 200));
}

// ── 6. 基线模块依赖面 ──────────────────────────────────────────────────────
console.log('\n[6] 模块依赖面');
const BASELINE = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);
const requested = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
const offBaseline = [...new Set(requested)].filter((spec) => !BASELINE.has(spec));
check('只 require 基线模块表中的词', offBaseline.length === 0,
  `越界: ${offBaseline.join(', ')}（非基线依赖必须声明 dsh.client.external 且有供给方）`);
console.log(`        require 到的词: ${[...new Set(requested)].join(', ') || '(无)'}`);

// ── 7. 离线就绪性 ──────────────────────────────────────────────────────────
// 本插件宣称「零依赖、可离线安装」。这一节把该宣称变成可执行的断言。
console.log('\n[7] 离线就绪性');
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const peerDeps = Object.keys(pkg.peerDependencies ?? {});
const optionalDeps = Object.keys(pkg.optionalDependencies ?? {});
check('无 dependencies（装它不需要下载任何东西）', runtimeDeps.length === 0,
  `实际: ${runtimeDeps.join(', ')}`);
check('无 peerDependencies（npm 不会尝试补装）', peerDeps.length === 0,
  `实际: ${peerDeps.join(', ')}`);
check('无 optionalDependencies', optionalDeps.length === 0,
  `实际: ${optionalDeps.join(', ')}`);

// 安装/打包脚本自身也只能用 Node 内置模块，否则离线机器上跑不起来。
// 安装/打包脚本自身也只能用 Node 内置模块，否则离线机器上跑不起来。
// 动态扫描 tools/ 下的全部 .mjs，新增脚本自动纳入检查。
const toolingFiles = (function collect(dir, prefix = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collect(join(dir, entry.name), relative));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(`tools/${relative}`);
  }
  return out;
})(join(packageRoot, 'tools'));

const foreignImports = [];
for (const file of toolingFiles) {
  const text = readFileSync(join(packageRoot, file), 'utf8');
  for (const match of text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
    const spec = match[1];
    if (spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')) continue;
    foreignImports.push(`${file} -> ${spec}`);
  }
}
check('工具脚本只依赖 Node 内置模块', foreignImports.length === 0, foreignImports.join(', '));
console.log(`        扫描了 ${toolingFiles.length} 个工具脚本`);

// 「装好了」不等于「浏览器拿到的是那一份」：install 退出码 0、启动图 rev 变了，
// 都可能和**内容**是两回事（真踩过：复制那一步失败、rev 也变了，用户刷新后仍是旧 UI）。
// 所以检查 bundle 内容这件事本身要有脚本。
check('有一个「浏览器实际拿到哪份 bundle」的检查脚本（部署后核对内容，而不只是退出码/rev）',
  existsSync(join(packageRoot, 'tools', 'check-bundle.mjs')));

// ── 8. 双语 README 配对 ────────────────────────────────────────────────────
// README.i18n.yaml 记录两侧的 git blob 哈希。这里用 git 的 blob 哈希算法
// 直接算（sha1("blob <len>\0" + content)），因此不需要 git 命令，
// 让"两边要同步改"从口头约定变成 CI 能拦住的断言。
console.log('\n[8] 双语 README 配对');
const pairingPath = join(packageRoot, 'README.i18n.yaml');
if (!existsSync(pairingPath)) {
  check('README.i18n.yaml 存在', false, pairingPath);
} else {
  const pairing = readFileSync(pairingPath, 'utf8');
  for (const readme of ['README.md', 'README.zh.md']) {
    const readmePath = join(packageRoot, readme);
    if (!existsSync(readmePath)) {
      check(`${readme} 存在`, false);
      continue;
    }
    const blob = readFileSync(readmePath);
    const hash = createHash('sha1')
      .update(`blob ${blob.length}\0`, 'utf8')
      .update(blob)
      .digest('hex');
    const recorded = new RegExp(`^${readme.replace('.', '\\.')}:\\s*([0-9a-f]{40})\\s*$`, 'm').exec(pairing);
    if (recorded === null) {
      check(`${readme} 的哈希已登记`, false, 'README.i18n.yaml 里没有这一行');
    } else {
      check(`${readme} 与登记哈希一致`, recorded[1] === hash,
        `登记 ${recorded[1]} / 实际 ${hash} — 改完两侧后重新登记哈希`);
    }
  }
}

// ── 9. 主题 token ──────────────────────────────────────────────────────────
// 写错 token 名（或引用一个主题根本没定义的 token）不会报任何错，那条 CSS 声明
// 只是静默失效。官方包里就有这种引用（--dsw-alias-fill-l2），所以这里把
// "只用真实存在的 token" 变成断言。名单见 tools/lib/theme-tokens.mjs。
console.log('\n[9] 主题 token');
const usedTokens = [...new Set(
  [...source.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((match) => match[1]),
)].sort();
const unknownTokens = usedTokens.filter((token) => !THEME_TOKENS.has(token));
check('只用主题真实定义的 --dsw-* token', unknownTokens.length === 0,
  `未定义: ${unknownTokens.join(', ')}`);
check('用到了主题 token（不是空检查）', usedTokens.length > 0);
console.log(`        用到 ${usedTokens.length} 个 token，名单共 ${THEME_TOKENS.size} 个`);

// 硬编码颜色会破坏暗色主题；主题 token 之外的 color/background 只允许 transparent/currentColor 等关键字。
const literalColors = [...source.matchAll(/(?:^|[;{ ])(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb|hsl)/g)]
  .map((match) => match[0].trim());
check('没有写死的颜色值（亮/暗主题都要能看）', literalColors.length === 0,
  literalColors.slice(0, 4).join(' | '));

// ── 10. 纯函数规则 ─────────────────────────────────────────────────────────
// 关键日期的先后关系是明确的产品规则，值得有真正的断言而不是只靠看页面。
console.log('\n[10] 纯函数规则');
const internals = moduleExports.__internals;
check('导出了 __internals 供自检', internals !== undefined && internals !== null && typeof internals === 'object');
if (internals !== undefined && internals !== null) {
  const { checkOrder, shiftDay, nextVersion } = internals;
  const ok = { releaseDate: '2026-10-01', testFreezeDate: '2026-10-05', goLiveDate: '2026-10-10' };
  check('checkOrder：合法顺序通过', checkOrder(ok) === '');
  check('checkOrder：提版 = 封板 被拒',
    checkOrder({ releaseDate: '2026-10-05', testFreezeDate: '2026-10-05', goLiveDate: '2026-10-10' }) === 'dates.errReleaseBeforeFreeze');
  check('checkOrder：提版晚于封板 被拒',
    checkOrder({ releaseDate: '2026-10-06', testFreezeDate: '2026-10-05', goLiveDate: '2026-10-10' }) === 'dates.errReleaseBeforeFreeze');
  check('checkOrder：封板 = 上线 被拒',
    checkOrder({ releaseDate: '2026-10-01', testFreezeDate: '2026-10-10', goLiveDate: '2026-10-10' }) === 'dates.errFreezeBeforeLive');
  check('checkOrder：封板晚于上线 被拒',
    checkOrder({ releaseDate: '2026-10-01', testFreezeDate: '2026-10-11', goLiveDate: '2026-10-10' }) === 'dates.errFreezeBeforeLive');
  check('checkOrder：空值放行（允许只填一部分）',
    checkOrder({ releaseDate: '', testFreezeDate: '2026-10-10', goLiveDate: '' }) === ''
    && checkOrder({ releaseDate: '', testFreezeDate: '', goLiveDate: '' }) === '');
  check('shiftDay：跨月往前', shiftDay('2026-10-01', -1) === '2026-09-30');
  check('shiftDay：跨月往后', shiftDay('2026-09-30', 1) === '2026-10-01');
  check('shiftDay：无效入参返回空串', shiftDay('', 1) === '' && shiftDay('not-a-date', 1) === '');
  check('nextVersion：v1.0 -> v1.1', nextVersion('v1.0') === 'v1.1' && nextVersion(undefined) === 'v1.0');
}

// ── 11. 逾期通知与自动归档规则 ─────────────────────────────────────────────
console.log('\n[11] 逾期通知与自动归档规则');
if (internals !== undefined && internals !== null) {
  const overdue = {
    isOverdueDone: internals.isOverdueDone,
    noticeVisible: internals.noticeVisible,
    daysUntilAutoArchive: internals.daysUntilAutoArchive,
    archiveDays: internals.OVERDUE_ARCHIVE_DAYS,
    lingerDays: internals.NOTICE_LINGER_DAYS,
  };

  check('自动归档阈值与已读存活期都是 3 天',
    overdue.archiveDays === 3 && overdue.lingerDays === 3,
    '实际 ' + overdue.archiveDays + ' / ' + overdue.lingerDays);

  const now = new Date(2026, 9, 15, 12, 0, 0);
  const doneOn = (goLiveDate) => ({ status: 'done', goLiveDate });

  check('isOverdueDone：已完成且上线日已过 -> 真', overdue.isOverdueDone(doneOn('2026-10-14'), now) === true);
  check('isOverdueDone：上线日就是今天 -> 假（必须已过）', overdue.isOverdueDone(doneOn('2026-10-15'), now) === false);
  check('isOverdueDone：上线日在未来 -> 假', overdue.isOverdueDone(doneOn('2026-10-16'), now) === false);
  check('isOverdueDone：未标记完成 -> 假', overdue.isOverdueDone({ status: 'active', goLiveDate: '2026-10-01' }, now) === false);
  check('isOverdueDone：暂停中 -> 假', overdue.isOverdueDone({ status: 'paused', goLiveDate: '2026-10-01' }, now) === false);
  check('isOverdueDone：没填上线日期 -> 假', overdue.isOverdueDone({ status: 'done', goLiveDate: '' }, now) === false);
  check('isOverdueDone：元数据缺失 -> 假', overdue.isOverdueDone(null, now) === false && overdue.isOverdueDone(undefined, now) === false);

  const iso = (offsetDays) => new Date(now.getTime() + offsetDays * 86400000).toISOString();
  const notice = (raisedDays, readDays) => ({
    overdueNoticeAt: iso(raisedDays),
    overdueNoticeReadAt: readDays === null ? '' : iso(readDays),
  });

  check('noticeVisible：未读 -> 一直显示', overdue.noticeVisible(notice(-10, null), now) === true);
  check('noticeVisible：没有通知时间 -> 不显示', overdue.noticeVisible({ overdueNoticeAt: '', overdueNoticeReadAt: '' }, now) === false);
  check('noticeVisible：已读 1 天 -> 仍显示', overdue.noticeVisible(notice(-10, -1), now) === true);
  check('noticeVisible：已读正好 3 天 -> 不再显示', overdue.noticeVisible(notice(-10, -3), now) === false);
  check('noticeVisible：已读 4 天 -> 不再显示', overdue.noticeVisible(notice(-10, -4), now) === false);

  check('daysUntilAutoArchive：刚登记 -> 3 天', overdue.daysUntilAutoArchive(notice(0, null), now) === 3);
  check('daysUntilAutoArchive：登记满 2 天 -> 还剩 1 天', overdue.daysUntilAutoArchive(notice(-2, null), now) === 1);
  check('daysUntilAutoArchive：早已过期 -> 归零（不变负）', overdue.daysUntilAutoArchive(notice(-9, null), now) === 0);
}

// ── 12. 阶段状态推导 ───────────────────────────────────────────────────────
console.log('\n[12] 阶段状态推导');
if (internals !== undefined && internals !== null) {
  const derive = internals.deriveStageStatus;
  const ids = ['requirement', 'design', 'develop', 'test', 'release'];
  const every = (state, value) => ids.every((id) => state[id] === value);

  check('空元数据 -> 全部未开始', every(derive(null), 'pending') && every(derive(undefined), 'pending'));

  const plain = derive({ status: 'active', clarifications: [] });
  check('进行中且无澄清 -> 需求阶段进行中，其余未开始',
    plain.requirement === 'active' && every(plain, 'pending') === false
    && ['design', 'develop', 'test', 'release'].every((id) => plain[id] === 'pending'));

  const clarified = derive({ status: 'active', clarifications: [{ id: 'a' }] });
  check('有澄清记录 -> 需求阶段已审核',
    clarified.requirement === 'approved' && clarified.design === 'pending');

  const done = derive({ status: 'done', clarifications: [] });
  check('已完成 -> 整条管线视为已审核', every(done, 'approved'));

  const paused = derive({ status: 'paused', clarifications: [] });
  check('暂停中 -> 需求阶段进行中（暂停不改变阶段推导）', paused.requirement === 'active');

  // 多人：需求与提版是公共管线，方案/开发/测试按人分开。
  const multi = {
    status: 'active',
    clarifications: [],
    developers: ['张三', '李四'],
    featurePoints: [
      { id: 'p1', name: '导出', assignee: '张三' },
      { id: 'p2', name: '对账', assignee: '' },
    ],
  };
  const forZhang = derive(multi, '张三');
  const forLi = derive(multi, '李四');

  check('公共阶段不受开发人员影响',
    forZhang.requirement === forLi.requirement && forZhang.release === forLi.release);
  check('公共阶段：需求进行中，提版未开始',
    forZhang.requirement === 'active' && forZhang.release === 'pending');
  check('分到功能点的人 -> 方案进行中', forZhang.design === 'active');
  check('没分到功能点的人 -> 方案未开始', forLi.design === 'pending');
  check('开发 / 测试仍为未开始（等真实进度）',
    forZhang.develop === 'pending' && forZhang.test === 'pending');
  check('不传开发人员时，按人那三段一律未开始',
    derive(multi).design === 'pending' && derive(multi).develop === 'pending' && derive(multi).test === 'pending');
  check('未分派的功能点不算给任何人',
    derive({ ...multi, featurePoints: [{ id: 'p2', name: '对账', assignee: '' }] }, '张三').design === 'pending');
  check('已完成优先于按人推导（整条管线已审核）',
    every(derive({ ...multi, status: 'done' }, '李四'), 'approved'));

  check('阶段划分常量：需求/提版公共，方案/开发/测试按人',
    internals.SHARED_STAGE_IDS.length === 2
    && internals.SHARED_STAGE_IDS.includes('requirement')
    && internals.SHARED_STAGE_IDS.includes('release')
    && internals.PER_DEVELOPER_STAGE_IDS.length === 3
    && internals.PER_DEVELOPER_STAGE_IDS.includes('design')
    && internals.PER_DEVELOPER_STAGE_IDS.includes('develop')
    && internals.PER_DEVELOPER_STAGE_IDS.includes('test'));
}

// ── 13. 自动归档的触发时刻 ─────────────────────────────────────────────────
console.log('\n[13] 自动归档的触发时刻');
if (internals !== undefined && internals !== null) {
  const due = internals.isAutoArchiveDue;
  const base = new Date(2026, 9, 15, 12, 0, 0);
  const at = (offsetDays) => ({ overdueNoticeAt: new Date(base.getTime() + offsetDays * 86400000).toISOString() });

  check('刚登记通知 -> 不归档（这是最重要的一条：不能被提前归档）', due(at(0), base) === false);
  check('登记 1 秒后 -> 不归档', due({ overdueNoticeAt: new Date(base.getTime() + 1000).toISOString() }, base) === false);
  check('登记 1 天后 -> 不归档', due(at(-1), base) === false);
  check('登记 2 天 23 小时后 -> 不归档', due(at(-2.9), base) === false);
  check('登记正好 3 天 -> 归档', due(at(-3), base) === true);
  check('登记 4 天 -> 归档', due(at(-4), base) === true);
  check('没有通知时间 -> 不归档', due({ overdueNoticeAt: '' }, base) === false && due({}, base) === false);
  check('元数据缺失 -> 不归档', due(null, base) === false && due(undefined, base) === false);
}

// ── 14. 文案键完整性 ───────────────────────────────────────────────────────
// 静态检查比渲染冒烟强得多：渲染只走当前那条分支，而漏掉的键往往在别的分支里。
// 词典缺键时 t() 会原样返回 key，界面就会出现 stage.requirement 这种东西。
console.log('\n[14] 文案键完整性');
{
  const dicts = localeRegistrations.length === 1 ? localeRegistrations[0].dicts : { zh: {}, en: {} };
  const usedKeys = new Set();
  for (const match of source.matchAll(/\bt\(\s*['"]([A-Za-z][A-Za-z0-9_.]*)['"]/g)) usedKeys.add(match[1]);
  const missing = [...usedKeys].filter((key) => !(key in dicts.zh) || !(key in dicts.en)).sort();
  check('源码用到的每个文案键都在 zh 与 en 里', missing.length === 0, missing.join(', '));
  console.log('        源码用到 ' + usedKeys.size + ' 个键，词典共 ' + Object.keys(dicts.zh).length + ' 个');
}

// ── 15. 归档语义（宿主半） ─────────────────────────────────────────────────
// 归档 = 写 requirement.json 的 archivedAt，**目录原地不动**。这是刻意的：
// 搬目录会让 git 把归档记成「一批删除 + 一批新增」，`git log -- <path>` 从此断裂；
// 还会和「别人正在改这条需求」撞成 modify/delete 冲突；Windows 上更会因为有人
// 开着文档（或杀软在扫）而让 rename 直接失败。这一节把「不许再搬目录」钉住。
console.log('\n[15] 归档语义');
{
  const hostPath = join(packageRoot, 'index.js');
  const host = readFileSync(hostPath, 'utf8');

  check('宿主半不再 import rename',
    !/import\s*\{[^}]*\brename\b[^}]*\}\s*from\s*['"]node:fs\/promises['"]/.test(host),
    '归档/取消归档不许用 rename 搬目录');
  check('宿主半不再把 _history 当目录名用', !/['"]_history['"]/.test(host));
  check('客户端不再引用 _history', !/['"]_history['"]/.test(source));
  check('客户端自动归档扫描跳过已归档需求', /summary\.archived/.test(source),
    '归档后需求留在原地，扫描必须靠归档标记跳过，否则每次打开都重刷 archivedAt');

  let hostModule = null;
  let hostImportError = null;
  try {
    hostModule = await import(pathToFileURL(hostPath).href);
  } catch (error) {
    hostImportError = error;
  }
  check('宿主半可在 DSH 之外被 import（常量可被工具复用）', hostModule !== null,
    hostImportError === null ? '' : String(hostImportError));
  if (hostModule !== null) {
    check('导出 ARCHIVE_FIELD = archivedAt', hostModule.ARCHIVE_FIELD === 'archivedAt',
      `实际 ${String(hostModule.ARCHIVE_FIELD)}`);
    check('不再导出 HISTORY_DIR', hostModule.HISTORY_DIR === undefined);
    check('工作台根 / 管线目录 / 五阶段常量仍在',
      hostModule.WORKBENCH_ROOT === 'docs/requirements'
      && hostModule.PIPELINE_DIR === 'Pipeline'
      && Array.isArray(hostModule.STAGE_DIRS) && hostModule.STAGE_DIRS.length === 5);
  }

  check('一次性迁移脚本已随包提供（离线机器也要能迁移）',
    existsSync(join(packageRoot, 'tools', 'migrate-history.mjs')));
}

// ── 16. RPC payload 契约 ───────────────────────────────────────────────────
// listRequirements 曾是**唯一**一个把非 session 入参放在 payload 顶层的 op，其余
// 15 个都读 payload.args。于是按「参数放 args」写的调用方传进来的开关被**静默忽略**：
// 不报错、不告警，只是结果少一半，看起来像数据丢了（tools/rpc.mjs 就这么栽过）。
// 这一节把「两种写法都接受」钉住，并确保不再有第二个特例 op 悄悄长出来。
console.log('\n[16] RPC payload 契约');
{
  const hostText = readFileSync(join(packageRoot, 'index.js'), 'utf8');
  check('listRequirements 的开关走统一的取值函数',
    /includeArchived: includeArchivedFlag\(payload\)/.test(hostText));
  check('该函数同时接受 args 与 payload 顶层两种写法',
    /typeof args\.includeArchived === 'boolean'/.test(hostText)
    && /payload\?\.includeArchived === true/.test(hostText));
  check('顶层写法只出现在该函数里（没有第二个特例 op）',
    (hostText.match(/payload\?\.includeArchived/g) ?? []).length === 1,
    '新增 op 一律读 payload.args，别再放顶层');
  check('客户端仍发顶层写法（兼容分支不会变成死代码）', /includeArchived: true/.test(source));
}

// ── 17. 逾期通知的本机化 ───────────────────────────────────────────────────
// 「我什么时候看到过哪条逾期提醒」是**本用户状态**，必须和身份一样待在用户数据目录。
// 留在共享的 requirement.json 里，就成了「谁先打开工作台谁写」—— 两个人同一天打开
// 必然改到同一处。这一节钉住「通知不进共享树」和「写一次不覆盖」。
console.log('\n[17] 逾期通知的本机化');
{
  const hostText = readFileSync(join(packageRoot, 'index.js'), 'utf8');
  check('宿主提供 readNotices / raiseNotice / markNoticeRead / clearNotice',
    /readNotices: async/.test(hostText) && /raiseNotice: async/.test(hostText)
    && /markNoticeRead: async/.test(hostText) && /clearNotice: async/.test(hostText));
  check('通知表落在用户数据目录（与身份同处，不进共享树）',
    /join\(dshHome\(\), IDENTITY_DIR, NOTICE_FILE\)/.test(hostText),
    '不能在 docs/requirements 下再放一个通知文件');
  check('登记是「写一次不覆盖」（否则每次打开都重刷时间戳）',
    /existing\.raisedAt !== ''/.test(hostText));
  check('已读也是「写一次不覆盖」', /existing\.readAt === ''/.test(hostText));
  check('客户端把登记 / 已读 / 清除都走本机通知表',
    /'raiseNotice'/.test(source) && /'markNoticeRead'/.test(source) && /'clearNotice'/.test(source));
  check('客户端保留旧宿主的退化路径（热替换窗口里提醒不会消失）',
    /noticeStore\.supported/.test(source) && /overdueNoticeAt: now\.toISOString\(\)/.test(source));
}

// ── 18. 「方案」阶段的按人模型 ─────────────────────────────────────────────
// 方案是**按人分开**的管线：每个开发人员一套文件，各写各的。这一节钉住三件事：
//   1. 方案文件全部落在 Pipeline/方案/<人>/ 之下，**不碰共享的 requirement.json**；
//   2. 读不到方案数据时回退到占位规则，读得到时以真实产物为准；
//   3. 「让 AI 出方案」发出的指令里，路径与产物形状是写死的（那是插件与 AI 的契约）。
console.log('\n[18] 「方案」阶段的按人模型');
if (internals !== undefined && internals !== null) {
  const { designPaths, developerSlug, designState, designStageStatus, seedTasks, taskSummary,
    taskLabel, nextSnapshotIndex, snapshotList, designPrompt, impactFilled, impactToForm, sameImpact } = internals;

  // —— 目录名与路径
  const paths = designPaths('张三');
  check('方案锚在 Pipeline/方案 之下', paths.base === 'Pipeline/方案/张三'
    && paths.draft === 'Pipeline/方案/张三/draft.md',
    `实际 ${paths.draft}`);
  check('四个产物文件都在按人目录里',
    [paths.draft, paths.impact, paths.tasks, paths.meta, paths.version(2)]
      .every((path) => path.startsWith('Pipeline/方案/张三/')));
  check('方案文件里没有一个是共享的 requirement.json',
    [paths.draft, paths.impact, paths.tasks, paths.meta].every((path) => !path.endsWith('requirement.json')));

  check('目录名转义去掉 / \\ : * ? " < > |',
    developerSlug('a/b\\c:d*e?f"g<h>i|j') === 'abcdefghij',
    `实际 ${developerSlug('a/b\\c:d*e?f"g<h>i|j')}`);
  check('目录名去掉首尾空白与开头的点', developerSlug('  .张三 ') === '张三',
    `实际 ${developerSlug('  .张三 ')}`);
  check('姓名被转义干净时不留空目录名',
    developerSlug('') === '_' && developerSlug('///') === '_' && developerSlug('   ') === '_');
  check('中文姓名原样保留（目录名就是给人看的）', developerSlug('李四') === '李四');

  // —— 状态推导：读得到就用真实产物，读不到才回退
  check('读不到方案数据 -> null（交给调用方回退）',
    designStageStatus(null) === null && designStageStatus(undefined) === null);
  check('空方案 -> 未开始', designStageStatus(designState({})) === 'pending');
  check('有正文 -> 进行中', designStageStatus(designState({ draft: '# 方案' })) === 'active');
  check('只有空白正文不算动过', designStageStatus(designState({ draft: '   \n  ' })) === 'pending');
  check('只填了影响面也算动过',
    designStageStatus(designState({ impact: { modules: 'a.ts', risk: 'low' } })) === 'active');
  check('只有任务也算动过',
    designStageStatus(designState({ tasks: { tasks: [{ id: 't1' }] } })) === 'active');
  check('默认值的影响面表单不算动过（否则一打开就是进行中）',
    impactFilled(impactToForm(null)) === false && impactFilled(null) === false);
  check('定稿 -> 已审核',
    designStageStatus(designState({ draft: 'x', meta: { confirmedAt: '2026-10-01T00:00:00.000Z' } })) === 'approved');
  // 这是真实数据里翻出来的缺陷：点一下「方案定稿」，徽标就在什么都没写的情况下变绿。
  check('**空的方案即使被定稿也不算已审核**（否则点一下按钮徽标就绿了）',
    designStageStatus(designState({ meta: { confirmedAt: 'now' } })) === 'pending'
    && designStageStatus(designState({ draft: '   ', meta: { confirmedAt: 'now' } })) === 'pending'
    && designStageStatus(designState({ draft: 'x', meta: { confirmedAt: 'now' } })) === 'approved');

  const meta18 = {
    status: 'active',
    clarifications: [],
    developers: ['张三'],
    featurePoints: [{ id: 'p1', name: '导出', assignee: '张三' }],
  };
  // 第三参现在是**已经算好的状态**（判定由 designStageStatus / stageVerdict 负责），
  // 所以这里显式地把判定结果接进来 —— 覆盖的仍是「判定 → 拼装」这条完整链路。
  const statusOfDesign = (state) => ({ design: internals.designStageStatus(designState(state)) });
  check('占位规则：不传阶段状态时仍按「分到功能点」推导（旧宿主与首次渲染都不受影响）',
    internals.deriveStageStatus(meta18, '张三').design === 'active'
    && internals.deriveStageStatus(meta18, '张三', null).design === 'active');
  check('真实产物优先：分到功能点但方案是空的 -> 未开始（这正是占位规则会说错的地方）',
    internals.deriveStageStatus(meta18, '张三', statusOfDesign({})).design === 'pending');
  check('真实产物优先：有正文 -> 进行中',
    internals.deriveStageStatus(meta18, '张三', statusOfDesign({ draft: 'x' })).design === 'active');
  check('真实产物优先：定稿 -> 已审核',
    internals.deriveStageStatus(meta18, '张三', statusOfDesign({ draft: 'x', meta: { confirmedAt: 'now' } })).design === 'approved');
  check('定稿后管线显示已审核，且不影响公共阶段',
    (() => {
      const state = internals.deriveStageStatus(meta18, '张三', statusOfDesign({ draft: 'x', meta: { confirmedAt: 'now' } }));
      return state.design === 'approved' && state.requirement === 'active' && state.release === 'pending';
    })());

  // —— 任务拆分
  const points18 = [
    { id: 'p1', name: '客户信息导出', assignee: '张三' },
    { id: 'p2', name: '对账', assignee: '李四' },
    { id: 'p3', name: '权限校验', assignee: '张三' },
    { id: 'p4', name: '未分派的活', assignee: '' },
  ];
  let seq18 = 0;
  const makeId18 = () => 't' + (++seq18);
  const seeded = seedTasks(points18, '张三', [], makeId18);
  check('只把「分派给我」的功能点变成任务',
    seeded.length === 2 && seeded.map((task) => task.pointId).join(',') === 'p1,p3',
    `实际 ${seeded.map((task) => task.pointId).join(',')}`);
  check('生成的任务记住来源功能点，且默认未完成、预估 0',
    seeded.every((task) => task.done === false && task.estimate === 0 && task.title !== ''));
  check('播种是幂等的（按钮可以随便点）',
    seedTasks(points18, '张三', seeded, makeId18).length === 2);
  check('已有任务保留，新任务追加在后面',
    (() => {
      const again = seedTasks(points18, '张三', seeded.concat([{ id: 'm1', pointId: '', title: '手工的活' }]), makeId18);
      return again.length === 3 && again[0].id === 't1' && again[2].id === 'm1';
    })());
  check('未分派的功能点不生成任务',
    seedTasks([{ id: 'p9', name: 'x', assignee: '' }], '张三', [], makeId18).length === 0);
  check('没有标题时用来源功能点的名字兜底',
    taskLabel({ id: 't1', pointId: 'p1', title: '' }, points18) === '客户信息导出'
    && taskLabel({ id: 't1', pointId: 'p1', title: '我改的' }, points18) === '我改的');

  check('任务汇总：个数 / 预估人天 / 已完成',
    (() => {
      const summary = taskSummary([
        { estimate: 0.1, done: true }, { estimate: 0.2, done: false }, { estimate: 3 },
      ]);
      return summary.count === 3 && summary.days === 3.3 && summary.done === 1;
    })(),
    '累加不许出现 0.30000000000000004 这种浮点尾巴');
  check('任务汇总容忍坏输入',
    taskSummary(null).count === 0 && taskSummary([{ estimate: 'x', done: 'yes' }]).days === 0
    && taskSummary([{ estimate: 'x', done: 'yes' }]).done === 0);

  // —— 版本快照：序号从目录里推，不靠索引文件
  check('快照序号从已有文件名推出', nextSnapshotIndex([]) === 1
    && nextSnapshotIndex([{ name: 'v1.md' }, { name: 'v3.md' }]) === 4);
  check('不认识的文件名不影响序号',
    nextSnapshotIndex([{ name: 'readme.md' }, { name: 'v2.txt' }, { name: 'v2.md' }]) === 3);
  check('快照列表新的在前',
    snapshotList([{ name: 'v1.md', bytes: 10 }, { name: 'v2.md', bytes: 20 }])[0].name === 'v2.md');

  // —— 「让 AI 出方案」的指令：插件与 AI 之间唯一的契约
  const prompt18 = designPrompt({
    id: 'XQ20260917-0004',
    title: '客户经营信息优化',
    developer: '张三',
    root: 'E:/ws/docs/requirements',
    points: points18,
    hasDraft: false,
  });
  check('指令里写死了需求编号、标题与开发者',
    prompt18.includes('XQ20260917-0004') && prompt18.includes('客户经营信息优化') && prompt18.includes('张三'));
  check('指令给出三个产物的完整落盘路径',
    prompt18.includes('E:/ws/docs/requirements/XQ20260917-0004/Pipeline/方案/张三/draft.md')
    && prompt18.includes('Pipeline/方案/张三/impact.json')
    && prompt18.includes('Pipeline/方案/张三/tasks.json'));
  check('指令要求读取需求正文（AI 得先看需求再出方案）',
    prompt18.includes('Pipeline/需求/parsed/') && prompt18.includes('requirement.json'));
  check('指令明确禁止改动需求层（否则 AI 会顺手改共享文件）',
    /不要改动需求层/.test(prompt18));
  check('指令禁止改动需求层时点名了 requirement.json', prompt18.includes('requirement.json'));
  check('指令带上分派给我的功能点，且**不含别人的**',
    prompt18.includes('客户信息导出') && prompt18.includes('权限校验') && !prompt18.includes('对账'));
  check('已有正文时要求「先读再改」而不是从零重写',
    designPrompt({ id: 'X', title: 'T', developer: '张三', root: 'r', points: [], hasDraft: true })
      .includes('不要从零重写'));
  check('指令要求两个 JSON，并给出字段形状（形状不对页面就读不出来）',
    prompt18.includes('"schema": 1') && prompt18.includes('pointId') && prompt18.includes('rollback'));

  // —— 静态结构：走的是平台通道，不是自己造的轮子。
  // 访问姿势的细节（get('conversation') 而不是 .conversation）在第 [29] 组。
  check('出稿指令走平台通道送进会话（sessions.scope(id) + conversation.send）',
    /ctx\.sessions\.scope\(sessionId\)/.test(source)
    && /actx\.get\('conversation'\)/.test(source)
    && /conversation\.send\(text\)/.test(source));
  check('inject 列表声明了 sessions 与 conversation',
    /const inject = \[[^\]]*'sessions'[^\]]*'conversation'[^\]]*\]/.test(source));
  check('注册了入口级 inject 面（否则拿不到会话 id）', /inject: \(sessionId\) => \(\{/.test(source));
  check('空白会话送不出去时降级成「把指令摆出来自己粘贴」',
    /NO_SESSION_SCOPE/.test(source) && /setManual\(prompt\)/.test(source));

  // —— 方案汇总：共享一份，给主导者看整体
  const { designSummaryPath, designSummaryPrompt, rosterDays, rosterMissing, entryMtime } = internals;
  check('汇总落在按人目录**之外**（它是共享的，不属于任何人）',
    designSummaryPath() === 'Pipeline/方案/汇总.md', `实际 ${designSummaryPath()}`);

  // 这是本节最要紧的一条：汇总是 Pipeline/方案/汇总.md，如果有人叫「汇总.md」，
  // 他的目录就会和这份共享文件同名 —— 文件与目录不能同名，汇总从此写不进去。
  // 保证 slug 不含点号，这类撞名就**不可能发生**，而不是"大概不会发生"。
  const hostile = ['汇总.md', '汇总', 'a.b.c', '张三.md', '  ..x..  ', '////', ''];
  check('目录名转义后永远不含点号（共享汇总文件因此不可能与任何人的目录撞名）',
    hostile.every((name) => !developerSlug(name).includes('.')),
    hostile.map((name) => `${JSON.stringify(name)}->${developerSlug(name)}`).join(' '));
  check('一个叫「汇总.md」的人不会占掉共享汇总的路径',
    developerSlug('汇总.md') !== '汇总.md' && designSummaryPath().split('/').length === 3,
    `实际 ${developerSlug('汇总.md')}`);

  const summaryPrompt = designSummaryPrompt({
    id: 'XQ20260917-0004',
    title: '多人协作示例',
    root: 'E:/ws/docs/requirements',
    developers: ['张三', '李四', '飞飞'],
  });
  check('汇总指令指向唯一的那个汇总文件',
    summaryPrompt.includes('E:/ws/docs/requirements/XQ20260917-0004/Pipeline/方案/汇总.md'));
  check('汇总指令要求**真的去列目录**，而不是只按登记名单来',
    /真的去列一遍目录/.test(summaryPrompt) && summaryPrompt.includes('张三、李四、飞飞'));
  check('汇总指令要的是横向对照：分歧 / 缺口 / 依赖 / 投入 / 风险',
    ['分歧与冲突', '覆盖缺口', '依赖与顺序', '投入汇总', '风险汇总'].every((word) => summaryPrompt.includes(word)));
  check('汇总指令要求点名是谁与谁有分歧',
    /点名是谁与谁/.test(summaryPrompt));
  check('汇总指令要求先给一段「整体开发概念」给不写代码的人看',
    /整体开发概念/.test(summaryPrompt) && /不写代码的人/.test(summaryPrompt));
  check('汇总指令禁止改任何人的方案文件（这是这个动作最危险的失败方式）',
    /绝不修改任何人的方案文件/.test(summaryPrompt) && /只写上面那一个文件/.test(summaryPrompt));

  check('全队人天合计（浮点尾巴一样要处理）',
    rosterDays([{ days: 0.1 }, { days: 0.2 }, { days: 3 }]) === 3.3
    && rosterDays([]) === 0 && rosterDays(null) === 0);
  check('还没写方案的人被单独点出来',
    rosterMissing([{ name: '张三', hasDraft: true }, { name: '李四', hasDraft: false }]).join(',') === '李四'
    && rosterMissing([]).length === 0);
  check('汇总的「更新于」直接来自文件系统，不另建元数据文件',
    entryMtime([{ name: '汇总.md', mtime: 123 }], '汇总.md') === 123
    && entryMtime([{ name: '别的.md', mtime: 9 }], '汇总.md') === 0
    && entryMtime(null, '汇总.md') === 0);

  check('客户端与宿主半边的共享元数据文件名一致',
    internals.REQUIREMENT_FILE === 'requirement.json'
    && /REQUIREMENT_FILE = 'requirement\.json'/.test(readFileSync(join(packageRoot, 'index.js'), 'utf8')));

  // 汇总区块的表头也有一个同名按钮，所以搜索必须从「留存版本」之后开始 ——
  // 否则量到的是区块那个，而不是用户要求的「留存版本右边」那个。
  const iSnapshotBtn = source.indexOf("t('design.snapshot')");
  const iSummaryBtn = source.indexOf("t('summary.label')", iSnapshotBtn);
  const iCompareBtn = source.indexOf("t('design.compare')", iSnapshotBtn);
  check('汇总方案按钮就挨在「留存版本」右边',
    iSnapshotBtn > 0 && iSummaryBtn > iSnapshotBtn && iSummaryBtn < iCompareBtn,
    `留存版本@${iSnapshotBtn} 汇总@${iSummaryBtn} 对比@${iCompareBtn}`);

  // —— 主导者与两套独立的编辑权
  const { leadOf, canEditSummary, canHandOverLead, LEAD_FIELD } = internals;
  const four = { developers: ['张三', '李四', '飞飞', '小飞飞'], featurePoints: [] };

  check('默认主导者 = 名单里的第一个人（老需求不需要迁移）',
    leadOf(four) === '张三' && leadOf({ developers: ['李四'] }) === '李四');
  check('没有名单就没有主导者', leadOf({ developers: [] }) === '' && leadOf(null) === '' && leadOf(undefined) === '');
  check('写下的主导者优先于默认值',
    leadOf(Object.assign({}, four, { [LEAD_FIELD]: '李四' })) === '李四');
  check('记的人已不在名单里 -> 回落到第一个人（否则主导者一走就没人能改汇总）',
    leadOf(Object.assign({}, four, { [LEAD_FIELD]: '离职的人' })) === '张三');
  check('主导者字段不是字符串时也回落到第一个人',
    leadOf(Object.assign({}, four, { [LEAD_FIELD]: 42 })) === '张三');

  check('汇总：主导者能编辑',
    canEditSummary('张三', '张三') === true);
  check('汇总：非主导者只能看',
    canEditSummary('李四', '张三') === false && canEditSummary('飞飞', '张三') === false);
  check('汇总：身份未登记时不拦（否则只会拦住使用者自己）',
    canEditSummary('', '张三') === true && canEditSummary('李四', '') === true);

  check('变换主导者：现任主导者可以', canHandOverLead('张三', '张三', four.developers) === true);
  check('变换主导者：非主导者不行',
    canHandOverLead('李四', '张三', four.developers) === false
    && canHandOverLead('飞飞', '张三', four.developers) === false);
  check('名单为空时没人能变换', canHandOverLead('张三', '', []) === false);

  // 这条是整个权限模型的地基：如果谁都能改主导者，那「只有主导者能编辑汇总」
  // 就是空的 —— 任何人先把自己设成主导者就行了。权限的入口必须和权限本身一样紧。
  check('**非主导者不能把自己变成主导者**（否则汇总权限形同虚设）',
    canHandOverLead('李四', leadOf(four), four.developers) !== true
    && canEditSummary('李四', leadOf(Object.assign({}, four, { [LEAD_FIELD]: '李四' }))) === true);

  check('方案页用的是「我是不是主导者」而不是「这是不是我的管线」',
    /const summaryEditable = props\.summaryEditable === true;/.test(source)
    && /editable: summaryEditable/.test(source));
  check('按人管线仍按「这是不是我的管线」判定',
    /const canEdit = identity === '' \|\| activeDeveloper === '' \|\| activeDeveloper === identity;/.test(source));

  const designRegion = source.slice(source.indexOf('function DesignStage'), source.indexOf('function impactToForm'));
  check('方案页整段不写共享的 requirement.json',
    designRegion.length > 0 && !/writeRequirement/.test(designRegion),
    '方案是纯按人管线，一个字都不该写进共享元数据');
  check('方案页只调用已有的宿主 op（不需要重启宿主）',
    designRegion.length > 0 && !/callWorkbench\('(?!readText|writeText|listDir)/.test(designRegion),
    '新增 op 就意味着要重启 dsh web');
}

// ── 19. 方案页的渲染冒烟 ───────────────────────────────────────────────────
// 第 [5] 节渲染的是默认停在「需求」页的主视图，方案页的三个区块走不到。
// 这里按「已经读到数据」的形状各调一次组件体：能抓到组件里的运行时错误
// （对 undefined 取属性这类），以及只在这几个分支里出现的漏文案键。
console.log('\n[19] 方案页渲染冒烟');
if (internals !== undefined && internals !== null) {
  // 收集一次渲染出来的纯文本；函数组件必须真调用，否则整棵子树都漏掉。
  function collect(node, texts) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
    if (Array.isArray(node)) { for (const child of node) collect(child, texts); return; }
    if (typeof node !== 'object') return;
    if (typeof node.type === 'function') {
      try {
        collect(node.type(node.props), texts);
      } catch (error) {
        texts.push(`<crash: ${error && error.message ? error.message : error}>`);
      }
      return;
    }
    // 编辑框的内容在 props.value 里而不是 children 里 —— 方案正文整篇就在 textarea 里，
    // 只看 children 等于方案页最要紧的那块完全没被冒烟到。
    if ((node.type === 'textarea' || node.type === 'input') && typeof node.props.value === 'string') {
      texts.push(node.props.value);
    }
    // title 也要收：「为什么这个按钮点不动」全靠它来说明，那是权限模型对用户的交代。
    if (typeof node.props.title === 'string') texts.push(node.props.title);
    if (Array.isArray(node.children)) for (const child of node.children) collect(child, texts);
  }

  function renderText(Component, props) {
    const texts = [];
    try {
      collect(Component(props), texts);
    } catch (error) {
      texts.push(`<crash: ${error && error.message ? error.message : error}>`);
    }
    return texts.join(' | ');
  }

  /**
   * 按 class 找节点。汇总区改版（一句顿号长句 → 成组的小标签）之后，
   * 「名字是标签、并且分了组」这件事只有看**结构**才测得到 —— 文字里两种写法都能出现。
   */
  function nodesWithClass(Component, props, className) {
    const found = [];
    (function walk(node) {
      if (node === null || node === undefined) return;
      if (Array.isArray(node)) { for (const child of node) walk(child); return; }
      if (typeof node !== 'object') return;
      const value = node.props === undefined ? '' : node.props.className;
      if (typeof value === 'string' && value.split(/\s+/).includes(className)) found.push(node);
      if (typeof node.type === 'function') { walk(node.type(node.props)); return; }
      if (Array.isArray(node.children)) for (const child of node.children) walk(child);
    }(Component(props)));
    return found;
  }

  const requirement19 = {
    id: 'XQ20260917-0004',
    title: '客户经营信息优化',
    featurePoints: [
      { id: 'p1', name: '客户信息导出', assignee: '张三' },
      { id: 'p2', name: '对账', assignee: '李四' },
    ],
  };
  const design19 = internals.designState({
    draft: '# 方案\n目标与范围：导出客户经营信息。',
    impact: { modules: 'src/customer/export.ts', risk: 'high', rollback: '回滚脚本', dependencies: '数据组' },
    tasks: { tasks: [{ id: 't1', pointId: 'p1', title: '', estimate: 2.5, done: true }] },
    meta: { confirmedAt: '' },
    versions: [{ name: 'v1.md', index: 1, bytes: 12 }],
  });
  const base19 = {
    t,
    requirement: requirement19,
    developer: '张三',
    paths: internals.designPaths('张三'),
    editable: true,
    running: false,
    sendPrompt: async () => {},
    root: 'E:/ws/docs/requirements',
    onChanged: () => {},
  };

  const draftText = renderText(internals.DesignDraftSection, { ...base19, design: design19 });
  const impactText = renderText(internals.DesignImpactSection, { ...base19, impact: design19.impact });
  const tasksText = renderText(internals.DesignTasksSection, { ...base19, tasks: design19.tasks });
  const joined19 = [draftText, impactText, tasksText].join(' | ');

  check('方案页三个区块都渲染不抛错', !/<crash: /.test(joined19),
    (joined19.match(/<crash: [^>]*>/) ?? [''])[0]);
  check('渲染出三个区块的标题',
    draftText.includes('方案草稿') && impactText.includes('影响面分析') && tasksText.includes('任务拆分'));
  check('正文区块带出已存的正文与状态', draftText.includes('# 方案') && draftText.includes('进行中'));
  check('影响面区块回填已存内容与风险等级',
    impactText.includes('src/customer/export.ts') && impactText.includes('高'));
  check('任务区块显示汇总（个数 / 人天 / 已完成）', tasksText.includes('共 1 个任务') && tasksText.includes('2.5'));
  check('任务区块把来源功能点标出来', tasksText.includes('客户信息导出'));
  check('别人名下的功能点不出现在我的任务块里',
    !tasksText.includes('对账') && tasksText.includes('1 个'));

  const locked19 = renderText(internals.DesignDraftSection, { ...base19, design: design19, editable: false });
  check('只读管线：给出提示且不给编辑框与操作按钮',
    locked19.includes('只能查看') && !locked19.includes('让 AI'));

  // 读到数据之前的形状：所有字段都是空的，也不能炸。
  // 只读态才会渲染「还没有方案正文」那句提示（可编辑态给的是空编辑框）。
  const empty19 = renderText(internals.DesignDraftSection, {
    ...base19, design: internals.designState({}), editable: false,
  });
  const emptyTasks = renderText(internals.DesignTasksSection, { ...base19, tasks: [] });
  check('空方案也渲染得出来（还没出稿是常态，不是错误）',
    !/<crash: /.test(empty19 + emptyTasks) && empty19.includes('还没有方案正文')
    && emptyTasks.includes('还没有任务'));

  const stageText = renderText(internals.DesignStage, { ...base19, requirement: null, developer: '' });
  check('没有开发人员时方案页给提示而不是崩',
    !/<crash: /.test(stageText) && stageText.includes('还没有登记开发人员'));

  // —— 方案汇总区块
  const roster19 = [
    { name: '张三', hasDraft: true, hasImpact: true, tasks: 2, days: 3.5, done: 0, confirmed: false },
    { name: '李四', hasDraft: false, hasImpact: false, tasks: 0, days: 0, done: 0, confirmed: false },
  ];
  const summaryText = renderText(internals.DesignSummarySection, {
    ...base19,
    text: '# 整体开发概念\n先说整体怎么做。',
    updatedAt: Date.UTC(2026, 9, 1, 2, 0, 0),
    roster: roster19,
  });
  check('汇总区块渲染不抛错', !/<crash: /.test(summaryText),
    (summaryText.match(/<crash: [^>]*>/) ?? [''])[0]);
  check('汇总区块显示汇总正文本身', summaryText.includes('先说整体怎么做'));
  check('汇总区块显示状态与更新时间',
    summaryText.includes('已汇总') && summaryText.includes('更新于 2026-10-01'));
  check('汇总区块列出每个人，并标出谁还没写方案',
    summaryText.includes('张三') && summaryText.includes('李四')
    && summaryText.includes('已写方案') && summaryText.includes('未写方案'));
  check('汇总区块直接点名还没写方案的人（主导者一眼看到缺口）',
    summaryText.includes('还没写方案：李四'));
  check('汇总区块给出全队人天合计与各人任务数',
    summaryText.includes('合计预估 3.5 人天') && summaryText.includes('2 个任务 · 3.5 人天'));

  const summaryEmpty19 = renderText(internals.DesignSummarySection, {
    ...base19, text: '', updatedAt: 0, roster: roster19,
  });
  check('还没汇总时给出该怎么做，而不是一片空白',
    !/<crash: /.test(summaryEmpty19) && summaryEmpty19.includes('还没有汇总')
    && summaryEmpty19.includes('未汇总'));

  // 汇总不属于任何人：查看别人的管线（只读）时也必须看得到。
  const summaryLocked19 = renderText(internals.DesignSummarySection, {
    ...base19, editable: false, text: '# 整体开发概念', updatedAt: 0, roster: roster19, lead: '张三',
  });
  check('只读查看别人的管线时，汇总照样看得到（主导者不该为了看全局去切视图）',
    !/<crash: /.test(summaryLocked19) && summaryLocked19.includes('整体开发概念')
    && !summaryLocked19.includes('保存汇总'));
  check('非主导者看汇总：编辑入口还在，但说明为什么点不动，并点名谁是主导者',
    summaryLocked19.includes('汇总方案')
    && summaryLocked19.includes('只有主导者（张三）能编辑'));
  const summaryMine19 = renderText(internals.DesignSummarySection, {
    ...base19, editable: true, text: '# 整体开发概念', updatedAt: 0, roster: roster19, lead: '张三',
  });
  check('主导者看汇总：不给多余的只读提示', !summaryMine19.includes('只有主导者'));

  // —— 需求页的主导者控件
  const devBase19 = {
    t,
    requirement: { id: 'XQ20260917-0004', title: '多人协作示例', developers: ['张三', '李四'], featurePoints: [] },
    identity: '张三',
    currentDeveloper: '张三',
    onChanged: () => {},
    onChangeIdentity: () => {},
    onSelectDeveloper: () => {},
  };
  const devText19 = renderText(internals.DevelopersEditor, devBase19);
  check('需求页显示主导者是谁', !/<crash: /.test(devText19) && devText19.includes('主导者：张三'));
  check('需求页说明主导者的职责（唯一能编辑方案汇总的人）',
    devText19.includes('唯一能编辑'));

  const devLocked19 = renderText(internals.DevelopersEditor, { ...devBase19, identity: '李四' });
  check('非主导者看到主导者是谁，且变更入口说明为什么点不动',
    !/<crash: /.test(devLocked19) && devLocked19.includes('主导者：张三')
    && devLocked19.includes('只有主导者（张三）能变更'));
  check('主导者自己看时，变更入口不显示那句拒绝理由',
    !devText19.includes('只有主导者（张三）能变更'));

  const leaked19 = [...joined19.matchAll(/\b(?:design|impact|task|menu)\.[a-zA-Z.]+/g)]
    .map((match) => match[0])
    .filter((key) => !(key in (localeRegistrations[0]?.dicts.zh ?? {})));
  check('方案页没有漏加的文案键（漏了会显示 design.ai 这种原始 key）',
    leaked19.length === 0, [...new Set(leaked19)].join(', '));

  // —— 开发 / 测试 / 提版：全 9 块产物都渲染一遍
  const blockBase19 = {
    t,
    requirement: requirement19,
    stageId: 'develop',
    developer: '飞飞',
    editable: true,
    onChanged: () => {},
  };
  const blockTexts = [];
  for (const stageId of ['develop', 'test', 'release']) {
    for (const spec of internals.stageBlocks(stageId)) {
      const empty = internals.blockState(spec, { json: null, text: '' });
      blockTexts.push(renderText(internals.StageBlockSection, { ...blockBase19, stageId, spec, state: empty }));
    }
  }
  const blocksJoined = blockTexts.join(' | ');
  check('九个产物区块在空状态下都渲染不抛错', !/<crash: /.test(blocksJoined),
    (blocksJoined.match(/<crash: [^>]*>/) ?? [''])[0]);
  check('九个区块都渲染出标题（复用管线上的菜单文案）',
    ['变更清单', '提交记录', '开发自测', '测试用例', '执行结果', '缺陷跟踪', '版本号', '变更日志', '发布说明']
      .every((word) => blocksJoined.includes(word)));
  check('空区块给出「可以让 AI 起草」的说明，而不是一片空白',
    (blocksJoined.match(/还没有内容/g) ?? []).length >= 3);

  // 有数据时：列要按声明渲染，值要回填
  const changesSpec19 = internals.STAGE_BLOCKS.develop[0];
  const rowsText19 = renderText(internals.StageBlockSection, {
    ...blockBase19,
    spec: changesSpec19,
    state: internals.blockState(changesSpec19, { json: { items: [{ target: 'src/a.ts', note: '拆分导出', done: true }] } }),
  });
  check('有数据时按列回填（含勾选状态）',
    !/<crash: /.test(rowsText19) && rowsText19.includes('src/a.ts') && rowsText19.includes('拆分导出'));
  check('有数据时列头按声明渲染', rowsText19.includes('文件 / 模块') && rowsText19.includes('完成'));

  const casesSpec19 = internals.STAGE_BLOCKS.test[0];
  const casesText19 = renderText(internals.StageBlockSection, {
    ...blockBase19,
    stageId: 'test',
    spec: casesSpec19,
    state: internals.blockState(casesSpec19, { json: { items: [{ name: 'c1', expected: '不超时', result: 'pass' }] } }),
  });
  check('枚举列的选项文案被翻译（不是 opt.pass 这种原始 key）',
    casesText19.includes('通过') && !/opt\.[a-z]/.test(casesText19));

  const mdSpec19 = internals.STAGE_BLOCKS.release[2];
  const mdText19 = renderText(internals.StageBlockSection, {
    ...blockBase19,
    stageId: 'release',
    developer: '',
    spec: mdSpec19,
    state: internals.blockState(mdSpec19, { text: '# 发布说明\n这次上线了什么。' }),
  });
  check('markdown 块把正文渲染出来', mdText19.includes('这次上线了什么'));

  // 只读：不给任何编辑入口
  const lockedText19 = renderText(internals.StageBlockSection, {
    ...blockBase19,
    editable: false,
    spec: changesSpec19,
    state: internals.blockState(changesSpec19, { json: { items: [{ target: 'src/a.ts', done: false }] } }),
  });
  check('只读时没有保存按钮，也没有「新增一行」',
    !/<crash: /.test(lockedText19) && !lockedText19.includes('保存') && !lockedText19.includes('新增一行')
    && lockedText19.includes('src/a.ts'));

  const stagePageText19 = renderText(internals.StagePage, {
    ...blockBase19, stageId: 'develop', developer: '',
  });
  check('没有开发人员时阶段页给提示而不是崩',
    !/<crash: /.test(stagePageText19) && stagePageText19.includes('还没有登记开发人员'));

  // —— 我的任务
  const points19 = [
    { id: 'p1', name: '客户信息导出', assignee: '张三' },
    { id: 'p2', name: '对账接口改造', assignee: '飞飞' },
  ];
  const requirement19b = Object.assign({}, requirement19, { featurePoints: points19 });
  const mineProps19 = {
    t,
    requirement: requirement19b,
    developer: '飞飞',
    tasks: [
      { id: 't1', pointId: 'p2', title: '拆对账接口', estimate: 2, done: false },
      { id: 't2', pointId: '', title: '补文档', estimate: 0, done: false },
    ],
    changes: [{ taskId: 't1', target: 'src/a.ts', note: '', done: true }],
  };
  const mineText19 = renderText(internals.MyTasksSection, mineProps19);
  check('我的任务区块渲染不抛错', !/<crash: /.test(mineText19),
    (mineText19.match(/<crash: [^>]*>/) ?? [''])[0]);
  check('列出任务名与来源功能点，并给出每个任务的执行情况',
    mineText19.includes('拆对账接口') && mineText19.includes('补文档')
    && mineText19.includes('对账接口改造')
    && mineText19.includes('已完成') && mineText19.includes('未开工'));
  check('给出汇总（共几个 / 未开工 / 进行中 / 已完成）',
    /共 2 个/.test(mineText19) && /未开工 1/.test(mineText19) && /已完成 1/.test(mineText19));
  // 汇总区：不再是一句顿号串起来的长句，而是「组头（叫什么 + 几个）+ 成组的名字标签」。
  const todoTags19 = nodesWithClass(internals.MyTasksSection, mineProps19, 'wcw-taskTag');
  check('「还没有开工」列成一组标签，而不是一句顿号长句',
    mineText19.includes('还没有开工的任务') && !mineText19.includes('还没有开工的任务：')
    && todoTags19.length === 1 && todoTags19[0].props.title === '补文档'
    && mineText19.includes('1 个'),
    `标签 ${todoTags19.length} 个：[${todoTags19.map((node) => node.props.title).join(',')}]`);
  check('说明任务在方案页维护、变更清单里挂任务即可推进',
    mineText19.includes('任务在「方案」页维护') && mineText19.includes('挂到对应任务上'));
  check('只统计挂上任务的变更行数', !mineText19.includes('没有挂任务'));

  // —— 【执行】按钮：只给能改这条管线的人，点了先弹窗（弹窗里的指令可改）
  const execProps19 = { ...mineProps19, editable: true, sendPrompt: async () => {}, root: 'E:/ws/docs/requirements' };
  const execButtons19 = nodesWithClass(internals.MyTasksSection, execProps19, 'wcw-btn')
    .filter((node) => (node.children ?? []).join('') === '执行');
  check('每行任务后面都有一个【执行】按钮', execButtons19.length === 2,
    `实际 ${execButtons19.length} 个`);
  check('【执行】按钮挂的是任务名（悬停能看清要执行哪一个）',
    execButtons19.length === 2 && execButtons19[0].props.title.includes('拆对账接口')
    && execButtons19[1].props.title.includes('补文档'));
  check('加了执行按钮之后，汇总标签照旧（同一个组件里两处改动互不影响）',
    nodesWithClass(internals.MyTasksSection, execProps19, 'wcw-taskTag').length === 1);

  const lockedMine19 = renderText(internals.MyTasksSection, {
    ...mineProps19, editable: false, sendPrompt: async () => {}, root: 'E:/ws/docs/requirements',
  });
  check('看别人的管线时不给【执行】（不该用别人的名义去改代码）',
    !/<crash: /.test(lockedMine19) && !lockedMine19.includes('执行'));

  // —— 执行指令：这是一段要给 AI 的契约，路径、任务 id、纪律逐条钉住
  const prompt19 = internals.taskExecutePrompt({
    id: 'XQ20260917-0004',
    title: '客户经营信息优化',
    developer: '飞飞',
    root: 'E:/ws/docs/requirements',
    task: mineProps19.tasks[0],
    points: points19,
  });
  check('执行指令带上需求编号、任务名与来源功能点',
    prompt19.includes('XQ20260917-0004') && prompt19.includes('拆对账接口') && prompt19.includes('对账接口改造'));
  check('执行指令把方案层与需求层的绝对路径写死（AI 不用猜）',
    prompt19.includes('E:/ws/docs/requirements/XQ20260917-0004/Pipeline/方案/飞飞/draft.md')
    && prompt19.includes('Pipeline/方案/飞飞/apis.json') && prompt19.includes('Pipeline/方案/飞飞/tasks.json'));
  check('执行指令点名要读写开发管线那两个文件',
    prompt19.includes('E:/ws/docs/requirements/XQ20260917-0004/Pipeline/开发/飞飞/changes.json')
    && prompt19.includes('Pipeline/开发/飞飞/selftest.json'));
  check('执行指令要求 taskId 逐字填任务 id（否则变更挂不上任务）', prompt19.includes('taskId 逐字填 "t1"'));
  check('执行指令要求 done 先填 false（勾选是人的复核，不是 AI 的自我评价）',
    prompt19.includes('done 一律先填 false'));
  check('执行指令把「只做这一个任务」和「找不到就说找不到」写成硬要求',
    prompt19.includes('只做这一个任务的范围') && prompt19.includes('如实说明找不到'));
  check('没有方案时要求 AI 停下来说清楚，而不是照着需求凭空实现',
    prompt19.includes('先别动手') && prompt19.includes('还没有方案'));
  check('执行指令里带上了子 agent 纪律（上游只读、不碰别人的目录）',
    prompt19.includes('开一个只做「开发」的子 agent') && prompt19.includes('上游内容**只读**'));
  check('执行指令对没有 id 的任务也说得清（不会拼出一个空 taskId 还让人照抄）',
    internals.taskExecutePrompt({
      id: 'XQ1', title: 't', developer: '飞飞', root: '/r',
      task: { id: '', pointId: '', title: '手工补的活', estimate: 0, done: false }, points: [],
    }).includes('这个任务没有 id'));

  // 弹窗是通用的：开发页的任务、测试页的用例共用它，说明由调用方作为**已翻译的文本**传进来。
  const dialogText19 = renderText(internals.ExecuteDialog, {
    t,
    title: '执行任务：拆对账接口',
    note: 'AI 会读这个人的方案、按方案实现这一个任务；写完页面会自动刷新。',
    writes: 'AI 会把每条改动追加进下面的「变更清单」并补「开发自测」项。**勾选留给你复核** —— 所以新记进来的行一律是未完成。',
    prompt: prompt19, onSend: async () => {}, onClose: () => {},
  });
  check('执行前先弹窗：标题点名任务、正文就是那段指令、按钮是发送/恢复/取消',
    !/<crash: /.test(dialogText19) && dialogText19.includes('执行任务：拆对账接口')
    && dialogText19.includes('taskId 逐字填 "t1"')
    && dialogText19.includes('发送给对话') && dialogText19.includes('恢复默认指令') && dialogText19.includes('取消'));
  check('弹窗明说「勾选留给你复核」（不说就等于让人以为已经是完成态）',
    dialogText19.includes('勾选留给你复核'));

  const manualDialog19 = renderText(internals.ExecuteDialog, {
    t, title: '执行任务：拆对账接口', prompt: prompt19, onClose: () => {},
  });
  check('会话通道不可用时改说「复制到对话里」，而不是让按钮静默失效',
    manualDialog19.includes('先复制到对话里') && !manualDialog19.includes('发给 AI 的指令'));
  check('弹窗自己不认识阶段：没给说明就不硬塞一句开发页的话', !manualDialog19.includes('变更清单'));

  // —— 测试页：每条用例后面也有【执行】（挨在【删除】前面），跑完把结果落回去
  const execCasesSpec19 = internals.STAGE_BLOCKS.test[0];
  const caseRow19 = { name: '客户列表分页返回', expected: '第一页 20 条且带总数', result: 'pending' };
  const caseProps19 = {
    ...blockBase19,
    stageId: 'test',
    spec: execCasesSpec19,
    state: internals.blockState(execCasesSpec19, { json: { items: [caseRow19] } }),
  };
  const caseLabels19 = nodesWithClass(internals.StageBlockSection, caseProps19, 'wcw-btn')
    .map((node) => (node.children ?? []).join(''));
  check('测试用例那一行有【执行】，且排在【删除】前面',
    !/<crash: /.test(renderText(internals.StageBlockSection, caseProps19))
    && caseLabels19.join(',') === '已保存,执行,删除,新增一行',
    caseLabels19.join(','));

  const runsSpec19 = internals.STAGE_BLOCKS.test[1];
  const runsLabels19 = nodesWithClass(internals.StageBlockSection, {
    ...blockBase19,
    stageId: 'test',
    spec: runsSpec19,
    state: internals.blockState(runsSpec19, { json: { items: [{ at: '2026-09-20T10:00', passed: '3', failed: '0', note: '' }] } }),
  }, 'wcw-btn').map((node) => (node.children ?? []).join(''));
  check('只有声明了 execute 的块才有【执行】（执行记录不是"跑的对象"）',
    runsLabels19.join(',') === '已保存,删除,新增一行', runsLabels19.join(','));

  const lockedCase19 = renderText(internals.StageBlockSection, { ...caseProps19, editable: false });
  check('看别人的测试管线时不给【执行】（不该替别人跑）',
    !/<crash: /.test(lockedCase19) && !lockedCase19.includes('执行'));

  const unnamedCaseButtons19 = nodesWithClass(internals.StageBlockSection, {
    ...blockBase19,
    stageId: 'test',
    spec: execCasesSpec19,
    state: internals.blockState(execCasesSpec19, { json: { items: [{ name: '', expected: '', result: 'pending' }] } }),
  }, 'wcw-btn').filter((node) => (node.children ?? []).join('') === '执行');
  check('用例没写名字时，执行按钮用「第 N 条」说清跑的是哪一条',
    unnamedCaseButtons19.length === 1 && unnamedCaseButtons19[0].props.title === '执行用例：第 1 条',
    unnamedCaseButtons19[0] === undefined ? '没有执行按钮' : String(unnamedCaseButtons19[0].props.title));

  // —— 用例执行指令：路径、这一次的范围、要落盘的三份结果、以及"跑不了要说跑不了"
  const casePrompt19 = internals.testCaseExecutePrompt({
    id: 'XQ20260917-0004', title: '客户经营信息优化', developer: '飞飞',
    root: 'E:/ws/docs/requirements', row: caseRow19, index: 2,
  });
  check('用例执行指令点名这是第几条，并把「预期」带上（用例没有 id，定位全靠这几个）',
    casePrompt19.includes('客户列表分页返回') && casePrompt19.includes('第 3 条')
    && casePrompt19.includes('第一页 20 条且带总数'));
  check('用例执行指令给出要读的方案与开发产物路径（AI 不用猜）',
    casePrompt19.includes('E:/ws/docs/requirements/XQ20260917-0004/Pipeline/方案/飞飞/')
    && casePrompt19.includes('E:/ws/docs/requirements/XQ20260917-0004/Pipeline/开发/飞飞/'));
  check('用例执行指令把三份要落盘的结果与形状写死（形状由声明表生成）',
    casePrompt19.includes('Pipeline/测试/飞飞/cases.json')
    && casePrompt19.includes('Pipeline/测试/飞飞/runs.json')
    && casePrompt19.includes('Pipeline/测试/飞飞/defects.json')
    && casePrompt19.includes(internals.blockShapeText(execCasesSpec19, '飞飞')));
  check('★ 跑不了就如实说跑不了、结果留在未做（编一个"通过"是最坏的结果）',
    casePrompt19.includes('跑不了') && casePrompt19.includes('留在 pending')
    && casePrompt19.includes('不要编一个"通过"'));
  check('用例执行指令重申本阶段口径：只做简单接口测试、不补重型验证',
    casePrompt19.includes('简单的接口测试') && casePrompt19.includes('并发 / 幂等 / 事务 / 性能'));
  check('用例执行指令要求认准是哪一行、重名就停下来问（不许猜一行改）',
    casePrompt19.includes('三者一起认') && casePrompt19.includes('停下来问'));
  check('用例执行指令带子 agent 纪律，且只要这一条',
    casePrompt19.includes('开一个只做「测试」的子 agent') && casePrompt19.includes('别的用例不要顺手一起改'));
  check('行名取声明里的第一个文本列（勾选列与枚举列不算名字）',
    internals.rowLabel(execCasesSpec19, { name: 'A', expected: '', result: 'pending' }) === 'A'
    && internals.rowLabel(execCasesSpec19, { name: '  ', expected: 'B', result: 'pending' }) === 'B'
    && internals.rowLabel(execCasesSpec19, { name: '', expected: '', result: 'pass' }) === '');

  const gapText19 = renderText(internals.MyTasksSection, {
    ...mineProps19,
    // 分派给「飞飞」的功能点一个任务都没有 → 走缺口分支
    tasks: [],
    changes: [],
  });
  check('一个任务都没有时给出去方案页建骨架的指引',
    !/<crash: /.test(gapText19) && gapText19.includes('方案里还没有你的任务'));

  const gapOnly19 = renderText(internals.MyTasksSection, {
    ...mineProps19,
    tasks: [{ id: 't1', pointId: 'p1', title: '别人的活', estimate: 0, done: false }],
  });
  check('有任务但功能点没覆盖到时会点名缺口',
    !/<crash: /.test(gapOnly19) && gapOnly19.includes('还没有任何任务'));
  const gapGroups19 = nodesWithClass(internals.MyTasksSection, {
    ...mineProps19,
    tasks: [{ id: 't1', pointId: 'p1', title: '别人的活', estimate: 0, done: false }],
  }, 'wcw-taskGroup');
  const gapGroupText19 = renderText(internals.TaskNameGroup, {
    t, labelKey: 'mine.groupGap', tone: 'gap', names: ['对账接口改造'],
  });
  check('缺口单独成一组，并用错误色标出来（不混在灰色小字里）',
    gapGroups19.length === 1 && gapGroups19[0].props['data-tone'] === 'gap'
    && gapGroupText19.includes('这些功能点还没有任何任务') && gapGroupText19.includes('1 个')
    && gapGroupText19.includes('对账接口改造'),
    `实际 ${gapGroups19.length} 组`);

  const untagged19 = renderText(internals.MyTasksSection, {
    ...mineProps19,
    changes: [{ taskId: '', target: 'src/a.ts', note: '', done: false }],
  });
  check('有变更没挂任务时会说出来', untagged19.includes('没有挂任务'));

  // 任务列（动态选项）也要能渲染
  const taskCell19 = renderText(internals.StageBlockSection, {
    ...blockBase19,
    spec: internals.STAGE_BLOCKS.develop[0],
    state: internals.blockState(internals.STAGE_BLOCKS.develop[0], { json: { items: [{ taskId: 't1', target: 'a.ts', note: '', done: false }] } }),
    taskOptions: [{ id: 't1', label: '拆对账接口' }],
  });
  check('任务列渲染出选项，且未关联时有个空选项',
    !/<crash: /.test(taskCell19) && taskCell19.includes('对应任务')
    && taskCell19.includes('拆对账接口') && taskCell19.includes('（未关联任务）'));

  const leakedStage19 = [...blocksJoined.matchAll(/\b(?:stage|col|opt|field|ph|summary|menu|mine)\.[a-zA-Z.]+/g)]
    .map((match) => match[0])
    .filter((key) => !(key in (localeRegistrations[0]?.dicts.zh ?? {})));
  check('阶段页没有漏加的文案键', leakedStage19.length === 0, [...new Set(leakedStage19)].join(', '));
}

// ── 20. 开发 / 测试 / 提版：声明表驱动的阶段页 ─────────────────────────────
// 这三个页面不是三段各写一遍的代码，而是同一张声明表 + 同一个渲染器。所以这一节
// 断言的也正是那三件事：路径怎么拼、产物填成什么样才算完成、给 AI 的指令长什么样。
console.log('\n[20] 开发 / 测试 / 提版：声明表驱动的阶段页');
if (internals !== undefined && internals !== null) {
  const { stageDir, stageBlockPath, stageBlocks, stageIsPerPerson, blockState, blockFilled,
    normalizeRow, stageVerdict, stagePrompt, blockShapeText, blockPayload, STAGE_BLOCKS, OPTION_KEY, STAGE_DONE_KEY } = internals;

  // —— 路径：按人 vs 共享
  check('开发 / 测试按人各一个子目录', stageIsPerPerson('develop') === true && stageIsPerPerson('test') === true
    && stageDir('develop', '张三') === 'Pipeline/开发/张三'
    && stageDir('test', '李四') === 'Pipeline/测试/李四');
  check('提版是共享阶段：不带任何人的子目录',
    stageIsPerPerson('release') === false && stageDir('release', '张三') === 'Pipeline/提版'
    && stageDir('release', '') === 'Pipeline/提版');
  check('产物路径 = 阶段目录 + 文件名', stageBlockPath('test', '李四', 'cases.json') === 'Pipeline/测试/李四/cases.json'
    && stageBlockPath('release', '', 'notes.md') === 'Pipeline/提版/notes.md');
  check('三个阶段各三块产物，文件名与菜单一一对应',
    [['develop', 'changes.json,commits.json,selftest.json'],
      ['test', 'cases.json,runs.json,defects.json'],
      ['release', 'release.json,changelog.md,notes.md']].every(([stageId, files]) => (
      stageBlocks(stageId).map((block) => block.file).join(',') === files)));

  // —— 填没填
  const rowsSpec = STAGE_BLOCKS.develop[0];
  const fieldsSpec = STAGE_BLOCKS.release[0];
  const mdSpec = STAGE_BLOCKS.release[1];
  check('rows：没有行就没填',
    blockFilled(rowsSpec, blockState(rowsSpec, { json: { items: [] } })) === false
    && blockFilled(rowsSpec, blockState(rowsSpec, { json: { items: [{ target: 'a.ts' }] } })) === true);
  check('fields：全空算没填，填一个就算',
    blockFilled(fieldsSpec, blockState(fieldsSpec, { json: {} })) === false
    && blockFilled(fieldsSpec, blockState(fieldsSpec, { json: { version: '1.0.0' } })) === true);
  check('markdown：只有空白算没填',
    blockFilled(mdSpec, blockState(mdSpec, { text: '   \n ' })) === false
    && blockFilled(mdSpec, blockState(mdSpec, { text: '# 说明' })) === true);

  // —— 行的规范化：类型不对要落回默认值，而不是把坏数据带到界面上
  const badRow = normalizeRow(rowsSpec, { target: 42, note: null, done: 'yes' });
  check('坏行被规范成默认值（不会把数字/字符串当成文本渲染）',
    badRow.target === '' && badRow.note === '' && badRow.done === false);
  const selectSpec = STAGE_BLOCKS.develop[2];
  check('select 列：非法值落回第一个选项',
    normalizeRow(selectSpec, { result: '瞎写的' }).result === 'pending'
    && normalizeRow(selectSpec, { result: 'pass' }).result === 'pass');

  // —— 完成条件：这是「已审核」的唯一依据，逐条钉住
  const rows = (spec, items) => blockState(spec, { json: { items } });
  const states = (spec, items) => ({ [spec.file]: rows(spec, items) });
  const changesSpec = STAGE_BLOCKS.develop[0];
  const commitsSpec = STAGE_BLOCKS.develop[1];
  const selftestSpec = STAGE_BLOCKS.develop[2];
  const casesSpec = STAGE_BLOCKS.test[0];
  const defectsSpec = STAGE_BLOCKS.test[2];

  check('阶段判定：一块都没写 -> 未开始',
    stageVerdict('develop', {}) === 'pending' && stageVerdict('test', {}) === 'pending'
    && stageVerdict('release', {}) === 'pending');
  check('开发：只写了变更清单 -> 进行中',
    stageVerdict('develop', states(changesSpec, [{ target: 'a.ts', done: false }])) === 'active');
  check('开发：变更全部勾完但自测没做 -> 仍进行中（两个条件都要满足）',
    stageVerdict('develop', Object.assign(
      states(changesSpec, [{ target: 'a.ts', done: true }]),
      states(selftestSpec, []),
    )) === 'active');
  check('开发：变更全勾完 + 自测全通过 -> 已审核',
    stageVerdict('develop', Object.assign(
      states(changesSpec, [{ target: 'a.ts', done: true }]),
      states(selftestSpec, [{ item: '空数据', result: 'pass' }]),
    )) === 'approved');
  check('开发：自测有一项失败 -> 进行中',
    stageVerdict('develop', Object.assign(
      states(changesSpec, [{ target: 'a.ts', done: true }]),
      states(selftestSpec, [{ item: '空数据', result: 'fail' }]),
    )) === 'active');
  check('提交记录不参与开发阶段的完成判定（它只是记录）',
    stageVerdict('develop', states(commitsSpec, [{ hash: 'abc' }])) === 'active');
  check('测试：用例有失败 -> 进行中；全通过且无未关闭缺陷 -> 已审核',
    stageVerdict('test', states(casesSpec, [{ name: 'c1', result: 'fail' }])) === 'active'
    && stageVerdict('test', states(casesSpec, [{ name: 'c1', result: 'pass' }])) === 'approved');
  check('测试：有未关闭的缺陷就不算完成（修复中 / 待修都拦）',
    stageVerdict('test', Object.assign(
      states(casesSpec, [{ name: 'c1', result: 'pass' }]),
      states(defectsSpec, [{ title: 'd1', status: 'open' }]),
    )) === 'active'
    && stageVerdict('test', Object.assign(
      states(casesSpec, [{ name: 'c1', result: 'pass' }]),
      states(defectsSpec, [{ title: 'd1', status: 'fixing' }]),
    )) === 'active');
  check('测试：缺陷已关闭就放行',
    stageVerdict('test', Object.assign(
      states(casesSpec, [{ name: 'c1', result: 'pass' }]),
      states(defectsSpec, [{ title: 'd1', status: 'closed' }]),
    )) === 'approved');
  check('提版：只填版本号 -> 进行中；版本号 + 发布说明 -> 已审核',
    stageVerdict('release', { 'release.json': blockState(fieldsSpec, { json: { version: '1.0.0' } }) }) === 'active'
    && stageVerdict('release', {
      'release.json': blockState(fieldsSpec, { json: { version: '1.0.0' } }),
      'notes.md': blockState(mdSpec, { text: '# 发布说明' }),
    }) === 'approved');
  check('没有声明块的阶段返回 null（不假装知道）', stageVerdict('design', {}) === null
    && stageVerdict('nope', {}) === null);

  // —— 给 AI 的指令：形状由同一张表生成，所以表改了指令就跟着改
  const devPrompt = stagePrompt('develop', {
    id: 'XQ20260917-0004', title: '多人协作示例', root: 'E:/ws/docs/requirements', developer: '飞飞',
  });
  check('指令给出这一阶段的全部产物路径',
    ['changes.json', 'commits.json', 'selftest.json'].every((file) => devPrompt.includes('Pipeline/开发/飞飞/' + file)));
  check('按人阶段：指令点名写给谁', devPrompt.includes('飞飞'));
  check('指令禁止写别的文件和别的阶段',
    /只写上面列出的文件/.test(devPrompt) && /不要改动其它阶段的任何文件/.test(devPrompt));
  check('指令里的枚举值来自表声明（表改了指令就跟着改）',
    devPrompt.includes('"result": "pending|pass|fail"'));
  check('指令里的 JSON 形状带上了按人的 developer 字段',
    devPrompt.includes('"developer": "飞飞"'));
  const relPrompt = stagePrompt('release', {
    id: 'XQ20260917-0004', title: '多人协作示例', root: 'E:/ws/docs/requirements', developer: '飞飞',
  });
  check('共享阶段：指令里没有按人子目录，也没有 developer 字段',
    relPrompt.includes('Pipeline/提版/release.json') && !relPrompt.includes('Pipeline/提版/飞飞')
    && !relPrompt.includes('"developer"'));
  check('markdown 块在指令里写成「Markdown 正文」而不是 JSON',
    relPrompt.includes('Markdown 正文') && blockShapeText(mdSpec, '') === 'Markdown 正文');
  check('日期字段在指令里给出格式',
    relPrompt.includes('"releasedAt": "YYYY-MM-DD"'));

  /**
   * 阶段专属规则（`STAGE_RULES`）。
   *
   * 用户明确过「测试」这一层的口径：**不做功能点的完整详细测试**，代码质量由 AI 读代码检查，
   * 测试只做**简单的接口测试**。这条只写在人脑子里是不够的 —— 换个会话让 AI 再跑一次，
   * 它会按最省事的默认（穷举、堆量）去写，产出几百条没人会跑的用例。
   * 所以：规则必须**出现在指令里**，而且**只出现在该出现的阶段**。
   */
  {
    const testPrompt = stagePrompt('test', {
      id: 'XQ20260917-0004', title: '多人协作示例', root: 'E:/ws/docs/requirements', developer: '飞飞',
    });
    check('测试阶段指令里写死了"不做完整详细测试、只做简单接口测试"这条规则',
      testPrompt.includes('不做功能点的完整详细测试') && testPrompt.includes('简单的接口测试'));
    check('测试阶段指令点名"代码质量由 AI 自己读代码检查"（不是靠堆用例）',
      testPrompt.includes('AI 自己读代码检查'));
    check('测试阶段指令给出量级上限（一个接口 1–2 条、几十条以内）',
      testPrompt.includes('一个接口 1–2 条') && testPrompt.includes('几十条以内'));
    check('测试阶段指令明确不要重型用例（并发/幂等/事务/性能）',
      testPrompt.includes('不要写并发') && testPrompt.includes('幂等') && testPrompt.includes('性能'));
    check('★ 这条规则**只属于测试阶段**（别的阶段指令里不许出现，免得污染）',
      !devPrompt.includes('不做功能点的完整详细测试') && !relPrompt.includes('不做功能点的完整详细测试')
      && !devPrompt.includes('简单的接口测试') && !relPrompt.includes('简单的接口测试'));
    check('规则表里登记的是「方案 + 测试」两条（新增阶段规则要显式加进去，不靠"到处都加"）',
      Object.keys(internals.STAGE_RULES).join(',') === 'design,test',
      Object.keys(internals.STAGE_RULES).join(','));

    /**
     * 方案这一层的口径（用户明确过）：方案**核心目的是指导开发怎么动手**，
     * 所以它必须先回答"后端要改或新增哪些接口 / 前端要改或新增哪些页面"。
     * 这条同样只写在人脑子里是不够的 —— 换个会话让 AI 再跑一次，它会写回一篇综述。
     */
    {
      const designAi = internals.designPrompt({
        id: 'XQ20260917-0004', title: '多人协作示例', developer: '飞飞', root: 'E:/ws', points: [], hasDraft: false,
      });
      check('方案指令要求**先出接口清单和页面清单，再写正文**',
        designAi.includes('后端接口清单') && designAi.includes('前端页面清单')
        && designAi.includes('正文是这两张表的叙述版'));
      check('方案指令点名"路径没定就写路径待确认"（不许编一个像真的路径）',
        designAi.includes('路径待确认') && designAi.includes('不要编一个像真的路径'));
      check('方案指令区分「识别到工程」与「没识别到工程」两种写法',
        designAi.includes('识别到可改的既有工程') && designAi.includes('没有识别到工程'));
      check('方案指令里的清单形状**由声明表生成**（表里加一列，指令里就多一列）',
        designAi.includes(internals.designListShapeText(internals.DESIGN_LISTS.apis, '飞飞'))
        && designAi.includes(internals.designListShapeText(internals.DESIGN_LISTS.pages, '飞飞')));
      check('★ 测试阶段那条规则**不会漏进方案指令**（两条口径别互相污染）',
        !designAi.includes('不做功能点的完整详细测试') && !designAi.includes('简单的接口测试'));
    }
  }

  check('写盘形状带上 schema 与时间戳；按人阶段带 developer',
    blockPayload(rowsSpec, '飞飞', []).schema === 1
    && typeof blockPayload(rowsSpec, '飞飞', []).updatedAt === 'string'
    && blockPayload(rowsSpec, '飞飞', []).developer === '飞飞'
    && blockPayload(rowsSpec, '', []).developer === undefined
    && Array.isArray(blockPayload(rowsSpec, '飞飞', []).items));

  // —— 动态键也要有牙：表里的每一个键都必须在两份词典里
  {
    const dicts = localeRegistrations.length === 1 ? localeRegistrations[0].dicts : { zh: {}, en: {} };
    const dynamic = [...Object.values(OPTION_KEY), ...Object.values(STAGE_DONE_KEY)];
    const absent = dynamic.filter((key) => !(key in dicts.zh) || !(key in dicts.en));
    check('显式键表里的每个键都在 zh 与 en 里（拼字符串就测不到了）',
      absent.length === 0, absent.join(', '));
    check('两个键表覆盖了所有枚举与阶段',
      Object.keys(OPTION_KEY).length === 11 && Object.keys(STAGE_DONE_KEY).length === 3);

    // 声明表里的 titleKey / labelKey / placeholderKey 同样是**值**而不是 `t('...')` 调用，
    // 所以 [14] 那条静态扫描一个都看不到 —— 拼错一个列名，界面会直接显示原始 key，
    // 而没有东西拦得住。这里把整张表走一遍。
    const tableKeys = [];
    for (const stageId of Object.keys(STAGE_BLOCKS)) {
      for (const block of STAGE_BLOCKS[stageId]) {
        tableKeys.push(block.titleKey);
        for (const field of Array.isArray(block.fields) ? block.fields : []) {
          tableKeys.push(field.labelKey);
          if (field.placeholderKey !== undefined) tableKeys.push(field.placeholderKey);
        }
        for (const column of Array.isArray(block.columns) ? block.columns : []) {
          tableKeys.push(column.labelKey);
          if (column.placeholderKey !== undefined) tableKeys.push(column.placeholderKey);
        }
      }
    }
    // 方案阶段那两张清单（接口 / 页面）不在 STAGE_BLOCKS 里（它决定阶段完成判定），
    // 但它的列名同样是**值**而不是 t('...') 调用，所以必须一起走一遍。
    for (const spec of Object.values(internals.DESIGN_LISTS)) {
      tableKeys.push(spec.titleKey);
      for (const column of Array.isArray(spec.columns) ? spec.columns : []) {
        tableKeys.push(column.labelKey);
        if (column.placeholderKey !== undefined) tableKeys.push(column.placeholderKey);
      }
    }
    const absentTable = tableKeys.filter((key) => !(key in dicts.zh) || !(key in dicts.en));
    check('声明表里的每个标题 / 列名 / 占位符键都在 zh 与 en 里（[14] 看不到这些）',
      absentTable.length === 0, absentTable.join(', '));
    check('声明表的键确实被收集全了（不是空跑）', tableKeys.length >= 40, `${tableKeys.length} 个`);
  }

  // —— 逐行【执行】的声明表：键要在两份词典里、构造函数要真的接得上、"能被跑"的块才声明
  {
    const dicts = localeRegistrations.length === 1 ? localeRegistrations[0].dicts : { zh: {}, en: {} };
    const execKeys = [];
    for (const entry of Object.values(internals.BLOCK_EXECUTE)) {
      execKeys.push(entry.titleKey, entry.noteKey, entry.writesKey);
    }
    const absentExec = execKeys.filter((key) => !(key in dicts.zh) || !(key in dicts.en));
    check('逐行执行表里的每个键都在 zh 与 en 里（值不是 t() 调用，静态扫描看不到）',
      absentExec.length === 0 && execKeys.length === 3, absentExec.join(', '));
    check('执行表指向真的指令构造函数（声明与实物不许两张皮）',
      internals.BLOCK_EXECUTE.case.prompt === internals.testCaseExecutePrompt);
    check('只有能被"跑一遍"的块声明了 execute（执行记录 / 缺陷记录不在其中）',
      internals.STAGE_BLOCKS.test.filter((block) => block.execute !== undefined)
        .map((block) => block.file).join(',') === 'cases.json'
      && internals.STAGE_BLOCKS.develop.every((block) => block.execute === undefined));
  }

  // —— 三个阶段不再是占位
  check('占位阶段组件已删除（三个页面都是真的了）', !/function PlaceholderStage/.test(source));
  check('「功能待定」文案键已清理', !/tbd\./.test(source));
  // —— 三个阶段的产物声明都在表里
  check('三个阶段的产物声明都在表里',
    ['develop', 'test', 'release'].every((stageId) => stageBlocks(stageId).length === 3));

  // —— 客户端的目录名必须与宿主半边逐字一致：两边只要有一边改名，
  //     产物就会落到一个宿主认不出的目录里，而那种错**不会报任何错**。
  {
    const host = await import(pathToFileURL(join(packageRoot, 'index.js')).href);
    check('客户端的阶段目录名与宿主半边的 STAGE_DIRS 逐字一致',
      internals.STAGES.map((stage) => stage.dir).join(',') === host.STAGE_DIRS.join(','),
      `客户端 ${internals.STAGES.map((stage) => stage.dir).join(',')} / 宿主 ${host.STAGE_DIRS.join(',')}`);
    check('声明表里的产物没有一个是别的阶段不会碰的共享文件（都落在各自阶段目录下）',
      ['develop', 'test', 'release'].every((stageId) => stageBlocks(stageId)
        .every((block) => !block.file.includes('/') && !block.file.includes('\\'))));
  }

  // —— 我的任务：方案 → 开发的连接点
  const { taskProgress, progressSummary, taskGaps, taskName, TASK_STATE_KEY } = internals;
  const task = (id, extra) => Object.assign({ id, pointId: 'p1', title: 'T' + id, estimate: 1, done: false }, extra);
  const change = (taskId, done) => ({ taskId, target: 'a.ts', note: '', done });

  check('变更清单里有一列把每行挂到任务上（执行情况就是这么推出来的）',
    STAGE_BLOCKS.develop[0].columns.some((column) => column.type === 'task' && column.key === 'taskId'));
  const taskColumnShape = blockShapeText(STAGE_BLOCKS.develop[0], '飞飞');
  check('指令说明任务 id 的出处（否则 AI 会自己编一个，永远关联不上）',
    taskColumnShape.includes('taskId') && taskColumnShape.includes('方案的任务拆分'));

  const prog = taskProgress(
    [task('t1'), task('t2'), task('t3')],
    [change('t1', true), change('t1', true), change('t2', false), change('t2', true)],
  );
  check('执行情况：变更全勾完 -> 已完成；只勾了一部分 -> 进行中；一条变更都没有 -> 未开工',
    prog.map((row) => row.state).join(',') === 'done,doing,todo',
    prog.map((row) => row.state).join(','));
  check('每个任务挂了几条变更、勾了几条都算得出来',
    prog.map((row) => row.changes.length + '/' + row.doneChanges).join(' ') === '2/2 2/1 0/0');
  check('方案页上手工勾的「完成」也算完成（没有变更也不影响）',
    taskProgress([task('t9', { done: true })], []).at(0).state === 'done');
  check('没有任务 id 的变更不会被挂到任何任务上（宁可算未开工，也不算错）',
    taskProgress([task('t1')], [change('', true), change(undefined, true)]).at(0).state === 'todo');
  check('没有对应变更的任务，作者/标题都还在（不会因为没进度就不显示）',
    prog.at(2).task.title === 'Tt3');
  check('执行情况汇总', (() => {
    const summary = progressSummary(prog);
    return summary.count === 3 && summary.todo === 1 && summary.doing === 1 && summary.done === 1;
  })());
  check('汇总容忍坏输入', progressSummary(null).count === 0 && taskProgress(null, null).length === 0);

  const points20 = [
    { id: 'p1', name: '导出', assignee: '张三' },
    { id: 'p2', name: '对账', assignee: '张三' },
    { id: 'p3', name: '权限', assignee: '李四' },
  ];
  const gaps20 = taskGaps(points20, '张三', [task('t1', { pointId: 'p1' })]);
  check('缺口 = 分派给我、但一个任务都没有的功能点',
    gaps20.length === 1 && gaps20[0].name === '对账', gaps20.map((point) => point.name).join(','));
  check('缺口只看我的功能点（别人的不算我头上）',
    taskGaps(points20, '李四', [task('t1', { pointId: 'p1' })]).map((point) => point.id).join(',') === 'p3');
  check('任务名回退顺序：任务标题 -> 来源功能点名 -> 任务 id',
    taskName({ id: 'x', pointId: 'p1', title: '我起的' }, points20) === '我起的'
    && taskName({ id: 'x', pointId: 'p1', title: '' }, points20) === '导出'
    && taskName({ id: 'x', pointId: '', title: '  ' }, points20) === 'x');

  {
    const dicts = localeRegistrations.length === 1 ? localeRegistrations[0].dicts : { zh: {}, en: {} };
    const absentTask = Object.values(TASK_STATE_KEY).filter((key) => !(key in dicts.zh) || !(key in dicts.en));
    check('任务状态的文案键也在两份词典里', absentTask.length === 0, absentTask.join(', '));
    check('任务状态表覆盖三种取值',
      Object.keys(TASK_STATE_KEY).join(',') === 'todo,doing,done');
  }
  check('「我的任务」的出现由声明决定，不由阶段名硬编码',
    /const needsTasks = spec\.some\(/.test(source) && !/stageId === 'develop' \?/.test(source));

  // —— 开发 / 测试 也接上真实状态（管线徽标不再恒为「未开始」）
  check('管线的开发 / 测试徽标来自真实产物',
    (() => {
      const base = { status: 'active', clarifications: [], developers: ['张三'], featurePoints: [] };
      const none = internals.deriveStageStatus(base, '张三', { develop: 'pending', test: 'pending' });
      const some = internals.deriveStageStatus(base, '张三', { develop: 'active', test: 'pending' });
      const all = internals.deriveStageStatus(base, '张三', { develop: 'approved', test: 'approved', release: 'approved' });
      return none.develop === 'pending' && some.develop === 'active'
        && all.develop === 'approved' && all.test === 'approved' && all.release === 'approved';
    })(),
    '提版是公共阶段，它的状态与有没有开发人员无关');
}

// ── 21. 刷新不许清空数据 ───────────────────────────────────────────────────
// 「页面有点慢」实测下来不是 I/O：每次 RPC 只要 1.5–3 ms，打开页签 16 个请求合计
// 不到 40 ms。真正的来源是**加载状态本身** —— 每次保存都把整块面板换成「读取中…」
// 再换回来。它不是慢，是闪。
//
// 这条规则很容易在后续改动里悄悄回归，而回归的表现只是「闪一下」，
// 不会有任何断言变红 —— 所以判定被抽成纯函数，在这里钉住。
console.log('\n[21] 刷新不许清空数据');
if (internals !== undefined && internals !== null) {
  const { readState } = internals;
  const loaded = { status: 'ready', data: { draft: '# 方案' }, error: null, refreshing: false };

  const refreshed = readState(loaded, true);
  check('同一个读取对象再读一次 -> **保留上一份数据**（面板不闪）',
    refreshed.status === 'ready' && refreshed.data === loaded.data && refreshed.refreshing === true,
    JSON.stringify(refreshed));
  check('刷新时数据是同一份引用（不是复制一份新的，避免子组件无谓重渲染）',
    refreshed.data === loaded.data);

  const switched = readState(loaded, false);
  check('换了读取对象 -> 必须清空（否则会拿张三的方案冒充李四的）',
    switched.status === 'loading' && switched.data === null && switched.refreshing === false,
    JSON.stringify(switched));

  check('第一次读取 -> loading', readState(null, true).status === 'loading'
    && readState(undefined, true).status === 'loading');
  check('上一次是 loading -> 仍是 loading（没有数据可留）',
    readState({ status: 'loading', data: null }, true).status === 'loading');
  check('上一次是 error -> 回到 loading（错误没有数据可留）',
    readState({ status: 'error', data: null, error: 'x' }, true).status === 'loading');
  check('上一次 error 但对象没变，也不会把错误留在屏幕上', readState({ status: 'error', data: null, error: 'x' }, true).error === null);

  // 结构上钉住：刷新令牌必须是**单独的参数**，不能混进 subjectDeps ——
  // 混进去就再也分不清「刷新」和「换对象」，这条修复会整个失效。
  check('刷新令牌是独立参数，没有混进 deps',
    /function useAsync\(load, subjectDeps, refreshToken, cacheKey\)/.test(source) && !/\bnounce\]/.test(source));
  check('每个会重新读取的 useAsync 都传了刷新令牌', (source.match(/\n\t\t\t\tnonce,\n/g) ?? []).length >= 6,
    `${(source.match(/\n\t\t\t\tnonce,\n/g) ?? []).length} 处`);

  // —— 缓存：切走再切回来不该重走一遍「读取中…」
  const { createReadCache, READ_CACHE_MAX, WRITE_OPS } = internals;
  const cache = createReadCache(3);
  check('缓存：存进去能取出来', (() => {
    cache.set('a', 1);
    return cache.get('a') === 1;
  })());
  check('缓存：没有的键返回 undefined（不是 null —— 调用方靠它区分「没缓存」）',
    cache.get('nope') === undefined && cache.get(undefined) === undefined);
  check('缓存有上限，最久没用过的先淘汰', (() => {
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // 此时 a 应被淘汰（上限 3）
    return cache.get('a') === undefined && cache.get('b') === 2 && cache.get('d') === 4;
  })());
  check('缓存：重新 set 等于「又用了一次」，不会被优先淘汰', (() => {
    const lru = createReadCache(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('a', 11); // a 变成最近用过的
    lru.set('c', 3);  // 该淘汰 b
    return lru.get('b') === undefined && lru.get('a') === 11 && lru.get('c') === 3;
  })());
  check('缓存：能整体清空（写操作就是靠这个保证不拿旧内容骗人）', (() => {
    const one = createReadCache(4);
    one.set('x', 1);
    one.clear();
    return one.size === 0 && one.get('x') === undefined;
  })());
  check('缓存上限是个正经数字', Number.isSafeInteger(READ_CACHE_MAX) && READ_CACHE_MAX >= 20);

  // 写操作必须清缓存：这条要是漏了，界面会拿写之前的旧内容骗人，而且没有任何报错。
  check('每个会改磁盘的 op 都被登记为写操作',
    ['writeText', 'writeBinary', 'writeRequirement', 'createRequirement', 'archiveRequirement',
      'restoreRequirement', 'ensureLayout', 'raiseNotice', 'markNoticeRead', 'clearNotice', 'writeIdentity']
      .every((op) => WRITE_OPS.includes(op)));
  check('读操作**不**在写操作表里（否则每次读都把缓存清掉，等于没有缓存）',
    ['readText', 'readRequirement', 'readNotices', 'readIdentity', 'listDir', 'listRequirements']
      .every((op) => !WRITE_OPS.includes(op)));
  check('callWorkbench 在写操作之后清缓存', /if \(WRITE_OPS\.includes\(op\)\) readCache\.clear\(\);/.test(source));

  // 给了缓存键的读取才可能跨挂载复用；没有键的必须是有意为之。
  const keyed = (source.match(/\n\t\t\t\t'[a-z]+\|' \+/g) ?? []).length;
  check('会重新读取的页面都给了缓存键（切走再切回来不重走读取中）', keyed >= 5, `${keyed} 处`);
  check('没有缓存键的那一处写明了理由（建议编号必须现算，缓存会导致重号）',
    /刻意\*\*不给缓存键\*\*/.test(source));
}

// ── 22. Windows 上的免 Node 安装路径 ───────────────────────────────────────
// 内网机器上的 DSH 可能是用 setup.exe 装的，Node 未必在 PATH 上 —— 那时
// tools/install.mjs 跑不起来。tools/install.ps1 用纯 PowerShell 做同一件事。
// 这一节钉住它的两条硬约束。
console.log('\n[22] Windows 免 Node 安装脚本');
{
  const ps1Path = join(packageRoot, 'tools', 'install.ps1');
  check('tools/install.ps1 随包提供', existsSync(ps1Path));
  if (existsSync(ps1Path)) {
    const bytes = readFileSync(ps1Path);
    const text = bytes.toString('utf8');
    const hasBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const nonAscii = [...text].filter((ch) => ch.charCodeAt(0) > 0x7F);

    // Windows PowerShell 5.1 读**没有 BOM** 的 .ps1 时按 ANSI 解码，
    // 所以中文注释会在目标机器上变成乱码 —— 与仓库里其它 .ps1 一样，一律纯 ASCII。
    check('install.ps1 是纯 ASCII（PS 5.1 读无 BOM 脚本按 ANSI 解，非 ASCII 会乱码）',
      nonAscii.length === 0, `${nonAscii.length} 个非 ASCII 字符`);
    check('install.ps1 不带 BOM（与仓库里其它 .ps1 一致）', hasBom === false);

    check('install.ps1 与 Node 安装器写同样的宿主行',
      text.includes("'client-ui-workbench'") && text.includes("'dsh-client-ui-workbench'"));
    check('install.ps1 追加前会备份补丁层', /\.bak/.test(text) && /Copy-Item/.test(text));
    check('install.ps1 幂等：已引用过就不重复追加', /already references/.test(text));
    check('install.ps1 会说清首次安装要重启宿主（否则页签在、读写却 404）',
      text.includes('HTTP 404') && /restart/i.test(text));
    check('install.ps1 通过 .NET 显式 UTF-8 读写补丁层（用 PS 自己的 Get-Content/Out-File 会转成 ANSI）',
      text.includes('[System.IO.File]::ReadAllText') && text.includes('UTF8Encoding($false)'));
  }

  // restart-host.ps1 只在 npm 装的 DSH 上成立。这一节钉住两件事：
  //  1) 它认的是**真正的 .js 入口**，不是 npm 在 Windows 上装的 dsh.ps1 / dsh.cmd shim
  //     ——把 shim 交给 node，node 会去解析 PowerShell；
  //  2) 找不到入口时要**说清楚改用「退出再启动」**，而不是抛一句 "not found"。
  const restartText = readFileSync(join(packageRoot, 'tools', 'restart-host.ps1'), 'utf8');
  const restartBytes = readFileSync(join(packageRoot, 'tools', 'restart-host.ps1'));
  check('restart-host.ps1 只接受 .js 入口（npm 的 dsh.ps1 shim 交给 node 会被当成 JavaScript）',
    /EndsWith\('\.js'\)/.test(restartText));
  check('restart-host.ps1 找不到 dsh 时会指向「退出再启动」，并带上退出码',
    /setup \.exe/.test(restartText) && /start it again/.test(restartText) && /exit 1/.test(restartText));
  check('restart-host.ps1 不写死本机路径（node 与日志目录都从环境推）',
    !restartText.includes("'E:\\work\\deepseek-harness\\workspace'"));
  check('restart-host.ps1 也是纯 ASCII 且无 BOM',
    [...restartBytes.toString('utf8')].every((ch) => ch.charCodeAt(0) < 128)
    && !(restartBytes[0] === 0xEF && restartBytes[1] === 0xBB && restartBytes[2] === 0xBF));

  // 「装进了另一个 home」是最隐蔽的失败：页签不出现，而症状与「没重启」几乎一样。
  // 两个安装器都必须在写入之后、用「sessions/ 有没有近期活动」当场提醒。
  for (const name of ['install.mjs', 'install.ps1']) {
    const text = readFileSync(join(packageRoot, 'tools', name), 'utf8');
    check(`${name} 会在 home 看起来没被使用时当场警告（否则症状与"没重启"分不开）`,
      /sessions/.test(text) && /ANOTHER home|另一个 home/.test(text) && /doctor/.test(text));
  }

  // 某些安装方式（例如 setup.exe）建出来的 profile **没有** cordis.patch.yml。
  // 旧版本在这里硬失败，报错只有一句「找不到补丁层」，完全没提示「新建即可」——
  // 于是卡死，而现场表现只是「页签不出现」。两个安装器都必须自己能新建它。
  for (const name of ['install.mjs', 'install.ps1']) {
    const text = readFileSync(join(packageRoot, 'tools', name), 'utf8');
    check(`${name} 在 profile 没有补丁层时会新建，而不是报错退出`,
      /created|已新建|had no patch layer/.test(text)
      && /top-level YAML array|顶层一个 YAML 数组|顶层一个/.test(text));
    check(`${name} 新建补丁层时用的是标准格式（顶层 YAML 数组 + 本插件的 insert 行）`,
      text.includes('- insert:') && text.includes('client-ui-workbench'));
  }
}

// ── 23. 安装器不许删别人的东西 ─────────────────────────────────────────────
// 这条是从一次真实事故里长出来的：清理临时目录时变量名撞上了 PowerShell 的自动变量
// `$HOME`，赋值被静默忽略，于是 `Remove-Item -Recurse -Force` 打向了**用户主目录**。
// 那次是文件沙箱挡住的，不是代码写对了。
//
// 规则不是「安装器绝不删除」—— tools/install.mjs 从 .tgz 安装时确实要清掉自己解出来的
// 暂存目录。规则是：**只准删自己刚创建的东西，绝不准删调用方给的路径。**
console.log('\n[23] 安装器不许删别人的东西');
{
  const ps1Text = readFileSync(join(packageRoot, 'tools', 'install.ps1'), 'utf8');
  check('install.ps1 里完全没有删除操作（它只需要写）',
    !/Remove-Item|\.Delete\(|rmdir/i.test(ps1Text));

  const mjsText = readFileSync(join(packageRoot, 'tools', 'install.mjs'), 'utf8');
  const removals = [...mjsText.matchAll(/\brmSync\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
  check('install.mjs 的每一处删除都作用在**自己 mkdtemp 出来的**临时目录上',
    removals.length > 0 && removals.every((name) => mjsText.includes(`const ${name} = mkdtempSync(`)),
    removals.length === 0 ? '没找到任何删除（这条会空跑）' : removals.join(', '));
  check('反例成立：uninstall.mjs 确实会删东西（否则上面两条都是空跑）',
    /\brmSync\s*\(|\brm\s*\(/.test(readFileSync(join(packageRoot, 'tools', 'uninstall.mjs'), 'utf8')));
}

// ── 24. 诊断脚本的四条结论 ─────────────────────────────────────────────────
// 「插件不在启动图里」这条报错背后有**两种修法相反**的原因：
//   A 装错了 home（setup.exe 装的 DSH 最容易这样）→ 要重装到对的 home
//   B 装对了但没被加载（补丁层那行没被消费）→ 只要重启
// 猜错方向会让人白折腾。所以判定被抽成纯函数 tools/lib/doctor-verdict.mjs，
// 四种结论全部在这里钉住 —— 其中三种没法在真机上复现（要复现就得先装错）。
console.log('\n[24] 诊断脚本的四条结论');
{
  const { diagnose } = await import(pathToFileURL(join(packageRoot, 'tools', 'lib', 'doctor-verdict.mjs')).href);
  check('诊断判定是纯函数且可单独 import（不联网、不碰文件系统）', typeof diagnose === 'function');

  const healthy = diagnose({ hostHome: 'H', pingOk: true, bootPresent: true, homesWithPackage: ['H'] });
  check('全部正常 -> ok', healthy.code === 'ok' && healthy.lines.length === 0);

  const wrongHome = diagnose({
    hostHome: 'C:\\Users\\x\\AppData\\Local\\DeepSeekHarness',
    pingOk: false,
    bootPresent: false,
    homesWithPackage: ['C:\\Users\\x\\.dsh'],
    packageName: 'dsh-client-ui-workbench',
  });
  check('ping 不通 + 宿主 home 与装机 home 不同 -> 判定为「装错了 home」', wrongHome.code === 'A');
  check('该结论给出可直接执行的修复命令（带 --dsh-home 与宿主真实 home）',
    wrongHome.lines.join('\n').includes('--dsh-home "C:\\Users\\x\\AppData\\Local\\DeepSeekHarness"'));
  check('该结论点名两个 home，让人一眼看出差在哪',
    wrongHome.lines.join('\n').includes('C:\\Users\\x\\AppData\\Local\\DeepSeekHarness')
    && wrongHome.lines.join('\n').includes('C:\\Users\\x\\.dsh'));

  const notLoaded = diagnose({ hostHome: 'H', pingOk: true, bootPresent: false, homesWithPackage: ['H'] });
  check('ping 通但启动图没有 -> 判定为「装对了但没被加载」', notLoaded.code === 'B');
  check('该结论把「重启」放在第一位（这是最常见的原因）', /重启/.test(notLoaded.lines[2]));

  const nothing = diagnose({ hostHome: null, pingOk: false, bootPresent: false, homesWithPackage: [] });
  check('ping 不通且哪儿都没装 -> 判定为「根本没装」', nothing.code === 'C');
  check('该结论给出安装命令', nothing.lines.join('\n').includes('install.mjs'));

  const unclear = diagnose({ hostHome: null, pingOk: false, bootPresent: null, homesWithPackage: ['H'], anyReferenced: false });
  check('证据不足时**不硬猜**，而是判定为待定并请人贴输出', unclear.code === 'unknown');
  check('待定时会指出「没有任何 profile 引用本插件」这条关键线索',
    unclear.lines.join('\n').includes('没有任何 profile'));

  check('判定不依赖 packageName 也能跑（缺省有兜底）',
    diagnose({ pingOk: false, bootPresent: false, homesWithPackage: [] }).code === 'C');

  // 诊断工具必须是只读的 —— 它是给人排查用的，不该改变任何东西。
  const doctorText = readFileSync(join(packageRoot, 'tools', 'doctor.mjs'), 'utf8');
  const writerApis = ['writeFileSync', 'mkdirSync', 'rmSync', 'appendFileSync', 'createWriteStream', 'Remove-Item']
    .filter((api) => doctorText.includes(api));
  check('doctor.mjs 是只读的（没有任何写文件 / 建目录 / 删除）', writerApis.length === 0, writerApis.join(', '));
  check('doctor.mjs 会打印宿主真实 home（ping 的 identityPath 推出来，这是定位 A 的铁证）',
    doctorText.includes('identityPath') && doctorText.includes('hostHome'));
  // 只在几个"猜的位置"找 home 是不够的：setup.exe 装的 DSH 可能把 home 放在
  // 任何名字的目录下。所以它必须**按标志物 cordis.patch.yml 递归搜**，而不是按目录名猜。
  check('doctor.mjs 递归搜所有 profile（按 cordis.patch.yml 找，不按目录名猜）',
    doctorText.includes('scanForProfiles') && doctorText.includes("'cordis.patch.yml'"));
  check('递归搜索会跳过符号链接与 node_modules（否则绕圈 / 慢到不可用）',
    doctorText.includes('isSymbolicLink()') && doctorText.includes("entry.name === 'node_modules'"));
  check('递归搜索排除临时目录（自检会在那里留一次性 home，不是"装在哪"的候选）',
    doctorText.includes('skippedTemp') && doctorText.includes('tmpdir()'));

  // probe.mjs 曾经在「未命中」时**直接退出**，于是宿主通道那一次探测永远看不到 ——
  // 而那一行恰恰是区分「装错了 home」和「装对了没加载」的唯一信息。
  // 结构上钉住：**失败退出（exit 1）必须排在宿主通道探测之后**。
  // （`--help` 的 exit(0) 与「拿不到首页」的 exit(2) 在它之前是合理的：
  //   没有首页就没有任何东西可探。）
  {
    const probeText = readFileSync(join(packageRoot, 'tools', 'probe.mjs'), 'utf8');
    const pingAt = probeText.indexOf("callWorkbench(options.webUrl, 'ping')");
    const firstFailureExit = probeText.indexOf('process.exit(1)');
    check('probe.mjs 先跑完宿主通道探测，再考虑失败退出（未命中时那一行是关键信息）',
      pingAt > 0 && firstFailureExit > pingAt, `ping@${pingAt} 首个 exit(1)@${firstFailureExit}`);
    check('probe.mjs 只在拿到首页之后才探测宿主通道（拿不到首页时 exit(2) 是合理的）',
      probeText.indexOf('process.exit(2)') < pingAt);
    check('probe.mjs 未命中时会给出 A/B 判定（修法相反，不能只给排查清单）',
      /判定：宿主半边\*\*已经加载\*\*/.test(probeText) && /doctor\.mjs/.test(probeText));
    check('probe.mjs 会指出 404 = 路由没注册（区别于「重启一下就好」）',
      probeText.includes('ping.status === 404'));

    // 启动图里的 bundle 地址形状随 DSH 版本变：0.1.5 是绝对路径 `/plugins/…`，
    // 0.2.0 是相对路径 `plugins/…`（页面用 `<base href="./">`）。直接 `base + url`
    // 拼接会拼出 `http://127.0.0.1:3080plugins/…` —— 非法 URL，fetch 直接抛，
    // 再被报成「宿主不可达 / 鉴权未通过」。0.2.0 上安装器第 4 步真的这么假报过 FAIL，
    // 而同一个地址用 `new URL(url, base)` 取到的是 HTTP 200。这里用真值钉住两种形状。
    const { resolveBundleUrl } = await import(
      pathToFileURL(join(packageRoot, 'tools', 'lib', 'http.mjs')).href
    );
    const probeHost = 'http://127.0.0.1:3080';
    const comboPath = 'plugins/??a/client.js&rev=abc';
    check('启动图 bundle 地址：0.1.5 的绝对路径解析正确',
      resolveBundleUrl(probeHost, `/${comboPath}`) === `${probeHost}/${comboPath}`,
      String(resolveBundleUrl(probeHost, `/${comboPath}`)));
    check('启动图 bundle 地址：0.2.0 的相对路径也解析正确（不许拼成 hostplugins/…）',
      resolveBundleUrl(probeHost, comboPath) === `${probeHost}/${comboPath}`,
      String(resolveBundleUrl(probeHost, comboPath)));
    check('启动图 bundle 地址：base 带尾斜杠 / 空值都不炸',
      resolveBundleUrl(`${probeHost}/`, comboPath) === `${probeHost}/${comboPath}`
      && resolveBundleUrl(probeHost, null) === null
      && resolveBundleUrl(probeHost, '') === null);
    check('probe / check-bundle / install 都改用这个解析函数（不再各自拼字符串）',
      ['probe.mjs', 'check-bundle.mjs', 'install.mjs']
        .every((name) => readFileSync(join(packageRoot, 'tools', name), 'utf8').includes('resolveBundleUrl')));
  }
}

// ── 25. 安装到「应用真正在用的」home ───────────────────────────────────────
// setup.exe 装的 DSH 把 home 放在 %LOCALAPPDATA%\<App>\.dsh，而安装器的默认值是
// %USERPROFILE%\.dsh。往错的地方装，插件不会生效，症状却是「页签不出现」——
// 与「没重启」几乎一模一样。这一节钉住「安装器会自己找活着的 home」这条判定。
console.log('\n[25] 自动找活着的 DSH home');
{
  const { newestSessionMs, findHomes, resolveHome } = await import(
    pathToFileURL(join(packageRoot, 'tools', 'lib', 'home-detect.mjs')).href
  );

  // 造一个夹具：一个"死"home（没有 sessions）与一个"活"home（sessions 里有新文件）。
  const fixture = mkdtempSync(join(tmpdir(), 'wb-home-detect-'));
  try {
    const dead = join(fixture, 'dead', '.dsh');
    const live = join(fixture, 'live', 'DeepSeekHarness', '.dsh');
    mkdirSync(join(dead, 'profiles', 'web'), { recursive: true });
    mkdirSync(join(live, 'profiles', 'web'), { recursive: true });
    mkdirSync(join(live, 'sessions', 'session-x'), { recursive: true });
    writeFileSync(join(live, 'sessions', 'session-x', 'log.jsonl'), '{"a":1}\n');
    writeFileSync(join(live, 'profiles', 'web', 'cordis.patch.yml'), '[]\n');

    check('没有 sessions/ 的 home 判为「没被用过」', newestSessionMs(dead) === 0);
    check('有 sessions/ 的 home 能被识别出活动', newestSessionMs(live) > 0);
    check('扫描能按标志物（有 profiles\\）找出 home，并跳过 node_modules',
      (() => {
        mkdirSync(join(fixture, 'live', 'node_modules', 'some-pkg', 'profiles'), { recursive: true });
        const homes = findHomes([fixture]).map((one) => one.home.toLowerCase());
        return homes.includes(live.toLowerCase()) && !homes.some((one) => one.includes('node_modules'));
      })());
    check('扫描结果按新鲜度排序（活的在前）',
      findHomes([fixture])[0].home.toLowerCase() === live.toLowerCase());

    check('显式指定时**完全尊重**，绝不自动改', (() => {
      const picked = resolveHome(dead, true, [fixture]);
      return picked.home === dead && picked.switched === false && picked.reason === 'explicit';
    })());
    check('默认位置没被用过、且只有一个别的 home 活着 -> 自动改用它',
      (() => {
        const picked = resolveHome(dead, false, [fixture]);
        return picked.switched === true && picked.home.toLowerCase() === live.toLowerCase()
          && picked.reason === 'requested-unused';
      })());
    check('两个都没活动 -> **不猜**，保持原样',
      (() => {
        const picked = resolveHome(join(fixture, 'nope'), false, [join(fixture, 'dead')]);
        return picked.switched === false && picked.reason === 'none-alive';
      })());
    check('没有可扫的根时也不崩', resolveHome(join(fixture, 'nope'), false, []).switched === false);
    check('给出的候选里会排除掉它自己',
      resolveHome(live, false, [fixture]).alternatives.every((one) => one.home.toLowerCase() !== live.toLowerCase()));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  const detectText = readFileSync(join(packageRoot, 'tools', 'lib', 'home-detect.mjs'), 'utf8');
  check('探测模块是只读的（只查文件系统，不写不删）',
    !/writeFileSync|mkdirSync|rmSync|appendFileSync/.test(detectText));
  const installText = readFileSync(join(packageRoot, 'tools', 'install.mjs'), 'utf8');
  check('install.mjs 只在**没显式指定** home 时才自动改用它',
    /if \(!options\.dshHomeExplicit\)/.test(installText) && /resolveHome\(options\.dshHome, false\)/.test(installText));
}

// ── 26. 每个碰工作区的 op 都必须带 sessionId ───────────────────────────────
// 这是最隐蔽的一类缺陷：工作台根目录按**会话的 cwd** 解析，而不带 sessionId 时会回落到
// `sandboxPolicy.workspaceRoot` —— **另一个目录**。于是「新建需求」写到 A、
// 「添加开发人员」去 B 读，报 `requirement.json not found`，而且不报任何"路径错了"。
// 在开发机上这两个路径恰好相同，所以本地怎么试都是好的。
console.log('\n[26] 工作区 op 必须带 sessionId');
{
  const { WORKSPACE_OPS } = internals;
  const HOME_OPS = ['readIdentity', 'writeIdentity', 'readNotices', 'raiseNotice', 'markNoticeRead', 'clearNotice'];
  const WORKSPACE = ['readText', 'writeText', 'writeBinary', 'listDir', 'remove', 'readRequirement',
    'writeRequirement', 'createRequirement', 'listRequirements', 'nextRequirementId',
    'archiveRequirement', 'restoreRequirement', 'ensureLayout'];

  check('客户端把碰工作区的 op 全数列了出来',
    WORKSPACE.every((op) => WORKSPACE_OPS.includes(op)),
    WORKSPACE.filter((op) => !WORKSPACE_OPS.includes(op)).join(', '));
  check('本机状态 op 不在工作区表里（它们落在 $DSH_HOME，不看工作区）',
    HOME_OPS.every((op) => !WORKSPACE_OPS.includes(op)),
    HOME_OPS.filter((op) => WORKSPACE_OPS.includes(op)).join(', '));

  // 与宿主半边对账：宿主注册的每一个 op 都必须在客户端被分到某一类里。
  // 将来给宿主加一个 op 却忘了归类，这条会红 —— 那正是重新引入本缺陷的方式。
  const hostText = readFileSync(join(packageRoot, 'index.js'), 'utf8');
  const opPattern = /^\s{2}([a-zA-Z][a-zA-Z0-9]*): async \(ctx, payload\) =>/gm;
  const marks = [...hostText.matchAll(opPattern)].map((match) => ({ name: match[1], at: match.index }));
  const hostOps = marks.map((one) => one.name);
  check('从宿主源码里读到了 op 表（不是空跑）', hostOps.length >= 15, `${hostOps.length} 个`);
  const unclassified = hostOps.filter((op) => !WORKSPACE_OPS.includes(op) && !HOME_OPS.includes(op));
  check('宿主的每个 op 都在客户端被分过类（新增 op 必须归类，否则又会落到另一个根目录）',
    unclassified.length === 0, unclassified.join(', '));

  // 最强的一条：用**宿主真实实现**对账 —— 哪个 op 里出现 workbenchRootFor，它就在读工作区，
  // 客户端就必须补 sessionId。分类的正确性因此不再依赖我的记忆。
  const hostWorkspaceOps = [];
  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].at : hostText.length;
    if (hostText.slice(mark.at, end).includes('workbenchRootFor')) hostWorkspaceOps.push(mark.name);
  });
  const missingFromClient = hostWorkspaceOps.filter((op) => !WORKSPACE_OPS.includes(op));
  const extraInClient = WORKSPACE_OPS.filter((op) => !hostWorkspaceOps.includes(op));
  check('客户端的工作区 op 表与宿主实现逐一对上（宿主读工作区的 op 全都补 sessionId）',
    missingFromClient.length === 0 && extraInClient.length === 0,
    `客户端缺 [${missingFromClient.join(', ')}] 客户端多 [${extraInClient.join(', ')}]`);

  // 机制本身：统一补齐 + 缺上下文时抛错，而不是静默用另一个根。
  check('callWorkbench 会给工作区 op 统一补 sessionId',
    /if \(WORKSPACE_OPS\.includes\(op\)\)/.test(source) && /body\.payload\.sessionId = activeSessionId;/.test(source));
  check('拿不到会话上下文时**直接抛错**（用错误的根目录静默读写更糟）',
    /工作台还没有会话上下文/.test(source));
  check('WorkbenchView 在渲染期登记 sessionId（effect 会因"子 effect 先跑"而漏掉首次加载）',
    (() => {
      const viewStart = source.indexOf('function WorkbenchView(props) {');
      const assignmentAt = source.indexOf("activeSessionId = typeof sessionId === 'string'", viewStart);
      // 必须落在 WorkbenchView 函数体**开头**（渲染期），而不是任何 useEffect 里。
      return viewStart > 0 && assignmentAt > viewStart && assignmentAt - viewStart < 800;
    })());
}

// ── 27. 需求文档：导入后的那一屏是 AI 分析，不是原文 ────────────────────────
// 这一块的失败方式很隐蔽：路径算错 → 分析写到了别处，页面永远显示「没有分析」；
// 指令里少写一条纪律 → AI 顺手去改 parsed/ 下的原文，导入的正文被分析覆盖；
// 功能点合并写错 → 每次分析都把同一条功能点又加一遍。三种都不报错，所以值得断言。
console.log('\n[27] 需求文档分析');
if (internals !== undefined && internals !== null) {
  const {
    requirementAnalysisPath, requirementPointsPath, documentAnalysisPrompt,
    mergeExtractedPoints, suspicionOf, versionDistance, changeRatio, diffLines, diffStats, subagentDirective,
  } = internals;

  check('导出了分析相关的纯函数',
    [requirementAnalysisPath, requirementPointsPath, documentAnalysisPrompt, mergeExtractedPoints,
      suspicionOf, versionDistance, changeRatio, subagentDirective].every((fn) => typeof fn === 'function'));

  check('分析路径 = Pipeline/需求/analysis/<版本>.md（一版一份，不需要索引文件）',
    requirementAnalysisPath('v1.0') === 'Pipeline/需求/analysis/v1.0.md'
    && requirementAnalysisPath('v2.11') === 'Pipeline/需求/analysis/v2.11.md',
    String(requirementAnalysisPath('v1.0')));

  check('功能点路径 = 同目录同 slug 的 .points.json（功能点要机读，不能从散文里正则抠）',
    requirementPointsPath('v1.0') === 'Pipeline/需求/analysis/v1.0.points.json'
    && requirementPointsPath('v2.0') === 'Pipeline/需求/analysis/v2.0.points.json',
    String(requirementPointsPath('v1.0')));

  // 与 parsed/<slug>.txt 用的是同一个 slug 规则 —— 否则「这一版分析过没有」就对不上。
  check('版本号先过 versionSlug（污点字符不会跑进路径）',
    requirementAnalysisPath('v1/0') === 'Pipeline/需求/analysis/v1_0.md'
    && requirementAnalysisPath('../x') === 'Pipeline/需求/analysis/.._x.md',
    String(requirementAnalysisPath('../x')));
  check('分析目录与 source/parsed 同级（都收在 Pipeline/需求 下）',
    requirementAnalysisPath('v1.0').startsWith('Pipeline/需求/'));

  const prompt = documentAnalysisPrompt({
    id: 'XQ20260917-0001',
    title: '客户经营信息优化',
    version: 'v2.0',
    textFile: 'Pipeline/需求/parsed/v2.0.txt',
    analysisPath: requirementAnalysisPath('v2.0'),
    pointsPath: requirementPointsPath('v2.0'),
    root: 'E:/work/demo/docs/requirements',
    hasAnalysis: false,
  });

  check('指令里有需求编号与标题', prompt.includes('XQ20260917-0001') && prompt.includes('客户经营信息优化'));
  check('指令里**读什么**是可寻址的绝对路径，AI 不用猜',
    prompt.includes('E:/work/demo/docs/requirements/XQ20260917-0001/Pipeline/需求/parsed/v2.0.txt'));
  check('指令里**写什么**是两个文件：给人读的分析 + 给工作台读的功能点 JSON',
    prompt.includes('E:/work/demo/docs/requirements/XQ20260917-0001/Pipeline/需求/analysis/v2.0.md')
    && prompt.includes('E:/work/demo/docs/requirements/XQ20260917-0001/Pipeline/需求/analysis/v2.0.points.json')
    && prompt.includes('"points"'));
  check('指令禁止改动需求层与工作台文件（requirement.json / source / parsed）',
    prompt.includes('不要改动需求层和工作台的任何文件') && prompt.includes('requirement.json') && prompt.includes('parsed'));
  check('指令要求功能点是「可派给人、可勾完成」的粒度，不要写"支持 XX 能力"',
    prompt.includes('可独立交付') && prompt.includes('没法验收'));
  check('指令要求区分「文档说的」与「推断」并单列待澄清问题',
    prompt.includes('待澄清问题') && prompt.includes('推断'));
  check('指令要求不要写方案 / 代码（分析不是设计）',
    prompt.includes('不要写方案') && prompt.includes('不要写代码'));

  const redo = documentAnalysisPrompt({
    id: 'XQ20260917-0001',
    title: '客户经营信息优化',
    version: 'v2.0',
    textFile: 'Pipeline/需求/parsed/v2.0.txt',
    analysisPath: requirementAnalysisPath('v2.0'),
    pointsPath: requirementPointsPath('v2.0'),
    root: 'E:/work/demo/docs/requirements',
    hasAnalysis: true,
  });
  check('已有分析时要求**在现有内容上继续优化**，而不是从零重写',
    redo.includes('继续优化') && redo.includes('不要从零重写') && !prompt.includes('继续优化'));

  // —— 每个模块都交给一个只做本模块的子 agent
  const directive = subagentDirective('方案', { id: 'XQ20260917-0001', title: '客户经营信息优化' }).join('\n');
  check('子 agent 指令点名模块与需求，并限制在上游只读',
    directive.includes('只做「方案」') && directive.includes('XQ20260917-0001') && directive.includes('只读'));
  check('方案 / 开发 / 测试 / 提版 四个模块的指令里都带这条纪律',
    [internals.designPrompt, internals.designSummaryPrompt, internals.stagePrompt].every((fn) => typeof fn === 'function')
    && internals.designPrompt({ id: 'XQ20260917-0001', title: 'T', developer: '张三', root: 'E:/ws', points: [], hasDraft: false }).includes('子 agent')
    && internals.stagePrompt('develop', { id: 'XQ20260917-0001', title: 'T', developer: '张三', root: 'E:/ws' }).includes('子 agent'));

  // —— 功能点合并：同名不动、只追加新的
  const existingPoints = [{ id: 'p1', name: '客户信息导出', assignee: '张三' }];
  const merged = mergeExtractedPoints(existingPoints, [
    { name: '客户信息导出', note: '重复的，应该被忽略' },
    { name: ' 客户信息 导出 ', note: '只差空白，也算同一个' },
    { name: '对账', note: '新的' },
    { name: '', note: '空名字，跳过' },
    { name: '合同归档' },
    null,
    'not-an-object',
  ], 'v2.0', '2026-09-17T00:00:00.000Z');
  check('功能点合并：同名（含只差空白/大小写）不重复加，空的跳过，坏数据不炸',
    merged.points.length === 3 && merged.added === 2,
    JSON.stringify(merged.points.map((point) => point.name)));
  check('功能点合并：已存在的那条**一个字都没动**（人可能已经改了名字或派了人）',
    merged.points[0].id === 'p1' && merged.points[0].assignee === '张三' && merged.points[0].source === undefined);
  check('功能点合并：新增的记下出自哪一版，并带上随机 id',
    merged.points[1].source === 'v2.0' && merged.points[1].sourceVersion === 'v2.0'
    && typeof merged.points[1].id === 'string' && merged.points[1].id !== '');
  check('功能点合并是幂等的（再合并一次进 0 个）',
    mergeExtractedPoints(merged.points, [{ name: '对账' }, { name: '合同归档' }], 'v2.0', '').added === 0);
  check('功能点合并：AI 给了坏形状时按空处理，不抛',
    mergeExtractedPoints(undefined, undefined, 'v1.0', '').added === 0
    && mergeExtractedPoints(existingPoints, 'not-an-array', 'v1.0', '').added === 0);

  // —— 「这一版是不是传错了」
  check('版本距离：大版本跳一级远重于小版本连跳几级',
    versionDistance('v1.0', 'v1.1') === 1 && versionDistance('v1.0', 'v2.0') === 10
    && versionDistance('v1.0', 'v1.3') === 3 && versionDistance('v1.0', 'x') === 0);

  const jumpDoc = { lines: diffLines('一模一样的一段话\n第二行也一样', '一模一样的一段话\n第二行也一样') };
  const jumpAnalysis = { lines: diffLines('分析 A', '分析 A'), left: '分析 A', right: '分析 A' };
  const jump = suspicionOf(jumpDoc, jumpAnalysis, { left: 'v1.0', right: 'v2.0' });
  check('版本号跳到 2.0 而正文一字未改 → 提示「可能传错了文件」',
    jump !== null && jump.kind === 'jump', JSON.stringify(jump));

  const tiny = suspicionOf(
    { lines: diffLines('第一行\n第二行\n第三行', '第一行\n第二行\n第三行') },
    jumpAnalysis,
    { left: 'v1.0', right: 'v1.1' },
  );
  check('同一大版本内的小改动**不**报可疑（误报一次，人就不看这个提示了）', tiny === null);

  const bigDoc = { lines: diffLines('A\nB\nC\nD', 'A\nX\nY\nZ') };
  const stale = suspicionOf(bigDoc, jumpAnalysis, { left: 'v1.0', right: 'v1.1' });
  check('正文大改而分析几乎没动 → 提示「分析可能是拿旧正文做的」',
    stale !== null && stale.kind === 'stale', JSON.stringify(stale));

  const noAnalysis = suspicionOf(bigDoc, { lines: diffLines('', ''), left: '', right: '' }, { left: 'v1.0', right: 'v1.1' });
  check('两版都还没分析时不报「分析没动」——那是另一个提示（先去跑分析）', noAnalysis === null);

  check('changeRatio：改动行数 / 总行数，两边都空算 0',
    changeRatio(diffLines('a\nb', 'a\nb')).ratio === 0
    && changeRatio([]).ratio === 0
    && changeRatio(diffLines('a\nb', 'a\nc')).ratio > 0);

  const statsPair = diffStats(diffLines('a\nb', 'a\nc'));
  check('行级 diff 仍然可用（对比两版正文要靠它）', statsPair.added + statsPair.removed > 0);

  // 页面渲染的默认分支：有分析就显示分析，原文只在「查看原文」后面。
  check('文档区默认渲染分析文本、把原文放进「查看原文」折叠里',
    /wcw-analysisText/.test(source)
    && /showSource \? t\('an\.sourceHide'\) : t\('an\.source'\)/.test(source));
  check('导入成功后自动让 AI 分析（用户要的是结论，不是一堆字）',
    /导入即分析/.test(source) && /void upload\(/.test(source)
    && (source.match(/documentAnalysisPrompt\(/g) ?? []).length >= 2);
  check('每个版本行上都有自己的「AI 分析」按钮（不是只能分析当前版）',
    /onClick: \(\) => \{ void analyze\(entry\); \}/.test(source));
  check('删除一版时把原件、正文、分析一起删（功能点不删）',
    /async function removeVersion\(entry\)/.test(source)
    && /documents: documents\.filter\(\(one\) => one\.version !== entry\.version\)/.test(source)
    && !(source.slice(source.indexOf('async function removeVersion'), source.indexOf('async function removeVersion') + 2000).includes('featurePoints')));

  // —— 渲染冒烟：默认停在「需求」页的主视图读不到「已导入文档」的形状，
  //    所以这里自己把组件调一遍。跑不出 effect，所以用种好的 state 覆盖各个分支。
  {
    function collect(node, texts) {
      if (node === null || node === undefined || typeof node === 'boolean') return;
      if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
      if (Array.isArray(node)) { for (const child of node) collect(child, texts); return; }
      if (typeof node !== 'object') return;
      if (typeof node.type === 'function') {
        try {
          collect(node.type(node.props), texts);
        } catch (error) {
          texts.push(`<crash: ${error && error.message ? error.message : error}>`);
        }
        return;
      }
      if ((node.type === 'textarea' || node.type === 'input') && typeof node.props.value === 'string') {
        texts.push(node.props.value);
      }
      // select 的当前值在 props.value 里；对比面板选的两版就是它。
      if (node.type === 'select' && typeof node.props.value === 'string' && node.props.value !== '') {
        texts.push(node.props.value);
      }
      if (typeof node.props.title === 'string') texts.push(node.props.title);
      if (Array.isArray(node.children)) for (const child of node.children) collect(child, texts);
    }

    function renderText(Component, props) {
      const texts = [];
      try {
        collect(Component(props), texts);
      } catch (error) {
        texts.push(`<crash: ${error && error.message ? error.message : error}>`);
      }
      return texts.join(' | ');
    }

    /**
     * 用给定的 state 初值渲染一次。
     *
     * 组件的数据全靠 effect 读回来，而替身里的 useEffect 是空的 —— 想冒烟「已经有分析」
     * 那一屏，只能把 useState 的初值按调用顺序喂进去。顺序写死确实脆，但脆的方式是
     * **响亮地失败**（多喂一个就会在渲染里抛错），而不是静默地什么都没测到。
     * 顺序：busy, message, manual, selected, comparing, pickLeft, pickRight,
     *       source(开关), analyzing, source(内容), analyses, extracted, compareLoaded
     */
    const realUseState = reactStub.useState;
    function renderWithState(Component, props, states) {
      let cursor = 0;
      reactStub.useState = (initial) => {
        const seeded = cursor < states.length ? states[cursor] : undefined;
        cursor += 1;
        // 用 === undefined 判断「这一格没喂」：null 是**合法的 state 值**（message 的初值就是它）。
        return [seeded === undefined ? (typeof initial === 'function' ? initial() : initial) : seeded, () => {}];
      };
      try {
        return renderText(Component, props);
      } finally {
        reactStub.useState = realUseState;
      }
    }

    const requirement27 = {
      id: 'XQ20260917-0001',
      title: '客户经营信息优化',
      updatedAt: '2026-09-17T00:00:00.000Z',
      documents: [
        { version: 'v1.0', file: 'Pipeline/需求/source/v1.0-原件.docx', textFile: 'Pipeline/需求/parsed/v1.0.txt', sourceName: '原件.docx', importedAt: '2026-09-01T00:00:00.000Z', chars: 1200 },
        { version: 'v1.1', file: 'Pipeline/需求/source/v1.1-原件.docx', textFile: 'Pipeline/需求/parsed/v1.1.txt', sourceName: '原件.docx', importedAt: '2026-09-02T00:00:00.000Z', chars: 1400 },
      ],
    };
    const base27 = {
      t,
      requirement: requirement27,
      onChanged: () => {},
      root: 'E:/ws/docs/requirements',
      running: false,
      sendPrompt: async () => {},
      scopeKey: 'session-1|XQ20260917-0001',
    };
    const analysisOf = (version, text) => ({ [version]: { text, stale: false } });
    const sourceOf = (text) => ({ version: 'v1.1', text, loading: false });

    const fresh27 = renderText(internals.RequirementDocuments, base27);
    check('文档区渲染不抛错', !/<crash: /.test(fresh27),
      (fresh27.match(/<crash: [^>]*>/) ?? [''])[0]);
    check('文档区给出上传 / AI 分析 / 查看原文三个入口',
      fresh27.includes('上传 Word 文档') && fresh27.includes('AI 分析') && fresh27.includes('查看原文'));
    check('每一版都有自己的「AI 分析」按钮和「删除」',
      fresh27.includes('删除') && (fresh27.match(/AI 分析/g) ?? []).length >= 2);

    // v1.1 是当前版，v1.0 是另一版：下面显示 v1.1 的分析，v1.0 的分析不掺进来。
    const withAnalysis27 = renderWithState(internals.RequirementDocuments, base27, [
      '', null, '', '', false, '', '', false, false, { version: '', text: '', loading: false },
      Object.assign(analysisOf('v1.0', '这是 v1.0 的分析'), analysisOf('v1.1', '这是 v1.1 的分析')),
      {}, { ref: '', left: '', right: '' },
    ]);
    check('下面显示的是**当前选中那一版**的分析',
      withAnalysis27.includes('这是 v1.1 的分析') && !withAnalysis27.includes('这是 v1.0 的分析'),
      withAnalysis27.slice(0, 240));
    check('有分析时按钮变成「继续优化分析」', withAnalysis27.includes('继续优化分析'));

    // 点另一版：下面换成那一版的分析，且原文不会跟着串台。
    const otherVersion27 = renderWithState(internals.RequirementDocuments, base27, [
      '', null, '', 'v1.0', false, '', '', false, false, sourceOf('v1.0 的原文'),
      Object.assign(analysisOf('v1.0', '这是 v1.0 的分析'), analysisOf('v1.1', '这是 v1.1 的分析')),
      {}, { ref: '', left: '', right: '' },
    ]);
    check('换一版就显示那一版的分析（点哪一版看哪一版）',
      otherVersion27.includes('这是 v1.0 的分析') && !otherVersion27.includes('这是 v1.1 的分析'));

    const source27 = renderWithState(internals.RequirementDocuments, base27, [
      '', null, '', 'v1.1', false, '', '', true, false, sourceOf('原文第一段。\n原文第二段。'),
      analysisOf('v1.1', '结论。'), {}, { ref: '', left: '', right: '' },
    ]);
    check('「查看原文」展开后原文还在（只是不再抢在分析前面）',
      source27.includes('原文第一段') && source27.includes('结论'));

    const noAnalysis27 = renderWithState(internals.RequirementDocuments, base27, [
      '', null, '', 'v1.0', false, '', '', false, false, { version: '', text: '', loading: false },
      analysisOf('v1.1', 'v1.1 的分析'), {}, { ref: '', left: '', right: '' },
    ]);
    check('这一版没分析时说明「这一版还没有分析」并指路，而不是显示别的版的分析',
      noAnalysis27.includes('这一版还没有分析') && !noAnalysis27.includes('v1.1 的分析'));

    // 对比面板：两版都选了，正文和分析各一份 diff，差异异常时给提示。
    const compare27 = renderWithState(internals.RequirementDocuments, base27, [
      '', null, '', 'v1.0', true, 'v1.0', 'v1.1', false, false, { version: '', text: '', loading: false },
      Object.assign(analysisOf('v1.0', '分析：做导出'), analysisOf('v1.1', '分析：做导出，加对账')),
      {}, { ref: 'v1.0..v1.1', left: '需求正文第一行', right: '需求正文第一行\n新增一行' },
    ]);
    check('对比面板同时给出文档差异和分析差异',
      compare27.includes('文档差异') && compare27.includes('分析差异')
      && compare27.includes('需求正文第一行') && compare27.includes('分析：做导出'));
    check('对比面板的统计里同时有文档和分析的行数变化',
      compare27.includes('+1 / -0') && compare27.includes('+1 / -1'),
      compare27);

    const suspicious27 = renderWithState(internals.RequirementDocuments, base27, [
      '', null, '', 'v1.0', true, 'v1.0', 'v2.0', false, false, { version: '', text: '', loading: false },
      Object.assign(analysisOf('v1.0', '分析 A'), analysisOf('v2.0', '分析 A')),
      {}, { ref: 'v1.0..v2.0', left: '一字不改的正文', right: '一字不改的正文' },
    ]);
    check('版本号跳一大截而正文没变时给出「可能传错了」的提示',
      suspicious27.includes('差异异常') && suspicious27.includes('上传错了'));

    const loadingAnalysis27 = renderWithState(internals.RequirementDocuments, { ...base27, running: true }, [
      '', null, '', 'v1.1', false, '', '', false, true, { version: '', text: '', loading: false },
      analysisOf('v1.1', ''), {}, { ref: '', left: '', right: '' },
    ]);
    check('AI 正在写分析时说明「AI 正在读文档…」，而不是显示「没有分析」',
      loadingAnalysis27.includes('AI 正在读文档') && !loadingAnalysis27.includes('这一版还没有分析'));

    const manual27 = renderWithState(internals.RequirementDocuments, base27, [
      '', { kind: 'error', text: 'an.failed' }, '这是要粘贴的指令正文', '', false, '', '', false, false,
      { version: '', text: '', loading: false }, {}, {}, { ref: '', left: '', right: '' },
    ]);
    check('指令送不进对话时把它摆出来让人自己粘贴',
      manual27.includes('这是要粘贴的指令正文'));

    const empty27 = renderText(internals.RequirementDocuments, { ...base27, requirement: { ...requirement27, documents: [] } });
    check('没有文档时给上传提示而不是崩', empty27.includes('还没有需求文档'));
  }
}

// ── 28. 已移除「需求 ↔ 会话绑定」────────────────────────────────────────────
// 这一块曾经把每条需求绑到一个独立会话上（建需求时建会话、切需求时切会话）。
// 用下来决定不要了 —— AI 动作一律发到**用户当前正在用的那个会话**。
// 留在文件里的断言改成「它确实被拆干净了」：半拆的实现比不拆更糟，
// 因为残留的状态会让人以为还有隔离，而实际没有。
console.log('\n[28] 需求 ↔ 会话 绑定已移除');
{
  check('不再有会话映射（localStorage 键与读写都没了）',
    !/dsh\.workbench\.session/.test(source) && !/requirementSessionStore/.test(source)
    && /const viewStore = createLocalMap\(VIEW_KEY\)/.test(source));

  check('视图选择仍然只存本机（拆会话不该顺手把这条一起拆掉）',
    /VIEW_KEY = 'dsh\.workbench\.view'/.test(source) && /function readViewMap\(\)/.test(source));

  check('不再有建会话/切会话的实现',
    !/sessionApi/.test(source) && !/createSession/.test(source) && !/bindSession/.test(source)
    && !/storedSession/.test(source) && !/cwdMismatch/.test(source));

  check('不再向 inject 面要会话管理服务（只留 sendPrompt 这一条通道）',
    !/sessions: ctx\.sessions,/.test(source) && !/const sessions = props\.sessions/.test(source));

  check('界面上不再有「需求独立会话」区块',
    !/RequirementSession/.test(source) && !/sess\.bound/.test(source));

  check('建需求不再顺手建会话（需求创建只做创建这一件事）',
    /await callWorkbench\('createRequirement'/.test(source)
    && !/await createSession\(id\)/.test(source));
}

// ── 29. 把指令送进会话：必须用 get()，不能用属性访问 ───────────────────────
// 这是被真实缺陷逼出来的一条：`actx.conversation` 会被 cordis 的注入闸门拒掉，
// 抛 `cannot get property "conversation" without inject` —— 那句话读起来像
// 「插件没声明注入」，其实是**访问姿势**不对，于是排查方向会整个跑偏。
// 作用域上下文的注入表里没有 conversation，只有 ctx.get('conversation') 这条路。
console.log('\n[29] 会话通道的访问姿势');
{
  const code = CODE_ONLY(source);
  check('inject 里确实声明了 sessions 与 conversation（缺了 apply 根本不执行）',
    /const inject = \['slots', 'locale', 'uiSession', 'sessions', 'conversation'\]/.test(source));

  check('取会话作用域用 ctx.sessions.scope(id)（官方 ISessions 的公开方法）',
    /const actx = ctx\.sessions\.scope\(sessionId\);/.test(source));

  check('送指令用 actx.get(\'conversation\')，不是 actx.conversation',
    // 把注释剥掉再查：说明里**故意**写了那个错误写法（「不能写 actx.conversation」），
    // 不剥的话这条断言会被自己的注释绊倒 —— 断言与被断言的东西撞车，两条都不可信。
    CODE_ONLY(source).includes("actx.get('conversation')")
    && !/actx\.conversation\b/.test(CODE_ONLY(source))
    && !/\bscope\([^)]*\)\.conversation\b/.test(CODE_ONLY(source)),
    '代码里出现了属性访问（会被 cordis 注入闸门拒绝）');

  check('conversation 服务取不到时降级成「可粘贴指令」，而不是静默失败',
    /if \(conversation === undefined \|\| conversation === null\) \{[\s\S]{0,80}throw new Error\('NO_CONVERSATION_SERVICE'\)/.test(code));

  check('作用域拿不到时也抛一个能看懂的码（NO_SESSION_SCOPE）',
    /if \(actx === undefined \|\| actx === null\) \{[\s\S]{0,80}throw new Error\('NO_SESSION_SCOPE'\)/.test(code));

  check('刚建出来的会话绑定还没落地时会重试，而不是把「刚建完就点分析」变成一次失败',
    /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/.test(code)
    && /window\.setTimeout\(resolve, 300 \* attempt\)/.test(code));

  // 官方参考：@deepseek-ai/dsh-client-ui-commands 的 noticeFor 用的是同一条路。
  check('注释里写明了「为什么不能写属性访问」，下一个人不用再踩一次',
    /不能\*\*写 `actx\.conversation`/.test(source));
}

/** 剥掉注释：断言「代码里不许出现某写法」时，不能连同说明里的反例一起算。 */
function CODE_ONLY(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ── 30. 功能点按需求分块（树形） ───────────────────────────────────────────
// 分块的失败方式都不报错：全掉进「未分组」→ 树形白做；异名同块 → 同一模块裂成好几块；
// 改名只改了显示没落盘 → 下次打开又变回去。三条都不会抛异常，所以逐条断言。
console.log('\n[30] 功能点分块与树形');
if (internals !== undefined && internals !== null) {
  const { pointTree, pointGroupOf, deriveGroupName, normalizeGroupName, mergeExtractedPoints, groupByName } = internals;

  check('导出了分块相关的纯函数',
    [pointTree, pointGroupOf, deriveGroupName, normalizeGroupName, groupByName].every((fn) => typeof fn === 'function'));

  check('分块名规范化：去首尾空白、内部空白压成一个（同一模块不会裂成两块）',
    normalizeGroupName('  客户  主数据 ') === '客户 主数据'
    && normalizeGroupName(undefined) === '' && normalizeGroupName(null) === '');

  check('没有 group 时从点名推分块（老数据与 AI 漏写都能兜住）',
    deriveGroupName('客户 360 视图-概览页签') === '客户 360 视图'
    && deriveGroupName('商机与报价：报价折扣分级审批') === '商机与报价'
    && deriveGroupName('联系人管理—主联系人唯一性') === '联系人管理',
    [deriveGroupName('客户 360 视图-概览页签'), deriveGroupName('商机与报价：报价折扣分级审批')].join(' / '));

  check('推不出分块时不硬拆：没有分隔符、分隔符在句子中间都返回空',
    deriveGroupName('客户合并') === ''
    && deriveGroupName('这是一句很长的说明性文字，它显然不是一个模块名-后面还有内容') === '',
    deriveGroupName('这是一句很长的说明性文字，它显然不是一个模块名-后面还有内容'));

  check('写盘的分块优先于推导（人手工归的类，不会被名字前缀顶掉）',
    pointGroupOf({ name: '客户 360 视图-概览页签', group: '客户主数据' }) === '客户主数据'
    && pointGroupOf({ name: '客户 360 视图-概览页签' }) === ''
    && pointGroupOf({ name: '客户合并' }) === '');

  // 「孤例不成块」：从名字推的前缀必须先出现两次以上才算一块
  const lonePoints = [
    { id: 'a', name: '客户 360 视图-概览页签' },
    { id: 'b', name: '导出：明细' },
    { id: 'c', name: '回款与计划多对多核销' },
  ];
  const lone = pointTree(lonePoints);
  check('从名字推的前缀**只出现一次时不算分块**（孤例不成块，否则会冒出一堆假模块）',
    lone.length === 1 && lone[0].ungrouped === true && lone[0].points.length === 3,
    JSON.stringify(lone.map((group) => group.name)));

  check('同前缀出现两次以上时才算一块（老数据不用重新分析也能看出层次）',
    (() => {
      const tree = pointTree([
        { id: 'a', name: '客户 360 视图-概览页签' },
        { id: 'b', name: '客户 360 视图-联系人页签' },
        { id: 'c', name: '导出：明细' },
      ]);
      return tree.length === 2 && tree[0].name === '客户 360 视图' && tree[0].points.length === 2
        && tree[1].ungrouped === true && tree[1].points.length === 1;
    })());

  check('写盘的单条分块不受「孤例」约束（人手工分的块，一条也算）',
    pointTree([{ id: 'a', name: '客户合并', group: '客户主数据' }])[0].name === '客户主数据');

  const treePoints = [
    { id: 'a', name: '客户建档', group: '客户主数据' },
    { id: 'b', name: '客户 360 视图-概览页签' },
    { id: 'c', name: '客户 360 视图-联系人页签' },
    { id: 'd', name: '联系人字段维护', group: '联系人' },
    { id: 'e', name: '客户合并', group: '客户主数据' },
    { id: 'f', name: '回款与计划多对多核销' },
  ];
  const tree = pointTree(treePoints);
  check('分块按**首次出现顺序**排，不按字母或条目数重排（文档的模块顺序本身是信息）',
    tree.map((group) => group.name).join(' | ') === '客户主数据 | 客户 360 视图 | 联系人 | ',
    tree.map((group) => group.name).join(' | '));
  check('同一分块聚在一起，且分块内保持原顺序',
    tree[0].points.map((point) => point.id).join(',') === 'a,e'
    && tree[1].points.map((point) => point.id).join(',') === 'b,c');
  check('未分块固定排最后，并带 ungrouped 标记（它是待归位的待办，不是第一个模块）',
    tree[tree.length - 1].name === '' && tree[tree.length - 1].ungrouped === true
    && tree[tree.length - 1].points.map((point) => point.id).join(',') === 'f');

  check('树形是两级：分块 → 功能点，没有第三级',
    tree.every((group) => group.points.every((point) => typeof point.name === 'string')));
  check('空列表进空数组，坏数据跳过而不是抛',
    pointTree([]).length === 0 && pointTree(undefined).length === 0
    && pointTree([null, 'x', 7]).length === 0);

  check('按名取块：拿得到那一块，拿不到给空组而不是 undefined',
    groupByName(tree, '联系人').points.length === 1
    && groupByName(tree, '').ungrouped === true
    && groupByName(tree, '不存在的块').points.length === 0);

  // 合并：分块要跟着走，而且能补上老数据缺的分块
  const merged = mergeExtractedPoints(
    [{ id: 'p1', name: '客户建档', assignee: '张三' }],
    [{ name: '客户建档', group: '客户主数据', note: '同名，应补分块' },
      { name: '客户合并', group: '客户主数据' }],
    'v1.0', '2026-09-18T00:00:00.000Z',
  );
  check('新功能点带上 group（否则分析出来的层次信息会丢在落盘这一步）',
    merged.points[1].group === '客户主数据' && merged.added === 1);
  check('已存在的点同名时**只补分块**，其余一个字不动',
    merged.grouped === 1 && merged.points[0].assignee === '张三' && merged.points[0].group === '客户主数据');
  check('已有分块的点不会被新分析改写（人手工归的类优先）',
    mergeExtractedPoints([{ id: 'p1', name: 'X', group: '人工分的块' }], [{ name: 'X', group: 'AI 分的块' }], 'v1.0', '').points[0].group === '人工分的块');
  check('补分块是幂等的（再合并一次补 0 个）',
    mergeExtractedPoints(merged.points, [{ name: '客户建档', group: '客户主数据' }], 'v1.0', '').grouped === 0);

  // 指令里必须要求 AI 给 group，否则新分析出来的点全都没有分块
  const prompt30 = internals.documentAnalysisPrompt({
    id: 'XQ1', title: 'T', version: 'v1.0',
    textFile: 'Pipeline/需求/parsed/v1.0.txt',
    analysisPath: 'Pipeline/需求/analysis/v1.0.md',
    pointsPath: 'Pipeline/需求/analysis/v1.0.points.json',
    root: 'E:/ws', hasAnalysis: false,
  });
  check('分析指令里功能点带 group 字段，并要求同模块用同一个字符串',
    prompt30.includes('"group"') && prompt30.includes('一模一样')
    && prompt30.includes('需求分块'));

  // 渲染冒烟：树、计数、折叠、未分组的说明与入口
  {
    function collect(node, texts) {
      if (node === null || node === undefined || typeof node === 'boolean') return;
      if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
      if (Array.isArray(node)) { for (const child of node) collect(child, texts); return; }
      if (typeof node !== 'object') return;
      if (typeof node.type === 'function') {
        try {
          collect(node.type(node.props), texts);
        } catch (error) {
          texts.push(`<crash: ${error && error.message ? error.message : error}>`);
        }
        return;
      }
      // 输入框的内容可能在 value、也可能只在 placeholder 上：筛选框空值时
      // 唯一能证明"它在那"的就是 placeholder，不收就等于这条断言测了个寂寞。
      if (typeof node.props.value === 'string' && node.props.value !== '') texts.push(node.props.value);
      // 功能点的名字在**非受控 input 的 defaultValue** 里（可以就地改），不在 children 里 ——
      // 不收它，"哪几条还在"这类断言完全测不到。
      if (typeof node.props.defaultValue === 'string' && node.props.defaultValue !== '') texts.push(node.props.defaultValue);
      if (typeof node.props.placeholder === 'string') texts.push(node.props.placeholder);
      if (typeof node.props.title === 'string') texts.push(node.props.title);
      if (Array.isArray(node.children)) for (const child of node.children) collect(child, texts);
    }
    function renderText(Component, props) {
      const texts = [];
      try {
        collect(Component(props), texts);
      } catch (error) {
        texts.push(`<crash: ${error && error.message ? error.message : error}>`);
      }
      return texts.join(' | ');
    }

    const treeRequirement = {
      id: 'XQ20260918-0009',
      title: 'CRM',
      developers: ['张三'],
      featurePoints: treePoints,
    };
    const treeText = renderText(internals.FeaturePoints, { t, requirement: treeRequirement, onChanged: () => {} });
    check('功能点区渲染不抛错', !/<crash: /.test(treeText),
      (treeText.match(/<crash: [^>]*>/) ?? [''])[0]);
    check('每个分块显示块名与条目数（一眼看出哪块有多少活）',
      treeText.includes('客户主数据') && treeText.includes('客户 360 视图')
      && treeText.includes('联系人') && treeText.includes('2 项'));
    check('分块头上有折叠开关（上百个功能点时能先收起来）',
      treeText.includes('▾ 客户主数据') && treeText.includes('收起'));
    check('未归类的功能点仍然显示，但**不再有一个「未分组」块头**收容它们',
      // treePoints 里 b/c/f 都没有 group 也推不出分块 —— 它们必须还在页面上（散条），
      // 否则"界面看不见"就等于"不存在"，而数据其实还在。
      treeText.includes('客户 360 视图-概览页签') && treeText.includes('回款与计划多对多核销')
      && !treeText.includes('未分组')
      && !treeText.includes('落到这里'),
      treeText.slice(0, 200));
    check('顶部有块数统计与筛选框（块数只数**真的分块**：`pointTree` 里那个「未归类」条目不是一块地）',
      treeText.includes('3 块') && !treeText.includes('4 块') && treeText.includes('按名称或分块筛选…'));
    check('每一行都能改分块（可以把 AI 分错的挪走）', treeText.includes('需求分块'));
    check('可以在指定块下加一条（不用先建块再加人）', treeText.includes('加一条'));

    // —— 「+ 新分块」是下拉里的一项，选中它才长出取名框
    //
    // 这条交互被改过两轮，两轮都留下了不会报错的失败方式，所以断言分三层：
    //   1. **结构**：下拉里有这一项、而且在最后（已有分块在前，新建在后）；
    //   2. **不能自己顶成当前值**：没选过任何分块时下拉必须是空的，不能显示「+ 新分块」
    //      —— 上一版就是这个样子：只有一个选项时它被当成当前值显示出来，
    //      看着像"已经选中了新分块"，实际什么都没发生；
    //   3. **选中之后 value 真的变了**（换成哨兵值），否则有的浏览器不派发 change。
    check('不再用 window.prompt（受嵌环境里它会被禁，而且失败时静默）',
      !/window\.prompt/.test(CODE_ONLY(source)));

    /** 按 props 找节点（渲染树是普通对象，可以直接走）。 */
    function findByType(node, type) {
      const found = [];
      (function walk(current) {
        if (current === null || current === undefined || typeof current !== 'object') return;
        if (Array.isArray(current)) { for (const child of current) walk(child); return; }
        if (current.type === type) found.push(current);
        if (typeof current.type === 'function') { walk(current.type(current.props)); return; }
        if (Array.isArray(current.children)) for (const child of current.children) walk(child);
      })(node);
      return found;
    }

    /**
     * 带状态的渲染替身：`useState` 替身默认不保存状态（每个断言只看首屏），
     * 但"点一下再输入"这种流程必须让状态真的变。
     *
     * 这里按**调用序号**喂状态，序号由下面 `HOOKS` 那张表写死并做了自检。
     * 试过"按初值匹配"，不行：这个组件里有六个格子初值都是 `''`，按值匹配必然错位，
     * 而错位的表现是**静默地测了别的格子** —— 比直接失败更糟。
     */
    const HOOKS = ['name', 'assignee', 'group', 'busy', 'error', 'filter', 'assignFilter', 'closed', 'addingIn',
      'newRow', 'draft', 'renaming'];
    function renderWithHooks(Component, props, seeds) {
      const realState = reactStub.useState;
      let cursor = 0;
      reactStub.useState = (initial) => {
        const index = cursor;
        cursor += 1;
        const seeded = Object.prototype.hasOwnProperty.call(seeds, index) ? seeds[index] : undefined;
        return [seeded === undefined ? (typeof initial === 'function' ? initial() : initial) : seeded, () => {}];
      };
      let tree = null;
      try {
        tree = Component(props);
      } finally {
        reactStub.useState = realState;
        // 自检：实际调用次数必须与上面那张表对得上，否则说明 hook 顺序变了、
        // 下面的下标已经指到别的格子上去了。
        if (cursor !== HOOKS.length) {
          tree = { type: 'hookCountMismatch', props: { expected: HOOKS.length, actual: cursor }, children: [] };
        }
      }
      return tree;
    }
    const draftAt = HOOKS.indexOf('draft');
    const renamingAt = HOOKS.indexOf('renaming');

    const treeProps = { t, requirement: treeRequirement, onChanged: () => {} };
    const plain = renderWithHooks(internals.FeaturePoints, treeProps, {});
    check('FeaturePoints 的 hook 顺序与断言表一致（不一致说明下面喂错了格子）',
      plain.type !== 'hookCountMismatch',
      plain.type === 'hookCountMismatch' ? `期望 ${plain.props.expected} 个，实际 ${plain.props.actual} 个` : '');

    /** 只看**新增区**那个分块下拉（由 aria-label 认出）：它是唯一带 aria-label 的一个。 */
    const groupSelectOf = (tree) => findByType(tree, 'select').find((node) => node.props['aria-label'] === '需求分块');

    const optionValues = (select) => findByType(select, 'option').map((option) => option.props.value);
    /** 已有分块的选项（去掉那个空占位项和 `+ 新分块`）。 */
    const blockOptionValues = (select) => optionValues(select).filter((value) => value !== '' && value !== '__new');
    /** value 为空的占位项：必须存在，否则下拉会把第一项当当前值显示。 */
    const placeholderOf = (select) => findByType(select, 'option').find((option) => option.props.value === '');
    const plainGroupSelect = groupSelectOf(plain);
    check('新增区的分块下拉里有「+ 新分块」这一项（选它 → 分块下拉与分派人下拉之间长出文本框）',
      plainGroupSelect !== undefined && optionValues(plainGroupSelect).includes('__new'),
      plainGroupSelect === undefined ? '没有找到分块下拉' : optionValues(plainGroupSelect).join(','));
    check('「+ 新分块」排在**最后**（已有分块在前，新建在后）',
      plainGroupSelect !== undefined && optionValues(plainGroupSelect).slice(-1)[0] === '__new',
      plainGroupSelect === undefined ? '' : optionValues(plainGroupSelect).join(','));

    /**
     * ★★ 这一条是**两次"新分块还是加不了"的真因**，比上面几条都重要。
     *
     * `<select>` 的 value 匹配不上任何一项时（一块都还没建、或这条点还没归类），
     * 浏览器会把**第一项当当前值显示出来** —— 于是那一格显示着「+ 新分块」，
     * 看着像"已经选中了"，而用户点它时 **value 没变化、`change` 不派发**，取名框永远出不来。
     *
     * 修法：下拉里永远有一个 `value=""` 的占位项（`hidden`，列表里不出现，
     * 也不会多出一个「未分组」选项）。有了它，value 永远对得上，
     * 从空选到「+ 新分块」就是一次**真的** value 变化。
     */
    check('★ 两处下拉都带一个 value 为空的**隐藏**占位项（否则第一项会被当成当前值显示，而"选中"它不派发 change）',
      placeholderOf(plainGroupSelect) !== undefined
      && placeholderOf(plainGroupSelect).props.hidden === true
      && textsOfNode(placeholderOf(plainGroupSelect)).trim() === ''
      && plainGroupSelect.props.value === '',
      plainGroupSelect === undefined ? '没有找到分块下拉' : `value=${plainGroupSelect.props.value} options=${optionValues(plainGroupSelect).join(',')}`);

    /**
     * ★ 两处的分块下拉**选项不一样**，这是用户定的规则：
     *   功能点**行**上只能选已经建好的分块（那是"归类"，不是"造分类"）；
     *   **新增区**才多一项「+ 新分块」。
     *
     * 断言分两层：渲染树里**只有新增区那一个**下拉带 `__new`；行上那些下拉的选项
     * 恰好就是已有分块本身（一个不多、一个不少）。
     */
    const groupNames = ['客户主数据', '客户 360 视图', '联系人'];
    const selectsWithNew = findByType(plain, 'select').filter((node) => optionValues(node).includes('__new'));
    check('★ 全页只有一个下拉带「+ 新分块」，就是新增区那个（功能点行上的下拉只列已有分块）',
      selectsWithNew.length === 1 && selectsWithNew[0] === plainGroupSelect,
      `带 __new 的下拉有 ${selectsWithNew.length} 个`);
    const rowGroupSelect = findByType(plain, 'select').find((node) => {
      const values = blockOptionValues(node);
      return values.length === groupNames.length && groupNames.every((name) => values.includes(name));
    });
    check('★ 功能点行上的分块下拉只列**已经建好的**分块（没有「+ 新分块」）',
      rowGroupSelect !== undefined && optionValues(rowGroupSelect).includes('__new') === false
      && blockOptionValues(rowGroupSelect).join(',') === groupNames.join(','),
      rowGroupSelect === undefined ? '没有找到行上的分块下拉' : optionValues(rowGroupSelect).join(','));
    check('行上的下拉同样带那个空占位项（未归类的点不会显示成第一块的名字）',
      rowGroupSelect !== undefined && placeholderOf(rowGroupSelect) !== undefined
      && placeholderOf(rowGroupSelect).props.hidden === true);

    /**
     * ★★ 用户截图里那个状态：**一块都还没建**，只有一条未归类的功能点。
     *
     * 这正是"新分块加不了"的现场：下拉里只剩「+ 新分块」一项，而 value 是空串
     * （匹配不上任何一项）—— 浏览器于是把这一项当当前值显示出来，用户点它又没有任何
     * value 变化。所以这个状态下必须断言：两处下拉的 value 都是空串、都带隐藏占位项、
     * 而且那一项**不是**当前值。
     */
    const bareRequirement = {
      id: 'XQ20260919-0001', title: '空的', developers: ['张三'],
      featurePoints: [{ id: 'only', name: '偏耳', assignee: '', note: '' }],
    };
    const bareProps = { t, requirement: bareRequirement, onChanged: () => {} };
    const bare = renderWithHooks(internals.FeaturePoints, bareProps, {});
    const bareGroupSelect = groupSelectOf(bare);
    const bareRowSelect = findByType(bare, 'select').find((node) => node !== bareGroupSelect
      && optionValues(node).includes('') && !optionValues(node).includes('assigned'));
    check('★ 一块都没有时：新增区的下拉是「空占位 + 新分块」，当前值是空串而不是「+ 新分块」',
      bareGroupSelect !== undefined && optionValues(bareGroupSelect).join(',') === ',__new'
      && bareGroupSelect.props.value === '' && placeholderOf(bareGroupSelect).props.hidden === true,
      bareGroupSelect === undefined ? '没有找到分块下拉' : `${optionValues(bareGroupSelect).join(',')} value=${bareGroupSelect.props.value}`);
    check('★ 一块都没有时：功能点行上的下拉只有那个空占位项，当前值同样是空串（不会顶出「+ 新分块」）',
      bareRowSelect !== undefined && optionValues(bareRowSelect).join(',') === ''
      && bareRowSelect.props.value === '',
      bareRowSelect === undefined ? '没有找到行上的分块下拉' : `${optionValues(bareRowSelect).join(',')} value=${bareRowSelect.props.value}`);
    check('一块都没有时顶部显示「0 块」（不把"未归类"算成一块）',
      textsOfNode(bare).includes('0 块'), textsOfNode(bare).slice(0, 120));

    // 模拟：在新增区选中「+ 新分块」→ value 换成哨兵值、取名框打开
    const draftOpen = renderWithHooks(internals.FeaturePoints, treeProps, {
      [draftAt]: { open: true, value: '' },
      [HOOKS.indexOf('group')]: '__new',
    });
    const draftInput = findByType(draftOpen, 'input').find((node) => node.props.placeholder === '例如：客户主数据');
    check('选中「+ 新分块」后**真的渲染出**取名输入框（这就是原来缺失的那一步）',
      draftInput !== undefined, draftInput === undefined ? '没有找到取名输入框' : '');
    check('选中之后下拉的 value 变成哨兵值**而不是空串**（value 真的变了，change 才会派发）',
      groupSelectOf(draftOpen) !== undefined && groupSelectOf(draftOpen).props.value === '__new',
      groupSelectOf(draftOpen) === undefined ? '' : String(groupSelectOf(draftOpen).props.value));
    check('分块下拉里**没有**「未分组」这一项（它不是一块地，只是"还没归类"）—— 占位项是空的、且 hidden',
      plainGroupSelect !== undefined
      && !findByType(plainGroupSelect, 'option').some((option) => String(option.children?.[0] ?? '') === '未分组')
      && textsOfNode(placeholderOf(plainGroupSelect)).trim() === ''
      && placeholderOf(plainGroupSelect).props.hidden === true,
      plainGroupSelect === undefined ? '没有找到分块下拉' : optionValues(plainGroupSelect).join(','));
    check('取名输入框**不配确定/取消按钮**（用户只要填名字，别的都是噪声）',
      !draftText(draftOpen).includes('确定') && !draftText(draftOpen).includes('取消'),
      draftText(draftOpen).slice(0, 160));

    /**
     * ★ **位置**：取名框必须夹在**分块下拉与分派人下拉之间**（用户明确要求的顺序）。
     *
     * 位置这种东西渲染树里看不到"对不对"，只能按顺序断言：新增区那一行的控件依次是
     *   名称输入 → 分块下拉 → 【取名框】→ 分派人下拉 → 新增按钮。
     * 少一个、多一个、顺序变了都会红。
     */
    const addRow = findByType(draftOpen, 'div').find((node) => Array.isArray(node.children)
      && node.children.some((child) => child?.type === 'button' && textsOfNode(child).includes('新增功能点')));
    const addRowKinds = addRow === undefined ? [] : addRow.children
      .filter((child) => child !== null && child !== undefined && (child.type === 'select' || child.type === 'input'))
      .map((child) => (child.type === 'select' ? 'select' : (child.props.className === 'wcw-input wcw-newGroup' ? 'group-name' : 'input')));
    check('★ 取名框夹在「分块下拉」与「分派人下拉」之间：名称 → 分块 → 取名框 → 分派人 → 新增',
      addRowKinds.join(',') === 'input,select,group-name,select',
      addRow === undefined ? '没有找到新增区那一行' : addRowKinds.join(','));

    // 关闭状态下那一行没有取名框（不是一直挂着，也不是被别的控件顶掉）
    const addRowClosed = findByType(plain, 'div').find((node) => Array.isArray(node.children)
      && node.children.some((child) => child?.type === 'button' && textsOfNode(child).includes('新增功能点')));
    const addRowClosedKinds = addRowClosed === undefined ? [] : addRowClosed.children
      .filter((child) => child !== null && child !== undefined && (child.type === 'select' || child.type === 'input'))
      .map((child) => child.type);
    check('没选「+ 新分块」时那一行就是四件套：名称 → 分块 → 分派人 → 新增按钮',
      addRowClosedKinds.join(',') === 'input,select,select',
      addRowClosed === undefined ? '' : addRowClosedKinds.join(','));

    /** 渲染树里的纯文本（`<option>` 的文案不算内容）。 */
    function textsOfNode(node) {
      const out = [];
      (function walk(current) {
        if (typeof current === 'string' || typeof current === 'number') { out.push(String(current)); return; }
        if (current === null || current === undefined || typeof current !== 'object') return;
        if (Array.isArray(current)) { for (const child of current) walk(child); return; }
        if (current.type === 'option') return;
        if (Array.isArray(current.children)) for (const child of current.children) walk(child);
      })(node);
      return out.join(' ');
    }

    /**
     * ★ 取名输入框不能被包在 `<label>` 里。
     *
     * HTML 规定点 label 会把焦点转给它关联的控件（那里就是那个 select）—— 输入框刚拿到
     * 焦点就被转走，触发 onBlur，空值提交，输入框当场收起。**渲染层面完全正常**
     * （渲染树里它确实在），所以查渲染、查快照、查纯文本都发现不了；
     * 只有这条结构断言能拦住。这个坑踩过一次，留着它。
     */
    function insideLabel(target, root) {
      let found = false;
      (function walk(node) {
        if (found || node === null || node === undefined || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) walk(child); return; }
        if (typeof node.type === 'function') { walk(node.type(node.props)); return; }
        const kids = Array.isArray(node.children) ? node.children : [];
        if (kids.some((child) => child === target)) { if (node.type === 'label') found = true; return; }
        for (const child of kids) walk(child);
      })(root);
      return found;
    }
    // 先证明这个判定真的认得出"被 label 包住"，否则下面的断言可能只是空过
    const wrapper = { type: 'label', props: {}, children: [{ type: 'input', props: {}, children: [] }] };
    check('（自检）label>input 能被判定为"在 label 里"',
      insideLabel(wrapper.children[0], wrapper) === true);
    check('★ 取名输入框**不在 `<label>` 里**（在里面就会被 label 抢走焦点、当场收起）',
      draftInput !== undefined && !insideLabel(draftInput, draftOpen),
      draftInput === undefined ? '没有找到取名输入框' : '被包在 label 里');

    /**
     * 「什么时候算填完」：新增区这条路上**失焦不生效**。
     *
     * 踩过的坑：取名框曾经"失焦即提交"。用户点「新增功能点」的那一下会先触发失焦、
     * 把分块名写进 state，而同一个事件里 `addFromForm` 读到的还是**旧值** ——
     * 功能点于是落进旧分块，分块看着像建了却没接住那条点。
     * 所以只认「回车 = 直接新增」和「Esc = 放弃」。
     */
    check('新增区的取名框**不用失焦提交**（失焦提交会抢在「新增功能点」之前把旧值喂给新增逻辑）',
      !/onBlur/.test(source.slice(source.indexOf('function newGroupInput'), source.indexOf('function pointRow')))
      && /if \(event\.key === 'Enter'\) \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*addFromForm\(\);/.test(source));
    check('Esc 放弃新建分块，并把下拉弹回"没选分块"（否则它会一直停在「+ 新分块」上）',
      /setGroup\(''\);/.test(source) && /closeDraft\(\);\s*\n\s*\/\/ 放弃新建分块 = 下拉也要弹回/.test(source));
    check('新分块输入框**不 autoFocus**（焦点该由用户那一下点击决定，抢了反而更容易被夺走）',
      !/autoFocus: true/.test(source.slice(source.indexOf('function newGroupInput'), source.indexOf('function newGroupInput') + 1400)));
    check('哨兵值只活在控件里：**任何地方**都不会把 `__new` 写进 group 字段（写进去就是一个叫 __new 的脏分块）',
      !/group:\s*(NEW_GROUP|'__new')/.test(CODE_ONLY(source))
      && !/featurePoints[^\n]*NEW_GROUP/.test(CODE_ONLY(source)));
    check('行上的下拉显式传 `groupOptions(false)`、新增区传 `true`（两处选项不同这件事写在调用点上）',
      /groupOptions\(false\)/.test(source) && /groupOptions\(true\)/.test(source));

    // 模拟：点分块头上的「改名」→ 出现行内改名框，初值是当前块名
    const renameOpen = renderWithHooks(internals.FeaturePoints, treeProps, {
      [renamingAt]: { name: '客户主数据', value: '客户主数据' },
    });
    const renameBox = findByType(renameOpen, 'input').find((node) => node.props.value === '客户主数据'
      && node.props['aria-label'] === '改名');
    check('点「改名」出的是行内输入框、初值为当前块名（同样不弹窗）',
      renameBox !== undefined, renameBox === undefined ? '没有找到改名输入框' : '');
    check('改名框的标题说明了「块内功能点跟着换」（改名不是只改标签）',
      renameBox !== undefined && String(renameBox.props.title).includes('2 个功能点跟着换'),
      renameBox === undefined ? '' : String(renameBox.props.title));

    // —— 分派状态筛选：与名称筛选并列，两个条件同时生效
    const filterSelect = (tree) => findByType(tree, 'select').find((node) => findByType(node, 'option')
      .some((option) => option.props.value === 'assigned'));
    check('功能点区有「已分派 / 未分派」下拉筛选项（三项：全部 / 已分派 / 未分派）',
      (() => {
        const select = filterSelect(plain);
        if (select === undefined) return false;
        const values = findByType(select, 'option').map((option) => option.props.value);
        return values.join(',') === ',assigned,unassigned';
      })(),
      filterSelect(plain) === undefined ? '没有找到分派状态下拉' : '');

    check('筛选项排在名称筛选**前面**（先看缺口，再按名字定位）',
      (() => {
        const head = findByType(plain, 'div').find((node) => Array.isArray(node.children)
          && node.children.some((child) => child?.type === 'h3'));
        if (head === undefined) return false;
        const kinds = (head.children ?? []).filter((c) => c !== null && (c.type === 'select' || c.type === 'input'))
          .map((c) => c.type);
        return kinds.join(',') === 'select,input';
      })());

    // 行为：选中「未分派」后，只剩没派人的那条。
    // 注意用一份**带分派**的数据：`treePoints` 全部没派人，拿它测"已分派"只会得到空列表，
    // 那种断言通过也说明不了问题（两边都是空）。
    const assignedFixture = {
      id: 'XQ20260918-0009',
      title: 'CRM',
      developers: ['张三'],
      featurePoints: [
        { id: 'a', name: '客户建档', group: '客户主数据', assignee: '张三' },
        { id: 'b', name: '客户 360 视图-概览页签', assignee: '' },
        { id: 'c', name: '客户 360 视图-联系人页签', group: '客户 360 视图', assignee: '张三' },
        { id: 'f', name: '回款与计划多对多核销', assignee: '' },
        { id: 'g', name: '客户合并', group: '客户主数据', assignee: '' },
      ],
    };
    const assignedProps = { t, requirement: assignedFixture, onChanged: () => {} };

    const unassignedOnly = renderWithHooks(internals.FeaturePoints, assignedProps, {
      [HOOKS.indexOf('assignFilter')]: 'unassigned',
    });
    const unassignedText = draftText(unassignedOnly);
    check('选「未分派」后只剩下没派人的功能点',
      unassignedText.includes('客户 360 视图-概览页签') && unassignedText.includes('回款与计划多对多核销')
      && unassignedText.includes('客户合并')
      && !unassignedText.includes('客户建档') && !unassignedText.includes('客户 360 视图-联系人页签'),
      unassignedText.slice(0, 240));
    check('筛选后**有分块的**仍然保留块头（不是把功能点拍平）',
      unassignedText.includes('▾ 客户主数据'),
      unassignedText.slice(0, 240));

    const assignedOnly = renderWithHooks(internals.FeaturePoints, assignedProps, {
      [HOOKS.indexOf('assignFilter')]: 'assigned',
    });
    const assignedText = draftText(assignedOnly);
    check('选「已分派」后只剩下派了人的功能点',
      assignedText.includes('客户建档') && assignedText.includes('客户 360 视图-联系人页签')
      && !assignedText.includes('客户合并') && !assignedText.includes('回款与计划多对多核销'),
      assignedText.slice(0, 240));

    check('两个筛选条件同时生效（先按分派状态过滤，再按名称/分块过滤）',
      /const kept = entry\.points\.filter\(matchesAssign\)/.test(source)
      && /const hits = kept\.filter/.test(source));

    /** 取渲染树里的纯文本；**跳过 `<select>` 的选项文案** —— 那些是控件，不是内容。 */
    function draftText(node) {
      const texts = [];
      (function walk(current) {
        if (typeof current === 'string' || typeof current === 'number') { texts.push(String(current)); return; }
        if (current === null || typeof current !== 'object') return;
        if (Array.isArray(current)) { for (const child of current) walk(child); return; }
        if (typeof current.type === 'function') { walk(current.type(current.props)); return; }
        // `<option>未分派</option>` 的文案会被 `includes` 当成内容命中，让"筛掉了没有"这类
        // 断言变成假通过/假失败。控件文案一律不收。
        if (current.type === 'option') return;
        // 功能点的名字在**非受控 input 的 defaultValue** 里（可以就地改），不在 children 里 ——
        // 不收它，"只剩哪几条"就完全测不到了。
        if (current.type === 'input' && typeof current.props.defaultValue === 'string' && current.props.defaultValue !== '') {
          texts.push(current.props.defaultValue);
        }
        if (Array.isArray(current.children)) for (const child of current.children) walk(child);
      })(node);
      return texts.join(' | ');
    }
  }
}

// ── 31. 「新分块」真的能建出来（行为级，不只是渲染） ────────────────────────
// 上一组盯的是"渲染出了输入框"，这一组盯**数据**：新建分块、改名、把点挪进新块，
// 三条路都要真的落到 featurePoints 的 group 字段上。渲染对了但没落盘，
// 用户看到的是"加完又没了" —— 那是另一种"不生效"。
console.log('\n[31] 新建分块/改名真的落盘');
if (internals !== undefined && internals !== null) {
  const { mergeExtractedPoints, pointTree, pointGroupOf } = internals;

  // 组件是通过「读一次 requirement → 改 → 写回」落盘的；这里复现那条路径的结果形状。
  const base = [{ id: 'p1', name: '客户建档', group: '客户主数据', assignee: '张三' }];

  const added = mergeExtractedPoints(base, [{ name: '客户合并', group: '新分块甲', note: '' }], 'v1.0', 'T');
  check('新建分块并加一条：新点带上新分块，原有那条一个字不动',
    added.added === 1 && added.points[1].group === '新分块甲'
    && added.points[0].group === '客户主数据' && added.points[0].assignee === '张三');
  check('新分块立刻成块（一条也算，因为是写盘的，不受孤例约束）',
    pointTree(added.points).map((group) => group.name).join('|') === '客户主数据|新分块甲');

  // 改名：把一整块的点群移名
  const renamed = added.points.map((point) => (pointGroupOf(point) === '新分块甲' ? Object.assign({}, point, { group: '新分块乙' }) : point));
  check('改名：块内所有点一起换，块的顺序按首次出现保持',
    pointTree(renamed).map((group) => group.name).join('|') === '客户主数据|新分块乙');
  check('改名后旧块名不再存在（不会新旧两块并存）',
    pointTree(renamed).filter((group) => group.name === '新分块甲').length === 0);

  // 把一条挪进新块：只动这一条
  const moved = renamed.map((point) => (point.id === 'p1' ? Object.assign({}, point, { group: '另一块' }) : point));
  check('把单条挪到别块：只有它换了块，其余不受影响',
    pointGroupOf(moved[0]) === '另一块' && pointGroupOf(moved[1]) === '新分块乙');

  // 清空分块名 = 退回未分组（而不是写一个空串 group）
  const cleared = renamed.map((point) => {
    if (pointGroupOf(point) !== '新分块乙') return point;
    const next = Object.assign({}, point);
    delete next.group;
    return next;
  });
  check('把分块清空 = 退回未分组（去掉 group 字段，而不是留一个空串）',
    cleared[1].group === undefined && cleared[1].group !== '');

  /**
   * 「点新增功能点 → 分块和功能点一起建出来」这一步的判定规则。
   *
   * 它是唯一能把哨兵值 `__new` 写进数据、或者把"我要新建一块"悄悄丢掉的地方，
   * 两种都不会报错：前者长出一个叫 `__new` 的脏分块，后者功能点掉进未分组。
   * 两种都能在页面上"正常显示"，所以只有断言规则本身才拦得住。
   */
  const { groupForAdd, NEW_GROUP } = internals;
  check('导出了「新增时落进哪一块」的判定规则', typeof groupForAdd === 'function' && NEW_GROUP === '__new');
  check('选了已有分块：原样落进去（顺带规范化空白）',
    groupForAdd('客户主数据', '不该被读') === '客户主数据'
    && groupForAdd('  客户  主数据 ', '') === '客户 主数据');
  check('没选分块：落进未分组（空串，而不是 undefined/undefined 之类的怪值）',
    groupForAdd('', '没人要的输入') === '' && groupForAdd(undefined, '') === '');
  check('★ 选了「+ 新分块」并起了名字：分块名取**取名框里的字**，哨兵值绝不外泄',
    groupForAdd(NEW_GROUP, '  客户  主数据 ') === '客户 主数据'
    && groupForAdd(NEW_GROUP, '新分块甲') !== NEW_GROUP);
  check('★ 选了「+ 新分块」却没起名字：**拒绝**（null），不当成未分组默默放过去',
    groupForAdd(NEW_GROUP, '') === null && groupForAdd(NEW_GROUP, '   ') === null
    && groupForAdd(NEW_GROUP, undefined) === null);
}

// ── 32. 版本列表：不标当前版、与上一版对比、分析里带差异小节 ────────────────
// 三件事都属于"说清楚"而不是"能跑"，所以失败时不会报错，只会让人看不懂页面：
//   ① 版本行上挂「当前版」标签 → 暗示版本有"当前/最新"的角色，其实只是哪一行被点开；
//   ② 没有"和上一版比"的快捷入口 → 读者只能自己在两个版本之间来回点；
//   ③ 分析里没有"与上一版的差异" → 改版之后第一个问题（这次改了什么）没人回答得了。
console.log('\n[32] 版本列表与版本差异');
if (internals !== undefined && internals !== null) {
  const { extractSection, analysisDiffHeading, documentAnalysisPrompt } = internals;

  check('导出了差异小节相关的纯函数',
    typeof extractSection === 'function' && typeof analysisDiffHeading === 'function');

  check('差异小节的标题是统一的（指令与工作台认同一行字）',
    analysisDiffHeading('v1.1') === '## 与上一版（v1.1）的差异',
    analysisDiffHeading('v1.1'));

  const sample = [
    '# 分析',
    '',
    '## 1. 结论',
    '没什么。',
    '',
    '## 与上一版（v1.0）的差异',
    '- 新增：无',
    '- 删除：整章删除第 11 章',
    '### 补充说明',
    '三级标题属于本节。',
    '',
    '## 2. 下一节',
    '不该被带进来。',
  ].join('\n');
  const section = extractSection(sample, '## 与上一版（v1.0）的差异');
  check('取差异小节：到下一个二级标题为止，三级标题留在里面',
    section.includes('整章删除第 11 章') && section.includes('三级标题属于本节')
    && !section.includes('不该被带进来'),
    section);
  check('找不到那一节时返回空串（调用方据此提示"重新分析一次"）',
    extractSection(sample, '## 与上一版（v9.9）的差异') === ''
    && extractSection('', '## 与上一版（v1.0）的差异') === ''
    && extractSection(null, '## 与上一版（v1.0）的差异') === '');

  // 有上一版时，指令必须把"读上一版 + 写差异"写死
  const withPrev = documentAnalysisPrompt({
    id: 'XQ1', title: 'T', version: 'v1.1',
    textFile: 'Pipeline/需求/parsed/v1.1.txt',
    analysisPath: 'Pipeline/需求/analysis/v1.1.md',
    pointsPath: 'Pipeline/需求/analysis/v1.1.points.json',
    root: 'E:/ws', hasAnalysis: false,
    previousVersion: 'v1.0',
    previousTextFile: 'Pipeline/需求/parsed/v1.0.txt',
    previousAnalysisPath: 'Pipeline/需求/analysis/v1.0.md',
  });
  check('有上一版时：上一版的正文与分析都被列进「先读」',
    withPrev.includes('E:/ws/XQ1/Pipeline/需求/parsed/v1.0.txt')
    && withPrev.includes('E:/ws/XQ1/Pipeline/需求/analysis/v1.0.md'));
  check('有上一版时：差异小节的标题被写死成工作台会认的那一行',
    withPrev.includes('## 与上一版（v1.0）的差异'));
  check('差异要按新增/删除/修改/未变组织，并且**整章删除**要明确写出来',
    withPrev.includes('**新增**') && withPrev.includes('**删除**') && withPrev.includes('**修改**')
    && withPrev.includes('整章删除'));
  check('差异里要点名"文档自身的不一致"（改了正文没改汇总表这类）',
    withPrev.includes('文档自身的不一致') && withPrev.includes('章节断号'));
  check('差异里要交代对功能点清单的影响（少几条/多几条/哪些没了出处）',
    withPrev.includes('对功能点清单的影响') && withPrev.includes('已经没有出处'));
  check('只写实际读到的差异，不许拿"逐字相同"充数',
    withPrev.includes('只写实际读到的差异') && withPrev.includes('逐字相同'));

  // 第一版没有上一版：不该出现差异那一段，免得 AI 去比一个不存在的东西
  const first = documentAnalysisPrompt({
    id: 'XQ1', title: 'T', version: 'v1.0',
    textFile: 'Pipeline/需求/parsed/v1.0.txt',
    analysisPath: 'Pipeline/需求/analysis/v1.0.md',
    pointsPath: 'Pipeline/需求/analysis/v1.0.points.json',
    root: 'E:/ws', hasAnalysis: false,
  });
  check('第一版（没有上一版）不提差异要求，避免让 AI 去比不存在的东西',
    !first.includes('与上一版') && !first.includes('previousVersion'));

  // —— 渲染冒烟：不标当前版、边框高亮、行上有「与上一版对比」
  {
    function collect(node, texts) {
      if (node === null || node === undefined || typeof node === 'boolean') return;
      if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
      if (Array.isArray(node)) { for (const child of node) collect(child, texts); return; }
      if (typeof node !== 'object') return;
      if (typeof node.type === 'function') {
        try {
          collect(node.type(node.props), texts);
        } catch (error) {
          texts.push(`<crash: ${error && error.message ? error.message : error}>`);
        }
        return;
      }
      if (typeof node.props.value === 'string' && node.props.value !== '') texts.push(node.props.value);
      if (typeof node.props.placeholder === 'string') texts.push(node.props.placeholder);
      if (typeof node.props.title === 'string') texts.push(node.props.title);
      if (typeof node.props.className === 'string') texts.push(node.props.className);
      if (Array.isArray(node.children)) for (const child of node.children) collect(child, texts);
    }
    const req32 = {
      id: 'XQ20260918-0009',
      title: 'CRM',
      updatedAt: 'T',
      documents: [
        { version: 'v1.0', textFile: 'Pipeline/需求/parsed/v1.0.txt', sourceName: 'a.docx', importedAt: 'T', chars: 1 },
        { version: 'v1.1', textFile: 'Pipeline/需求/parsed/v1.1.txt', sourceName: 'b.docx', importedAt: 'T', chars: 2 },
      ],
    };
    const shown = [];
    try {
      collect(internals.RequirementDocuments({
        t, requirement: req32, onChanged: () => {}, root: 'E:/ws', running: false,
        sendPrompt: async () => {}, scopeKey: 's|XQ20260918-0009',
      }), shown);
    } catch (error) {
      shown.push('<crash: ' + (error && error.message ? error.message : error) + '>');
    }
    const text32 = shown.join(' | ');
    check('版本列表里不再出现「当前版」标签（选中与否只用边框表达）',
      !text32.includes('当前版') && !text32.includes('ver.active'));
    check('选中的那一版用专门的类做边框高亮，而不是靠标签',
      text32.includes('wcw-docRow wcw-docRowActive'));
    check('第一版没有「与上一版对比」，第二版有（按文件顺序取上一版）',
      (text32.match(/与上一版对比/g) ?? []).length === 1);
    check('「与上一版对比」的提示里点名了左右两版（避免比错对象还不自知）',
      text32.includes('对比 v1.0 → v1.1'));
    check('分析区不再挂「当前显示 X 的分析」这种说明（选中的行已经说明了）',
      !text32.includes('当前显示'));

    // —— 列对齐：文件名长短不同时，中间那列（字数 · 时间 · AI 分析）不能左右漂。
    // 报这个问题的截图里，两行的元信息起点差了几十像素 —— 纯文本断言看不出来，
    // 能断言的是**决定 x 位置的那些 CSS**：两列都必须是硬定宽。
    const rowCss = /\.wcw-docRow\{([^}]*)\}/.exec(source);
    const nameCss = /\.wcw-docName\{([^}]*)\}/.exec(source);
    const metaBase = /\.wcw-docMeta\{([^}]*)\}/.exec(source);
    // 居中那条必须**限定在版本行内**：`.wcw-docMeta` 是全局类，功能点区的说明、
    // 对比统计那些段落也用它 —— 加在全局上会把它们一起居中，那是副作用不是需求。
    const metaScoped = /\.wcw-docRow\s+\.wcw-docMeta\{([^}]*)\}/.exec(source);
    check('「信息居中」限定在版本行内，不写成全局 .wcw-docMeta（否则别的说明文字也被居中）',
      metaScoped !== null && /text-align:center/.test(metaScoped[1])
      && metaBase !== null && /text-align:left/.test(metaBase[1]),
      metaScoped === null ? '没有 .wcw-docRow .wcw-docMeta 规则' : metaScoped[1]);
    check('一行的三列在垂直方向居中（多列 + 按钮混排时不靠 flex-end 对基线）',
      rowCss !== null && /align-items:center/.test(rowCss[1]) && !/align-items:flex-end/.test(rowCss[1]),
      rowCss === null ? '没有 .wcw-docRow 规则' : rowCss[1]);

    const fixedWidth = (block) => block !== null && /flex:none/.test(block[1]) && /width:\d+px/.test(block[1]);
    check('文件名列是硬定宽（flex:none + width），不是 flex:1 —— 否则它吃掉空间、把后面那列推着走',
      fixedWidth(nameCss), nameCss === null ? '' : nameCss[1]);
    check('元信息列也是硬定宽，且起点因此与文件名长短无关',
      fixedWidth(metaBase), metaBase === null ? '' : metaBase[1]);

    const nameWidth = Number((/width:(\d+)px/.exec(nameCss[1]) ?? [0, 0])[1]);
    const metaWidth = Number((/width:(\d+)px/.exec(metaBase[1]) ?? [0, 0])[1]);
    check('元信息列够宽，不会因为内容长而换行（换行会改行高，纵向对齐同样会丢）',
      metaWidth >= 240 && nameWidth >= 200, `文件名 ${nameWidth}px / 元信息 ${metaWidth}px`);
    check('元信息列不换行（居中 + nowrap：文字块以列中线为轴，两行看起来才是一整块）',
      /white-space:nowrap/.test(metaBase[1]) && /overflow:hidden/.test(metaBase[1]));
  }
}

// ── 33. 删除需求：菜单入口 + 二次确认 + 宿主的整目录删除 ────────────────────
// 和这个项目里其它功能不同，这一条是**唯一不可逆**的。它安静的失败方式也就格外多：
//   ① 少一次确认 → 手滑一下就没了，而且没有任何地方还留着副本；
//   ② 确认框和菜单里的需求对不上 → 用户确认的是 A，删掉的是 B；
//   ③ 只删了一半 → 列表里留下一条读不出标题的幽灵记录；
//   ④ 该拒绝时静默成功 → 用户以为删了，其实还在（或者反过来）。
// 每一种都不抛异常，所以四种都要有断言，而且宿主那半边要在**临时目录上真跑一遍**。
console.log('\n[33] 删除需求');
if (internals !== undefined && internals !== null) {
  const { RequirementChips } = internals;
  check('导出了需求列表组件（否则「更多操作」里那条分支冒烟不到）', typeof RequirementChips === 'function');

  /** 收集渲染树里的纯文本；`<option>` 的文案不收（那是控件，不是内容）。 */
  function textsOf(node) {
    const out = [];
    (function walk(current) {
      if (typeof current === 'string' || typeof current === 'number') { out.push(String(current)); return; }
      if (current === null || current === undefined || typeof current !== 'object') return;
      if (Array.isArray(current)) { for (const child of current) walk(child); return; }
      if (current.type === 'option') return;
      if (typeof current.type === 'function') { walk(current.type(current.props)); return; }
      if (Array.isArray(current.children)) for (const child of current.children) walk(child);
    })(node);
    return out.join(' | ');
  }

  /** 按判定函数找节点。 */
  function nodesWhere(node, predicate) {
    const found = [];
    (function walk(current) {
      if (current === null || current === undefined || typeof current !== 'object') return;
      if (Array.isArray(current)) { for (const child of current) walk(child); return; }
      if (predicate(current)) found.push(current);
      if (typeof current.type === 'function') { walk(current.type(current.props)); return; }
      if (Array.isArray(current.children)) for (const child of current.children) walk(child);
    })(node);
    return found;
  }
  const buttonNamed = (tree, label) => nodesWhere(tree, (node) => node.type === 'button'
    && textsOf(node).includes(label))[0];

  const reqA = { id: 'XQ20260918-0001', title: 'CRM 一期', status: 'active', archived: false };
  const reqB = { id: 'XQ20260918-0002', title: 'CRM 二期', status: 'active', archived: false };

  /**
   * 渲染需求列表行。三个 hook 依次是：确认中的需求编号 / 删除进行中 / 删除错误。
   * 与 FeaturePoints 那边同一个道理：**按下标喂**，并且自检调用次数 ——
   * 少了自检，hook 顺序一变下面就静默地测了别的格子。
   */
  let chipHookCount = 0;
  function renderChips(seeds, overrides) {
    const real = reactStub.useState;
    let cursor = 0;
    reactStub.useState = (initial) => {
      const index = cursor;
      cursor += 1;
      const seeded = Object.prototype.hasOwnProperty.call(seeds, index) ? seeds[index] : undefined;
      return [seeded === undefined ? (typeof initial === 'function' ? initial() : initial) : seeded, () => {}];
    };
    let tree = null;
    try {
      tree = RequirementChips(Object.assign({
        t,
        requirements: [reqA, reqB],
        selectedId: reqA.id,
        menuFor: reqA.id,
        onSelect: () => {},
        onNew: () => {},
        onMenu: () => {},
        onSetStatus: () => {},
        onArchive: () => {},
        onRestore: () => {},
        onDelete: () => Promise.resolve(),
      }, overrides));
    } finally {
      reactStub.useState = real;
      chipHookCount = cursor;
    }
    return tree;
  }

  const calls = [];
  const record = (id) => { calls.push(id); return Promise.resolve(); };

  const menuOpen = renderChips({}, { onDelete: record });
  check('「更多操作」菜单里有「删除需求」入口',
    buttonNamed(menuOpen, '删除需求') !== undefined,
    textsOf(menuOpen).slice(0, 200));
  check('菜单里其余动作照旧（暂停 / 完成 / 移入历史 / 取消）',
    ['暂停', '标记完成', '移入历史', '取消'].every((label) => buttonNamed(menuOpen, label) !== undefined));

  // ★ 点它**只切到确认屏**，一下都不许碰磁盘。
  calls.length = 0;
  buttonNamed(menuOpen, '删除需求').props.onClick();
  check('★ 点「删除需求」只是切到确认屏，**没有**发出删除（不可逆的操作不能一步到位）',
    calls.length === 0, `onDelete 被调了 ${calls.length} 次`);

  // —— 确认屏（把"正在确认删除 A"喂进去）
  const confirming = renderChips({ 0: reqA.id }, { onDelete: record });
  const confirmText = textsOf(confirming);
  check('确认屏点名了要删的是哪一条（编号 + 标题都在）',
    confirmText.includes(reqA.id) && confirmText.includes('CRM 一期'), confirmText.slice(0, 200));
  check('确认屏说清楚了代价：整个需求文件夹、且没有副本可恢复',
    confirmText.includes('需求文件夹') && confirmText.includes('没有任何地方还留着副本'), confirmText.slice(0, 240));
  check('确认屏只给两个按钮：确认删除 / 取消',
    buttonNamed(confirming, '确认删除') !== undefined && buttonNamed(confirming, '取消') !== undefined);
  check('★ 确认屏上原来那些动作**根本不在 DOM 里**（归档/暂停此刻点不到，不会手滑）',
    buttonNamed(confirming, '移入历史') === undefined
    && buttonNamed(confirming, '暂停') === undefined
    && buttonNamed(confirming, '标记完成') === undefined);

  calls.length = 0;
  buttonNamed(confirming, '确认删除').props.onClick();
  check('★ 点「确认删除」才真的调用删除，而且删的正是确认过的那一条',
    calls.length === 1 && calls[0] === reqA.id, calls.join(','));
  check('删除按钮用错误色（它不是"另一种主按钮"，是一步走错就没法回头的那种）',
    /\.wcw-btnDanger\{[^}]*state-error-primary/.test(source));

  calls.length = 0;
  buttonNamed(confirming, '取消').props.onClick();
  check('点「取消」不发删除', calls.length === 0);

  // ★ 确认的和菜单里显示的不是同一条时，**不算在确认** —— 否则会删错对象。
  const mismatched = renderChips({ 0: reqB.id }, { selectedId: reqA.id, menuFor: reqA.id, onDelete: record });
  check('★ 确认状态与当前这条需求对不上时不算在确认（防"确认了 A、删掉了 B"）',
    buttonNamed(mismatched, '删除需求') !== undefined
    && buttonNamed(mismatched, '确认删除') === undefined,
    textsOf(mismatched).slice(0, 160));
  check('需求换了人（选中另一条）时确认框不跟过去',
    renderChips({ 0: reqB.id }, { selectedId: reqB.id, menuFor: reqB.id, onDelete: record }) !== null);

  check('（自检）需求列表行的 hook 数没变（顺序表失效会让上面几条静默测错格子）',
    chipHookCount === 3, `实际 ${chipHookCount} 个`);
  check('删除进行中时两个按钮都禁用（避免重复点出第二次删除）',
    /disabled: deleting,/.test(source));

  // —— 源码：失败不许吞掉，删除后的界面状态要收拾干净
  check('删除失败时把错误显示在确认屏里（不许"点了确认然后什么都没发生"）',
    /catch \(failure\) \{\s*\n\s*setDeleteError\(/.test(source)
    && /deleteError === '' \? null : h\('span', \{ className: 'wcw-error' \}, deleteError\)/.test(source));
  check('删除成功后收拾掉指向它的界面状态：选中项、详情弹框、本机通知、视图映射',
    /if \(detailId === id\) setDetailId\(''\);/.test(source)
    && /if \(selectedId === id\) setSelectedId\(''\);/.test(source)
    && /await callWorkbench\('clearNotice', \{ sessionId, args: \{ id \} \}\)\.catch\(\(\) => \{\}\);/.test(source));
  check('工作台的 onDelete 把 promise 交出去（吞掉的话确认屏永远显示不出失败原因）',
    /onDelete: \(id\) => deleteRequirement\(id\),/.test(source));
  check('「删除」不是 window.confirm（受嵌环境里它可能被禁，而且失败时静默返回 false）',
    !/window\.confirm\(t\('req\.delete/.test(CODE_ONLY(source)));

  /**
   * 宿主半边的 op 表是**开机时**注册的：改完插件不重启 DSH，页面这边一切正常，
   * 只有这一个动作报 `workbench/unknown-op` —— 看起来完全像功能坏了。
   * 所以这条错误必须被翻译成人话（"重启一次 DSH"），否则用户只会以为插件有 bug。
   */
  check('宿主是旧版本（unknown-op）时给出"重启一次 DSH"的人话提示，而不是原始报错',
    /if \(\/unknown-op\/\.test\(text\)\) throw new Error\(t\('req\.deleteNeedsRestart'\)\);/.test(source)
    && /'req\.deleteNeedsRestart'/.test(source));

  // —— 宿主半边：在临时目录上真删一遍
  const hostPath = join(packageRoot, 'index.js');
  let hostOps = null;
  try {
    hostOps = (await import(pathToFileURL(hostPath).href)).__ops;
  } catch (error) {
    hostOps = null;
  }
  check('宿主半边导出了可被自检调用的操作（删除太不可逆，不能只做源码正则）',
    hostOps !== null && typeof hostOps?.deleteRequirement === 'function');

  if (hostOps !== null && typeof hostOps.deleteRequirement === 'function') {
    const base = mkdtempSync(join(tmpdir(), 'wcw-delete-'));
    const target = join(base, 'XQ20260918-0001');
    const keep = join(base, 'XQ20260918-0002');
    const seed = (dir, id) => {
      mkdirSync(join(dir, 'Pipeline', '需求', 'parsed'), { recursive: true });
      writeFileSync(join(dir, 'requirement.json'), JSON.stringify({ schema: 1, id, title: 'T' }), 'utf8');
      writeFileSync(join(dir, 'Pipeline', '需求', 'parsed', 'v1.0.txt'), '正文', 'utf8');
    };
    seed(target, 'XQ20260918-0001');
    seed(keep, 'XQ20260918-0002');

    // 守卫还在：remove 不许顺手删掉需求文件夹本身
    let refused = false;
    try { await hostOps.removePath(base, { id: 'XQ20260918-0001', path: '.' }); } catch { refused = true; }
    check('remove 仍然拒绝删除需求文件夹本身（删里面的文件是日常操作，删整条需求不该由它顺手完成）',
      refused && existsSync(target));

    const result = await hostOps.deleteRequirement(base, { id: 'XQ20260918-0001' });
    check('★ 整条需求连文件夹一起删干净（文档、解析正文、分析都在里面，不会只剩空壳）',
      existsSync(target) === false && result.removed === true && result.id === 'XQ20260918-0001');
    check('只删点中的那一条（邻座的需求一个字不动）',
      existsSync(join(keep, 'requirement.json')) && existsSync(join(keep, 'Pipeline', '需求', 'parsed', 'v1.0.txt')));

    let missing = null;
    try { await hostOps.deleteRequirement(base, { id: 'XQ20260918-0001' }); } catch (error) { missing = error; }
    check('删一条已经不存在的需求必须**报错**，不能静默"成功"（那会让人以为删掉了）',
      missing !== null && /not-found/.test(String(missing?.code ?? missing?.message ?? '')),
      missing === null ? '没有报错' : String(missing?.code ?? ''));

    let badId = null;
    try { await hostOps.deleteRequirement(base, { id: '../../etc' }); } catch (error) { badId = error; }
    check('编号不合法时拒绝（路径拼接前先校验，不给"删到别处"留口子）',
      badId !== null && /bad-id/.test(String(badId?.code ?? '')), String(badId?.code ?? '没报错'));

    rmSync(base, { recursive: true, force: true });
  }
}

// ── 34. 方案文档生成：模板引擎、字段契约、接口 / 页面清单 ────────────────────
// 这一节要防的是**静默的空文档**：模板里少写一个字母、数据侧改一个字段名，
// 生成的文档就少一整块内容 —— 而"少一块"看起来和"这块本来就没内容"一模一样。
// 所以三件事都要钉住：① 引擎行为逐条定死；② 模板引用的字段必须有声明；
// ③ 声明的字段必须真能从数据里取到。另外"渲染"与"写盘"必须是两步 ——
// 直接落盘的话，等看到缺字段就已经晚了。
console.log('\n[34] 方案文档生成（模板引擎 + 接口 / 页面清单）');
if (internals !== undefined && internals !== null) {
  const {
    renderTemplate, collectRefs, scopeKeys, DOC_SCOPE_KEYS, BUILTIN_DOCS, designDocScope, designState,
    DESIGN_LISTS, designListState, designListPayload, designListShapeText, taskNo, parseDraftSections,
    docHeader, designDocFile, designPaths, templateHint, DOC_TEMPLATE_STAGE, DOC_TEMPLATE_FILE,
    hasDesignContent, STAGE_BLOCKS, DesignListSection, DesignDocSection,
  } = internals;

  // —— 引擎：取值的三条路（标量 / 循环 / 条件）
  const scalar = renderTemplate('编号 {{requirement.id}} · 开发 {{developer}}', { requirement: { id: 'XQ1' }, developer: '张三' });
  check('标量替换：按点号取值，原样落进正文',
    scalar.text === '编号 XQ1 · 开发 张三' && scalar.missing.length === 0, scalar.text);

  const empty = renderTemplate('上线 {{requirement.goLiveDate}}', { requirement: { goLiveDate: '' } });
  check('★ 文档级字段取不到值 → 渲染成「（待补：路径）」并登记（绝不静默留空）',
    empty.text === '上线 （待补：requirement.goLiveDate）'
    && empty.missing.join(',') === 'requirement.goLiveDate', empty.text);
  check('同一个缺失字段出现多次只登记一次（清单不刷屏）',
    renderTemplate('{{a}}/{{a}}', {}).missing.length === 1);

  const loop = renderTemplate('{{#each items}}[{{index}}:{{name}}]{{/each}}', { items: [{ name: 'a' }, { name: 'b' }] });
  check('each 循环：按行展开，序号从 1 起（表格的「#」列就靠它）', loop.text === '[1:a][2:b]', loop.text);
  check('each 遇到不是数组的值就当空，不猜也不崩',
    renderTemplate('x{{#each a}}y{{/each}}', { a: '字符串' }).text === 'x'
    && renderTemplate('x{{#each a}}y{{/each}}', {}).text === 'x');

  check('if/else：空串、空数组、0 都算「没有」',
    renderTemplate('{{#if a}}有{{else}}无{{/if}}', { a: [] }).text === '无'
    && renderTemplate('{{#if a}}有{{else}}无{{/if}}', { a: '' }).text === '无'
    && renderTemplate('{{#if a}}有{{else}}无{{/if}}', { a: 0 }).text === '无'
    && renderTemplate('{{#if a}}有{{else}}无{{/if}}', { a: 'x' }).text === '有');
  check('if 没有 else 时，条件不成立就什么都不输出', renderTemplate('{{#if a}}有{{/if}}', {}).text === '');

  // —— 列表项里的空单元格**不留**「待补」：一行的备注没写就是没写，
  //    每格都印「待补」会把真正的缺口淹掉（而真正的缺口正是这套机制要暴露的东西）。
  const cellEmpty = renderTemplate('{{#each rows}}[{{note}}]{{/each}}', { rows: [{ note: '' }] });
  check('列表项里的空字段留空，不算「待补」（表格空单元格是正常的）',
    cellEmpty.text === '[]' && cellEmpty.missing.length === 0, cellEmpty.text);

  // —— 语法错误一律抛错：一份半成品文档比一个明确的报错糟糕得多
  const throwsWith = (text, scope, pattern) => {
    try { renderTemplate(text, scope); return false; } catch (error) { return pattern.test(String(error.message)); }
  };
  check('★ 嵌套循环直接报错（模板要给人手写，嵌套语法一进来就没法维护）',
    throwsWith('{{#each a}}{{#each b}}x{{/each}}{{/each}}', { a: [], b: [] }, /不支持嵌套循环/));
  check('没闭合的块报错，而不是渲染出半成品', throwsWith('{{#if a}}x', { a: 1 }, /没闭合/));
  check('标签不成对报错', throwsWith('{{#each a}}x{{/if}}', { a: [] }, /不成对/));
  check('{{else}} 没有对应的 if 时报错', throwsWith('{{else}}', {}, /else/));
  check('不认识的块报错（只支持 each 与 if，不悄悄当文本输出）',
    throwsWith('{{#while a}}x{{/while}}', { a: [] }, /不认识的块/));

  // —— 契约：模板引用的字段 ⊆ 声明的字段 ⊆ 真实数据里能取到的字段
  const refs = collectRefs(BUILTIN_DOCS.design);
  const declared = new Set(DOC_SCOPE_KEYS.design);
  const undeclared = refs.filter((key) => !declared.has(key));
  check('★ 内置模板引用的每个占位符都在 DOC_SCOPE_KEYS 里声明过（否则改字段名只会让文档静默变空）',
    undeclared.length === 0, undeclared.join(', '));

  const fixtureRequirement = {
    id: 'XQ20260918-0009', title: 'CRM 一期', status: 'active', developers: ['张三', '李四'],
    releaseDate: '2026-10-10', testFreezeDate: '2026-10-01', goLiveDate: '2026-10-20',
    featurePoints: [
      { id: 'p1', name: '客户建档', group: '客户主数据', assignee: '张三' },
      { id: 'p2', name: '查重拦截', group: '客户主数据', assignee: '张三' },
      { id: 'p3', name: '别人的点', group: '', assignee: '李四' },
    ],
  };
  const fixtureDesign = designState({
    draft: '# 方案\n\n总述一句\n\n## 目标与范围\n\n只做客户主数据\n\n## 风险\n\n查重误拦\n',
    impact: { modules: 'crm_customer 表', risk: 'high', rollback: '开关降级', dependencies: '已有 RBAC' },
    tasks: {
      tasks: [
        { id: 't1', pointId: 'p1', title: '建表与迁移', estimate: 1.5, done: true },
        { id: 't2', pointId: 'p2', title: '查重服务', estimate: 2, done: false },
      ],
    },
    apis: {
      items: [{
        pointName: '查重拦截', taskNo: 'T02', name: '客户查重预检', method: 'POST',
        path: '/api/customer/dedup/check', change: '新增', request: 'name、uscc', response: 'hits[]', note: '',
      }],
    },
    pages: {
      items: [{
        pointName: '客户建档', taskNo: 'T01', name: '客户列表页', route: '/customer/list',
        change: '修改', blocks: '筛选区、列表', interaction: '失焦即预检', note: '',
      }],
    },
  });
  const scope = designDocScope({
    requirement: fixtureRequirement, developer: '张三', design: fixtureDesign,
    generatedAt: '2026-09-19T00:00:00.000Z', templateSource: '内置默认模板',
  });
  const actualKeys = new Set(scopeKeys(scope));
  const absentKeys = DOC_SCOPE_KEYS.design.filter((key) => !actualKeys.has(key));
  check('★ 声明的每个字段都真能从数据里取到（声明与实物不许两张皮）',
    absentKeys.length === 0, absentKeys.join(', '));

  const document = renderTemplate(BUILTIN_DOCS.design, scope);
  check('★ 数据齐全时，内置模板渲染出的文档**一处待补都没有**',
    document.missing.length === 0, document.missing.join(', '));
  check('文档里有接口清单表：表头 + 那一行的值都落到位',
    document.text.includes('## 二、后端接口清单')
    && document.text.includes('| 客户查重预检 | POST | /api/customer/dedup/check | 新增 |'), '');
  check('文档里有页面清单表：路由与关键交互都在',
    document.text.includes('## 三、前端页面清单')
    && document.text.includes('| 客户列表页 | /customer/list | 修改 | 筛选区、列表 | 失焦即预检 |'));
  check('正文按二级标题拆成小节进文档，动手前的总述也没丢',
    document.text.includes('### 目标与范围') && document.text.includes('### 风险') && document.text.includes('总述一句'));
  check('任务表带上任务号、来源功能点与人天', document.text.includes('| T02 | 查重服务 | 查重拦截 | 2 | 否 |'),
    '');
  check('任务号按数组次序推出来，与《方案汇总》同一规则（T01…T44）',
    taskNo(0) === 'T01' && taskNo(9) === 'T10' && taskNo(43) === 'T44'
    && scope.design.tasks.map((row) => row.taskNo).join(',') === 'T01,T02');
  check('功能点覆盖表只列**分派给我**的点，并带上关联任务号',
    scope.design.points.length === 2 && scope.design.points[0].taskNos === 'T01');

  // —— 数据没填时：缺口必须显式，不许伪装成"有值"
  const bare = designDocScope({
    requirement: { id: 'XQ1', title: 'T', featurePoints: [] }, developer: '张三',
    design: designState({}), generatedAt: 'T', templateSource: '内置默认模板',
  });
  const bareDoc = renderTemplate(BUILTIN_DOCS.design, bare);
  check('★ 三个日期为空时文档里明写「待补」（状态不许说谎：排期没定就说没定）',
    bareDoc.text.includes('（待补：requirement.releaseDate）')
    && bareDoc.text.includes('（待补：requirement.testFreezeDate）')
    && bareDoc.text.includes('（待补：requirement.goLiveDate）'));
  check('★ 影响面整个文件缺失时，四段都显示待补（而不是一片看着像"没这块内容"的空白）',
    bareDoc.text.includes('（待补：impact.risk）') && bareDoc.text.includes('（待补：impact.modules）')
    && bareDoc.text.includes('（待补：impact.rollback）') && bareDoc.text.includes('（待补：impact.dependencies）'));
  check('清单为空时给出**下一步做什么**的提示，而不是一张空表',
    bareDoc.text.includes('接口清单 apis.json 还没有内容') && bareDoc.text.includes('页面清单 pages.json 还没有内容'));
  check('正文为空时也不留白（把缺的那一块点出来）', bareDoc.text.includes('（待补：design.draft）'));

  // —— 正文切小节
  const parsed = parseDraftSections('# 标题\n\n引言一句\n\n## 目标与范围\n\n正文 A\n\n### 小节\n\n细节\n\n## 风险\n\n正文 B');
  check('正文按二级标题切小节，三级标题留在小节里',
    parsed.sections.length === 2 && parsed.sections[0].title === '目标与范围'
    && parsed.sections[0].body.includes('### 小节') && parsed.sections[1].title === '风险');
  check('第一个标题之前的引言单独留着（丢了就没开头那段总述）', parsed.preamble.includes('引言一句'));
  check('没有二级标题时（自由格式正文）不硬切，整篇当正文用',
    parseDraftSections('就一段话').sections.length === 0 && parseDraftSections('').preamble === '');

  // —— 生成头与写盘内容
  const header = docHeader({ templatePath: '', generatedAt: '2026-09-19T00:00:00.000Z' });
  check('生成头写明模板来源与数据源（日后翻出文档能说清它是哪来的）',
    header.includes('内置默认模板') && header.includes('draft.md') && header.includes('apis.json')
    && header.includes('2026-09-19T00:00:00.000Z'), header);
  check('生成头是 HTML 注释：说明性信息不污染文档正文',
    header.startsWith('<!--') && header.endsWith('-->'));
  const written = designDocFile({ text: '正文', templatePath: 'Pipeline/_templates/方案文档.md', generatedAt: 'T' });
  check('写盘内容 = 生成头 + 正文 + 收尾换行（外部工具读它不会缺换行）',
    written.startsWith('<!--') && written.includes('Pipeline/_templates/方案文档.md')
    && written.includes('正文') && written.endsWith('\n'));
  check('用的是自定义模板时，生成头里记的是自定义模板的路径（可追溯）',
    docHeader({ templatePath: 'Pipeline/_templates/方案文档.md', generatedAt: 'T' }).includes('Pipeline/_templates/方案文档.md'));

  // —— 清单：声明、规范化、落盘形状
  check('两张清单的文件名由声明表定死，且都在按人目录里',
    DESIGN_LISTS.apis.file === 'apis.json' && DESIGN_LISTS.pages.file === 'pages.json');
  const paths34 = designPaths('张三');
  check('清单与生成物的路径都在按人方案目录里',
    paths34.apis === 'Pipeline/方案/张三/apis.json' && paths34.pages === 'Pipeline/方案/张三/pages.json'
    && paths34.doc === 'Pipeline/方案/张三/方案文档.md', paths34.doc);
  check('生成物不与任何现有产物同名（不会覆盖 draft / impact / tasks / design）',
    [paths34.draft, paths34.impact, paths34.tasks, paths34.meta].every((path) => path !== paths34.doc));
  check('接口清单要能回答"改哪些接口"：方法 / 路径 / 新增改 / 入参出参都在表里',
    ['method', 'path', 'change', 'request', 'response'].every((key) => DESIGN_LISTS.apis.columns.some((column) => column.key === key)));
  check('页面清单要能回答"改哪些页面"：路由 / 区块 / 关键交互都在表里',
    ['route', 'blocks', 'interaction'].every((key) => DESIGN_LISTS.pages.columns.some((column) => column.key === key)));

  const dirtyRow = designListState(DESIGN_LISTS.apis, { items: [{ name: 42, path: null, method: 'POST' }] })[0];
  check('清单行规范化：类型不对的字段落回空串（界面上不出现 undefined / 数字）',
    dirtyRow.name === '' && dirtyRow.path === '' && dirtyRow.method === 'POST' && dirtyRow.note === '');
  check('清单文件形状不对时按空清单处理，不崩',
    designListState(DESIGN_LISTS.apis, null).length === 0
    && designListState(DESIGN_LISTS.apis, { items: '不是数组' }).length === 0);
  const payload34 = designListPayload(DESIGN_LISTS.apis, '张三', [dirtyRow]);
  check('清单落盘形状带上 schema / developer / items / updatedAt（与其它产物同一套约定）',
    payload34.schema === 1 && payload34.developer === '张三' && payload34.items.length === 1
    && typeof payload34.updatedAt === 'string');
  check('清单的 JSON 形状在指令里**由声明表生成**（表里加一列，指令里就多一列）',
    designListShapeText(DESIGN_LISTS.apis, '张三').includes('"path": "…"')
    && designListShapeText(DESIGN_LISTS.apis, '张三').includes('"developer": "张三"')
    && designListShapeText(DESIGN_LISTS.pages, '').includes('"route": "…"'));
  check('共享阶段才不带 developer 字段的规矩同样适用', !designListShapeText(DESIGN_LISTS.apis, '').includes('"developer"'));

  // —— 清单也算「方案动过」：只填了接口清单的人，方案页不该显示成「未开始」
  check('只填了接口清单也算动过方案',
    hasDesignContent(designState({ apis: { items: [{ name: 'x' }] } })) === true
    && hasDesignContent(designState({ pages: { items: [{ name: 'x' }] } })) === true
    && hasDesignContent(designState({})) === false);
  check('★ 两张清单**没有**并进 STAGE_BLOCKS（那张表决定阶段完成判定，方案靠的是定稿）',
    STAGE_BLOCKS.design === undefined && internals.stageVerdict('design', {}) === null);

  // —— 模板的落点：工作台级 `templates/<阶段>/`（宿主 ensureLayout 早就建好了这个目录）
  check('模板按「工作台级 templates/<阶段>/」解析，文件名与文档同名',
    DOC_TEMPLATE_STAGE.design === '方案' && DOC_TEMPLATE_FILE.design === '方案文档.md'
    && templateHint('design') === 'templates/方案/方案文档.md');
  check('未知的文档种类不给路径（而不是拼一个 /undefined）', templateHint('nope') === '');
  check('模板走宿主 op 读（它在工作台根、不在需求文件夹里，客户端读不到）',
    /callWorkbench\('readTemplate', \{ args: \{ stage, file \} \}\)/.test(source)
    && internals.WORKSPACE_OPS.includes('readTemplate') && internals.WORKSPACE_OPS.includes('writeTemplate'));

  // —— 渲染冒烟：两个区块真调一次（主视图默认停在需求页，走不到它们）
  function textsOf34(node) {
    const out = [];
    (function walk(current) {
      if (current === null || current === undefined || typeof current === 'boolean') return;
      if (typeof current === 'string' || typeof current === 'number') { out.push(String(current)); return; }
      if (Array.isArray(current)) { for (const child of current) walk(child); return; }
      if (typeof current !== 'object') return;
      if (typeof current.type === 'function') { walk(current.type(current.props)); return; }
      if (typeof current.props.value === 'string' && current.props.value !== '') out.push(current.props.value);
      if (typeof current.props.placeholder === 'string') out.push(current.props.placeholder);
      if (Array.isArray(current.children)) for (const child of current.children) walk(child);
    })(node);
    return out.join(' | ');
  }

  const listBase = {
    t, requirement: fixtureRequirement, developer: '张三',
    spec: DESIGN_LISTS.apis, rows: fixtureDesign.apis, path: paths34.apis,
    editable: true, onChanged: () => {},
  };
  const listText = textsOf34(DesignListSection(listBase));
  check('接口清单区块：标题、行数、每列的标签与占位符都在',
    listText.includes('接口清单') && listText.includes('1 行')
    && listText.includes('接口路径') && listText.includes('/api/customer/dedup/check')
    && listText.includes('没定就写（路径待确认）'), listText.slice(0, 200));
  check('清单行里不会漏出 undefined（坏数据在规范化那一步就落回空串了）',
    !listText.includes('undefined'));
  check('清单区块：AI 还没写清单时给的是"可以让 AI 起草"的提示，不是空白',
    textsOf34(DesignListSection(Object.assign({}, listBase, { rows: [] }))).includes('还没有内容'));
  const lockedList = textsOf34(DesignListSection(Object.assign({}, listBase, { editable: false })));
  check('别人的方案清单只读：没有「新增一行」也没有「保存」',
    !lockedList.includes('新增一行') && !lockedList.includes('保存'), lockedList.slice(0, 160));

  const docBase = { t, requirement: fixtureRequirement, developer: '张三', path: paths34.doc, editable: true };
  const docText = textsOf34(DesignDocSection(docBase));
  check('文档区块：还没生成时给【生成方案文档】与原因，而不是空白一块',
    docText.includes('生成方案文档') && docText.includes('还没有可生成的内容'), docText.slice(0, 200));
  check('文档区块：写明了生成物不要手改（要改就改数据源再重新生成）',
    docText.includes('不要直接改这份文档'));
  check('文档区块：不是自己的管线时不显示【写入文件】（能看不能落盘）',
    !textsOf34(DesignDocSection(Object.assign({}, docBase, { editable: false }))).includes('写入文件'));

  // —— 源码级：渲染与写盘必须分两步，且只有模板读取碰宿主
  check('★ 渲染与写盘是两步：生成按钮只渲染，落盘要再点一次（否则看到缺字段就晚了）',
    /setMessage\(result\.missing\.length === 0/.test(source)
    && /await callWorkbench\('writeText', \{ args: \{ id: requirement\.id, path, text: designDocFile\(rendered\) \} \}\)/.test(source));
  check('生成物与清单都用既有的 writeText 落盘（不为写产物新增宿主 op）',
    /callWorkbench\('writeText', \{\s*args: \{\s*id: requirement\.id,\s*path,\s*text: JSON\.stringify\(designListPayload/.test(source));
  check('模板引擎（解析 / 渲染 / 契约表）整个在客户端 bundle 里：改模板语法不用碰宿主',
    /const TAG_PATTERN = /.test(source) && /function renderTemplate\(/.test(source)
    && !/renderTemplate|BUILTIN_DOCS|DOC_SCOPE_KEYS/.test(readFileSync(join(packageRoot, 'index.js'), 'utf8')));
  // 宿主半边只提供「读写工作台级模板文件」这两个 op，而且**拒绝覆盖**已存在的模板。
  {
    const hostText = readFileSync(join(packageRoot, 'index.js'), 'utf8');
    check('宿主只多了 readTemplate / writeTemplate 两个 op（模板是文件，不是逻辑）',
      /readTemplate: async/.test(hostText) && /writeTemplate: async/.test(hostText)
      && (hostText.match(/workbenchRootFor\(ctx, payload\?\.sessionId\)/g) ?? []).length >= 17);
    check('★ 写出内置模板时**拒绝覆盖**已有文件（一次点击不该抹掉别人改好的公司模板）',
      /if \(await exists\(target\)\) \{\s*\n\s*throw new WorkbenchError\('workbench\/exists'/.test(hostText));
    check('模板目录仍然由 ensureLayout 建（TEMPLATE_DIRS 终于有人用了）',
      /['"]templates['"]/.test(hostText) && /TEMPLATE_DIRS\.map\(\(stage\) => \['templates', stage\]\)/.test(hostText));
    check('宿主没重启时明确提示「重启一次 DSH」，而不是静默换成内置模板',
      /gendoc\.needsRestart/.test(source) && /unsupported: \/unknown-op\/\.test\(reason\)/.test(source));
  }

  // —— 宿主半边：在临时目录上真的走一遍模板读写（"模板放哪"不能只靠正则断言）
  const hostPath34 = join(packageRoot, 'index.js');
  let host34 = null;
  try { host34 = (await import(pathToFileURL(hostPath34).href)).__ops; } catch (error) { host34 = null; }
  check('宿主导出了模板读写操作（否则模板落在哪这件事没法真跑一遍）',
    host34 !== null && typeof host34?.readTemplate === 'function' && typeof host34?.writeTemplate === 'function');

  if (host34 !== null && typeof host34?.writeTemplate === 'function') {
    const base34 = mkdtempSync(join(tmpdir(), 'wcw-template-'));
    await host34.ensureLayout(base34);
    check('ensureLayout 建出 templates/<阶段>/ 三个目录（TEMPLATE_DIRS 从此有人用了）',
      existsSync(join(base34, 'templates', '方案')) && existsSync(join(base34, 'templates', '测试'))
      && existsSync(join(base34, 'templates', '提版')));

    let readMissing = null;
    try { await host34.readTemplate(base34, { stage: '方案', file: '方案文档.md' }); } catch (error) { readMissing = error; }
    check('还没放模板时明确报 not-found（客户端据此回落到内置模板，而不是把空文件当模板）',
      readMissing !== null && /not-found/.test(String(readMissing?.code ?? readMissing?.message ?? '')),
      String(readMissing?.code ?? '没报错'));

    const written34 = await host34.writeTemplate(base34, {
      stage: '方案', file: '方案文档.md', text: '# 公司模板\n{{requirement.id}}\n',
    });
    check('写出模板：落在 templates/<阶段>/ 下，返回值带相对路径',
      written34.path === 'templates/方案/方案文档.md'
      && existsSync(join(base34, 'templates', '方案', '方案文档.md')));

    const back34 = await host34.readTemplate(base34, { stage: '方案', file: '方案文档.md' });
    check('读回来的内容逐字一致（模板里的 {{}} 不会被加工）',
      back34.text === '# 公司模板\n{{requirement.id}}\n' && back34.path === 'templates/方案/方案文档.md');

    let exists34 = null;
    try { await host34.writeTemplate(base34, { stage: '方案', file: '方案文档.md', text: '覆盖掉' }); } catch (error) { exists34 = error; }
    check('★ 再写同一个模板被拒绝，原文件一个字不动（不覆盖别人改好的公司模板）',
      exists34 !== null && /exists/.test(String(exists34?.code ?? ''))
      && readFileSync(join(base34, 'templates', '方案', '方案文档.md'), 'utf8').includes('公司模板'));

    let badStage34 = null;
    try { await host34.readTemplate(base34, { stage: '../需求', file: 'x.md' }); } catch (error) { badStage34 = error; }
    check('阶段名不在 TEMPLATE_DIRS 里就拒绝（不给路径拼接留口子）',
      badStage34 !== null && /bad-argument/.test(String(badStage34?.code ?? '')));

    let escape34 = null;
    try { await host34.readTemplate(base34, { stage: '方案', file: '../../requirement.json' }); } catch (error) { escape34 = error; }
    check('模板文件名里带 `..` 直接拒绝（越不出 templates 目录）',
      escape34 !== null && /bad-path/.test(String(escape34?.code ?? '')));

    rmSync(base34, { recursive: true, force: true });
  }
  check('清单的读写走的是既有的 readJsonOrNull / writeText，没有另起一套 IO',
    /readJsonOrNull\(id, paths\.apis\)/.test(source) && /readJsonOrNull\(id, path\)\.then\(\(json\) => \(\{ json \}\)\)/.test(source));
}

// ── 35. 随包 skill（requirement-doc-reader） ────────────────────────────────
// 「分析需求文档」**优先**用这个 skill。它的失败模式全是**静默的**：
// 文件没随包发出去、没投放进 $DSH_HOME/skills、frontmatter 不合法被 DSH 丢弃、
// 指令里没提它 —— 四种都不报错，只是分析结果比预期粗。所以每一条都值得断言。
console.log('\n[35] 随包 skill（requirement-doc-reader）');
{
  const host35 = await import(pathToFileURL(join(packageRoot, 'index.js')).href);
  const skillName = host35.SKILL_NAME;
  check('宿主导出 SKILL_NAME', skillName === 'requirement-doc-reader', String(skillName));

  const skillFile35 = join(packageRoot, 'skills', skillName, 'SKILL.md');
  check('随包 skill 文件真的在包里（skills/<名>/SKILL.md）', existsSync(skillFile35));

  check('package.json 的 files 收了 skills（否则离线归档里没有它，装完静默缺席）',
    Array.isArray(pkg.files) && pkg.files.includes('skills'));

  let installText35 = '';
  try { installText35 = readFileSync(join(packageRoot, 'tools', 'install.mjs'), 'utf8'); } catch { installText35 = ''; }
  check('install.mjs 的安装目录树含 skills（离线安装器要把它一起装进目标机）',
    /DIRECTORY_TREES\s*=\s*\[[^\]]*['"]skills['"][^\]]*\]/.test(installText35));

  // frontmatter 不合法时 DSH 只会**静默丢弃**这个 skill（日志里一行 warning），
  // 所以这里按 DSH 自己的规则校验：name 必须 kebab-case，description 必须有。
  const skillText35 = existsSync(skillFile35) ? readFileSync(skillFile35, 'utf8') : '';
  check('skill 的 frontmatter 合法（name 为 kebab-case、description 非空）',
    /^---\r?\n/.test(skillText35)
    && new RegExp(`^name:\\s*${skillName}\\s*$`, 'm').test(skillText35)
    && /^description:\s*\S/m.test(skillText35));
  check('skill 正文不是空壳（至少写清了产物与功能点粒度）',
    skillText35.includes('points.json') && skillText35.includes('功能点'));

  // —— 投放：幂等 + 绝不覆盖别人的同名 skill
  const home35 = mkdtempSync(join(tmpdir(), 'wcw-skill-'));
  const foreign35 = mkdtempSync(join(tmpdir(), 'wcw-skill-foreign-'));
  const paths35 = host35.skillPathsAt(home35);
  check('投放路径 = <home>/skills/<名>/SKILL.md',
    paths35.file === join(home35, 'skills', skillName, 'SKILL.md'), paths35.file);

  const first35 = await host35.installSkillInto(home35);
  check('首次投放成功、落盘、且内容与随包文件逐字一致',
    first35.ok === true && first35.changed === true
    && existsSync(paths35.file)
    && readFileSync(paths35.file, 'utf8') === skillText35);

  const second35 = await host35.installSkillInto(home35);
  check('★ 再投放一次不写盘（幂等：否则每次插件加载都白白触发一次 skill 目录重建）',
    second35.ok === true && second35.changed === false);

  const foreignPaths35 = host35.skillPathsAt(foreign35);
  mkdirSync(foreignPaths35.dir, { recursive: true });
  writeFileSync(foreignPaths35.file, '---\nname: requirement-doc-reader\ndescription: 我手写的\n---\n我的内容\n', 'utf8');
  const blocked35 = await host35.installSkillInto(foreign35);
  check('★ 同名但没有本插件标记时让路（覆盖掉用户手写的 skill 是不可逆的损失）',
    blocked35.ok === false
    && readFileSync(foreignPaths35.file, 'utf8').includes('我的内容')
    && !existsSync(foreignPaths35.marker));
  check('失败时给出可读原因、且绝不抛（skill 是增强项，装不上不该让插件加载失败）',
    typeof blocked35.reason === 'string' && blocked35.reason.length > 0);

  rmSync(home35, { recursive: true, force: true });
  rmSync(foreign35, { recursive: true, force: true });

  // —— 指令侧：**软依赖** —— 先试着加载，加载不到退回通用指令，但必须明说走哪条路。
  if (internals !== undefined && internals !== null) {
    check('客户端与宿主的 skill 名逐字一致（两边写岔了就永远加载不到）',
      internals.ANALYSIS_SKILL_NAME === skillName,
      `客户端 ${String(internals.ANALYSIS_SKILL_NAME)} / 宿主 ${String(skillName)}`);

    const prompt35 = internals.documentAnalysisPrompt({
      id: 'XQ20260917-0001',
      title: 't',
      version: 'v1.0',
      textFile: 'Pipeline/需求/parsed/v1.0.txt',
      analysisPath: internals.requirementAnalysisPath('v1.0'),
      pointsPath: internals.requirementPointsPath('v1.0'),
      root: 'E:/w/docs/requirements',
      hasAnalysis: false,
    });
    check('分析指令点名叫 AI 先试着加载 skill',
      prompt35.includes(skillName) && prompt35.includes('skill 工具'));
    check('指令给了加载不到时的退路（软依赖，不能让分析直接失败）',
      prompt35.includes('通用要求'));
    check('★ 加载不到时要求明说「本次没有用上 skill」——否则走没走上没人知道',
      prompt35.includes('没有用上 skill'));
    check('skill 顶不掉工作台的硬契约：两个产物路径与差异小节标题仍写死',
      prompt35.includes('E:/w/docs/requirements/XQ20260917-0001/Pipeline/需求/analysis/v1.0.md')
      && prompt35.includes('E:/w/docs/requirements/XQ20260917-0001/Pipeline/需求/analysis/v1.0.points.json'));
  }
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('全部通过。\n');
  process.exit(0);
} else {
  console.log(`${failures} 项失败。\n`);
  process.exit(1);
}
