/**
 * 找出「活着的」DSH home —— 也就是**应用真正在读的那个**。
 *
 * 为什么需要它：`setup.exe` 装的 DSH 把 home 放在
 * `%LOCALAPPDATA%\<App>\.dsh` 这类位置，而不是 `%USERPROFILE%\.dsh`。
 * 往错的地方装，插件不会生效，而且**症状与「没重启」几乎一样**（页签不出现），
 * 极难分辨 —— 与其让人去猜，不如让安装器自己判断。
 *
 * 判据只有一个，但是硬的：**`sessions/` 里有没有近期活动**。
 * 一个 home 只要被 DSH 用过，`sessions/` 就有会话记录且在持续更新；
 * 没被用过的 home 里那个目录是空的或根本不存在。
 *
 * 本模块只读文件系统，不写任何东西。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 一个 home 的 `sessions/` 下最新的修改时间（毫秒）；没有则 0。 */
export function newestSessionMs(home, depth = 3) {
  let newest = 0;
  const walk = (dir, left) => {
    let entries;
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
        if (entry.isDirectory() && left > 0) walk(full, left - 1);
      } catch {
        /* 单个条目读不到就跳过 */
      }
    }
  };
  walk(join(home, 'sessions'), depth);
  return newest;
}

/** 这个目录看起来是不是一个 DSH home —— 判据是它有 `profiles\`。 */
function looksLikeHome(dir) {
  return existsSync(join(dir, 'profiles'));
}

/**
 * 扫描给定的根，找出所有像 home 的目录，按 `sessions/` 的新鲜度排序。
 *
 * 跳过符号链接/联接点（Windows 上会绕圈）与 node_modules（通常几万项，
 * 而 node_modules 里带着 cordis.patch.yml 的包会污染结果）。
 *
 * @param roots 起始目录列表
 * @param maxDepth 递归深度上限
 * @returns `[{ home, newestMs }]`，按 newestMs 降序
 */
export function findHomes(roots, maxDepth = 4) {
  const found = new Map();
  const walk = (dir, left) => {
    if (left < 0) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '$Recycle.Bin' || entry.name === 'Windows') continue;
      const full = join(dir, entry.name);
      try {
        if (statSync(full).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      if (looksLikeHome(full)) {
        const key = full.toLowerCase();
        if (!found.has(key)) found.set(key, { home: full, newestMs: newestSessionMs(full) });
        // 找到了就不要再往这个 home 里面钻（它内部的 profiles 不是 home）
        continue;
      }
      walk(full, left - 1);
    }
  };
  for (const root of roots) {
    if (root && existsSync(root)) walk(root, maxDepth);
  }
  return [...found.values()].sort((left, right) => right.newestMs - left.newestMs);
}

/** 默认的扫描根。`%LOCALAPPDATA%` 排在前面是因为 setup.exe 把 home 放在那里。 */
export function defaultRoots() {
  return [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.ProgramData,
    homedir(),
  ].filter((one) => typeof one === 'string' && one !== '');
}

/**
 * 决定该装到哪个 home。
 *
 * 规则（保守但有用）：
 *   - 显式给了 `--dsh-home` → **完全尊重**，不自动改（只回报它看起来是不是活的）。
 *   - 没显式给 → 如果默认/home 环境变量指定的那个**看起来没被用过**，
 *     而扫到了另一个**明显活着**的 home，就用那个，并说清楚换了。
 *   - 两个都活着 → 保持原样（不猜）。
 *
 * @param requested 原本要用的 home
 * @param explicit 用户是否显式指定
 * @returns `{ home, switched, reason, alternatives }`
 */
export function resolveHome(requested, explicit, roots = defaultRoots()) {
  const requestedAlive = newestSessionMs(requested);
  if (explicit) {
    return { home: requested, switched: false, reason: 'explicit', requestedAlive, alternatives: [] };
  }
  const homes = findHomes(roots);
  const alternatives = homes.filter((one) => one.home.toLowerCase() !== requested.toLowerCase());
  const fresh = homes.filter((one) => one.newestMs > 0);
  // 默认位置的 sessions 在最近 24 小时内有活动 → 认它，不猜。
  if (requestedAlive > 0 && Date.now() - requestedAlive < 24 * 3600 * 1000) {
    return { home: requested, switched: false, reason: 'requested-alive', requestedAlive, alternatives };
  }
  // 没活动：如果恰好只有一个别的 home 是活的，用它。
  if (fresh.length === 1) {
    return {
      home: fresh[0].home,
      switched: fresh[0].home.toLowerCase() !== requested.toLowerCase(),
      reason: requestedAlive === 0 ? 'requested-unused' : 'requested-stale',
      requestedAlive,
      alternatives,
    };
  }
  return { home: requested, switched: false, reason: fresh.length === 0 ? 'none-alive' : 'ambiguous', requestedAlive, alternatives };
}
