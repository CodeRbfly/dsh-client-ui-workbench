/**
 * 带 cookie jar 的有界重定向跟随。
 *
 * 为什么需要它：DSH 的 web 端可能挂着鉴权插件（例如 dsh-webui-auth），链路是
 *
 *   GET /            → 302 /?token=X
 *   GET /?token=X    → 303 /  + Set-Cookie: dsh-auth-<随机名>=...
 *   GET /（带 cookie）→ 200
 *
 * 浏览器会自动带上 cookie，所以用户看到的是一切正常。而 Node 的 `fetch` **默认
 * 不保存 cookie**，第三次请求仍然是未认证状态，于是回到链首，直到 undici 的
 * 20 次上限后抛 `fetch failed: redirect count exceeded`——
 * 于是「需要登录」被误报成「连不上宿主」。
 *
 * 这里用一个最小 cookie jar 把这条链走通；跳转次数有上限，避免真的死循环。
 * 只用 Node 内置能力，符合本仓库「零依赖、可离线」的约束。
 */

/** 创建一次探测会话用的 cookie 容器。 */
export function createCookieJar() {
  return new Map();
}

/**
 * 跟随重定向直到拿到非 3xx 响应。
 *
 * @param {string} target 起始 URL
 * @param {Map<string, string>} jar 由 {@link createCookieJar} 创建，跨多次调用复用
 * @param {number} [maxHops] 跳转次数上限
 * @returns {Promise<Response | null>} 最终响应；宿主不可达或跳转用尽时返回 null
 */
export async function fetchFollowingRedirects(target, jar, maxHops = 8) {
  let url = target;

  for (let hop = 0; hop < maxHops; hop += 1) {
    const headers = jar.size === 0
      ? {}
      : { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };

    let response;
    try {
      response = await fetch(url, { redirect: 'manual', headers });
    } catch {
      return null; // 宿主没起 / 端口不通 / DNS 失败
    }

    // Node 20+ 有 getSetCookie()；没有时退化为空数组，仍然能跑（只是可能过不了鉴权）。
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      const equals = pair.indexOf('=');
      if (equals > 0) jar.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) return response; // 3xx 但没有 Location：交给调用方判断
      url = new URL(location, url).href;
      continue;
    }

    return response;
  }

  return null; // 跳转次数用尽：多半是鉴权没走通
}

/**
 * 取 DSH web 首页 HTML。
 *
 * @param {string} webUrl DSH web 根地址
 * @returns {Promise<{ html: string | null, reason: string }>}
 *   `reason` 用于区分「宿主没起」和「鉴权没走通」这两种完全不同的情况。
 */
export async function fetchIndexHtml(webUrl) {
  const jar = createCookieJar();
  const response = await fetchFollowingRedirects(webUrl, jar);
  if (response === null) return { html: null, reason: '宿主不可达（没在跑，或端口不通）' };
  if (!response.ok) return { html: null, reason: `HTTP ${response.status}` };
  return { html: await response.text(), reason: 'ok' };
}

/**
 * 判断启动图里是否含某个客户端插件 entry。
 *
 * @param {string} html 首页 HTML
 * @param {string} packageName 插件包名（即启动图 entry id）
 * @returns {{ present: boolean, url: string | null }}
 */
export function findBootEntry(html, packageName) {
  if (!html.includes(`"id":"${packageName}"`)) return { present: false, url: null };
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`"id":"${escaped}","url":"([^"]+)"`));
  return { present: true, url: match === null ? null : match[1] };
}

/**
 * 把启动图里的 bundle 地址解析成绝对 URL。
 *
 * 为什么需要它：启动图里 `url` 的形状随 DSH 版本变 ——
 *   0.1.5：绝对路径 `/plugins/??…`（页面用 `<base href="/">`）；
 *   0.2.0：相对路径 `plugins/??…`（页面用 `<base href="./">`）。
 * 直接 `base + url` 拼接，后者会拼出 `http://127.0.0.1:3080plugins/…` ——
 * 非法 URL，`fetch` 直接抛，然后被报成「宿主不可达 / 鉴权未通过」。
 * 真实踩过：DSH 0.2.0 上 `install.mjs` 第 4 步、`probe.mjs`、`check-bundle.mjs`
 * 一起假报 FAIL，而同一个地址用 `new URL(url, base)` 取到的是 HTTP 200。
 *
 * @param {string} baseUrl 宿主根地址（带不带尾斜杠都行）
 * @param {string | null | undefined} url 启动图里的 url
 * @returns {string | null} 绝对 URL；url 为空或解析失败时返回 null
 */
export function resolveBundleUrl(baseUrl, url) {
  if (url === null || url === undefined || url === '') return null;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/**
 * 走一遍鉴权链路后 POST 一个 JSON 请求。
 *
 * `/api` 下的路由受 Host/Origin 围栏 + 浏览器登录态保护。这里是同源服务端脚本，
 * 所以要先把 cookie 拿到手（对首页走一次重定向链），再带着它发请求。
 *
 * @param {string} target 完整 URL
 * @param {Map<string, string>} jar 由 {@link createCookieJar} 创建
 * @param {unknown} body 请求体（会被 JSON 序列化）
 * @returns {Promise<{ status: number, json: unknown, text: string } | null>} 连接失败返回 null
 */
export async function postJson(target, jar, body) {
  // 先确保 jar 里有鉴权 cookie。
  await fetchFollowingRedirects(new URL('/', target).href, jar);

  const headers = { 'content-type': 'application/json' };
  if (jar.size > 0) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  } catch {
    return null;
  }
}

/**
 * 发一个工作台 RPC 请求。
 *
 * @param {string} webUrl DSH web 根地址
 * @param {string} op 操作名
 * @param {Record<string, unknown>} [payload] 额外负载（sessionId / args 等）
 * @returns {Promise<{ ok: boolean, status?: number, value?: unknown, error?: unknown, text?: string, reason?: string }>}
 */
export async function callWorkbench(webUrl, op, payload = {}) {
  const base = webUrl.replace(/\/$/, '');
  const result = await postJson(`${base}/api/rpc/workbench`, createCookieJar(), {
    type: 'client-request',
    rpcId: `probe-${Date.now()}`,
    // method 必须逐字等于路由路径去掉 /api/ 前缀。
    method: 'rpc/workbench',
    payload: { op, ...payload },
  });

  if (result === null) return { ok: false, reason: '宿主不可达' };
  if (result.status !== 200) {
    return {
      ok: false,
      status: result.status,
      text: result.text,
      reason: result.status === 401
        ? 'HTTP 401：未通过鉴权（说明路由确实挂在受保护的 /api 之下）'
        : `HTTP ${result.status}`,
    };
  }
  const envelope = result.json;
  if (envelope === null || typeof envelope !== 'object' || envelope.type !== 'server-response') {
    return { ok: false, status: result.status, text: result.text, reason: '响应不是 server-response 信封' };
  }
  const rpcResult = envelope.result;
  if (rpcResult?.ok === true) return { ok: true, status: result.status, value: rpcResult.value };
  return { ok: false, status: result.status, error: rpcResult?.error, reason: 'RPC 返回 ok:false' };
}
