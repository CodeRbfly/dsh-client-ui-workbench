/**
 * 把「观察到的事实」翻译成「原因 + 修复命令」。
 *
 * ★ 单独成文件是有原因的：
 *   1. 它必须在**不联网、不碰文件系统**的情况下可测 —— 契约自检 import 它来跑四条分支；
 *   2. 四种结论里只有一种是健康状态，另外三种**没法在真机上逐个复现**
 *      （要复现「装错了 home」就得先把插件装错），所以只能靠断言覆盖。
 *
 * 本文件是纯函数，没有副作用。
 */

/**
 * @param input {
 *   hostHome: string|null,       运行中的宿主实际用的 home（由 ping 的 identityPath 推出）
 *   pingOk: boolean,             宿主通道 /api/rpc/workbench 是否通
 *   bootPresent: boolean|null,   启动图是否命中；null = 没拿到首页
 *   homesWithPackage: string[],  哪些 home 里真的装了包
 *   anyReferenced: boolean,      有没有哪个 profile 的补丁层引用了本插件
 *   packageDir: string|null,     包目录（用来打印核对命令）
 *   packageName: string,
 * }
 * @returns {{ code: 'ok'|'A'|'B'|'C'|'unknown', title: string, lines: string[] }}
 */
export function diagnose(input) {
  const hostHome = input.hostHome === undefined ? null : input.hostHome;
  const pingOk = input.pingOk === true;
  const bootPresent = input.bootPresent === undefined ? null : input.bootPresent;
  const homesWithPackage = Array.isArray(input.homesWithPackage) ? input.homesWithPackage : [];
  const packageName = typeof input.packageName === 'string' && input.packageName !== ''
    ? input.packageName
    : 'dsh-client-ui-workbench';

  if (bootPresent === true && pingOk) {
    return { code: 'ok', title: '一切正常：插件在启动图里，宿主通道也通。', lines: [] };
  }

  // A：装对了包，但装进了另一个 home —— setup.exe 装的 DSH 最容易这样。
  if (hostHome !== null && homesWithPackage.length > 0 && !homesWithPackage.includes(hostHome)) {
    return {
      code: 'A',
      title: '原因 A：**装错了 home**。',
      lines: [
        `    宿主实际用的是：${hostHome}`,
        `    插件却装在    ：${homesWithPackage.join('、')}`,
        '  修复：',
        `    node tools\\install.mjs --dsh-home "${hostHome}"`,
        '    然后重启 DSH（setup.exe 装的：退出应用再启动）。',
      ],
    };
  }

  // B：宿主半边活着（说明包与补丁层都对），缺的只是浏览器半边的发现/编入。
  if (pingOk && bootPresent === false) {
    const lines = [
      '    宿主半边已经起来了（ping 通），说明包与补丁层都对；',
      '    缺的是把它编进 window.__DSH_BOOT__ 的那一步。常见原因：',
      '      · 补丁层那行是刚加的，live 重载没接住 → **重启 DSH**（exe 装的：退出再启动）',
      '      · 这个 entry 之前被移除过（跑过 uninstall），重新引入时同样需要重启',
      '      · package.json 的 dsh.client.platform 不是 "web"，或 exports["./client"] 指向的文件不在',
    ];
    if (input.packageDir) {
      lines.push('    可以直接核对（在解包目录里跑）：');
      lines.push(`      node -e "const j=require('${input.packageDir.replace(/\\/g, '\\\\')}/package.json');console.log(j.dsh, j.exports)"`);
    }
    return { code: 'B', title: '原因 B：**装对了地方，但浏览器半边没被加载**。', lines };
  }

  // C：哪儿都没装。ping 必然也不通。
  if (!pingOk && homesWithPackage.length === 0) {
    return {
      code: 'C',
      title: '原因 C：**根本没找到装好的插件**。',
      lines: [
        `    候选 home 里都没有 profiles\\node_modules\\${packageName}。`,
        '  修复：先安装，再重启 DSH。',
        '    node tools\\install.mjs',
      ],
    };
  }

  const lines = ['  没能自动判定。把 [1]~[3] 的全部输出发回来即可。'];
  if (input.anyReferenced !== true) {
    lines.push('  注意：没有任何 profile 的补丁层引用本插件 —— 安装没写进运行中的 home。');
  }
  return { code: 'unknown', title: '原因待定。', lines };
}
