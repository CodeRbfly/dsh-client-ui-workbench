/**
 * 极简 tar(ustar) 读写 —— 离线安装自带，不依赖任何 npm 包，也不需要系统 tar。
 *
 * 为什么自己写：本插件的卖点之一是「零依赖、可离线安装」。如果离线安装脚本
 * 依赖 `tar` 命令或某个 npm 解包库，那离线这条路就不成立了。
 * Node 自带 zlib 能处理 gzip，但没有 tar。ustar 格式足够简单，自己读写反而更可控。
 *
 * 写出的归档带 `package/` 前缀，与 `npm pack` 的产物结构一致，
 * 因此 `npm install -g <file>.tgz` 也能直接消费同一个文件。
 */

const BLOCK = 512;

/** @param {string} text @param {number} length */
function octal(text, length) {
  return text.toString(8).padStart(length - 1, '0') + '\0';
}

/** 从定长字段里读字符串，遇到 NUL 截断。 */
function readString(buffer, start, length) {
  return buffer.toString('utf8', start, start + length).replace(/\0[\s\S]*$/, '');
}

/**
 * 构造一个 ustar 头块。
 * @param {{ name: string, size: number, mode?: number, mtimeSeconds?: number, type?: string }} entry
 * @returns {Buffer} 512 字节
 */
function tarHeader(entry) {
  const name = entry.name;
  if (Buffer.byteLength(name, 'utf8') > 100) {
    throw new Error(`tar: entry name too long for ustar (max 100 bytes): ${name}`);
  }
  if (entry.size > 0o77777777777) {
    throw new Error(`tar: entry too large for ustar size field: ${name}`);
  }

  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(entry.mode ?? 0o644, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');            // uid
  block.write(octal(0, 8), 116, 8, 'ascii');            // gid
  block.write(octal(entry.size, 12), 124, 12, 'ascii'); // size
  block.write(octal(entry.mtimeSeconds ?? 0, 12), 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');             // 校验和字段先填空格
  block.write(entry.type ?? '0', 156, 1, 'ascii');      // '0' = 普通文件
  block.write('ustar\0', 257, 6, 'ascii');              // POSIX magic
  block.write('00', 263, 2, 'ascii');                   // POSIX version

  let sum = 0;
  for (const byte of block) sum += byte;
  // 校验和写成 6 位八进制 + NUL + 空格，这是 tar 的历史约定。
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return block;
}

/**
 * 打包成 tar 字节流（未压缩）。
 * @param {readonly { name: string, data: Buffer, mtimeSeconds?: number }[]} entries
 * @returns {Buffer}
 */
export function writeTar(entries) {
  const parts = [];
  for (const entry of entries) {
    parts.push(tarHeader({ name: entry.name, size: entry.data.length, mtimeSeconds: entry.mtimeSeconds }));
    parts.push(entry.data);
    const padding = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // 归档结束标记
  return Buffer.concat(parts);
}

/**
 * 解析 tar 字节流。
 * 兼容 npm pack 的产物：PAX 扩展头（type 'x'/'g'）会跳过，文件读取其数据块。
 * @param {Buffer} buffer
 * @returns {{ name: string, data: Buffer }[]}
 */
export function readTar(buffer) {
  const files = [];
  let offset = 0;

  while (offset + BLOCK <= buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break; // 结束标记

    const rawName = readString(block, 0, 100);
    const sizeField = readString(block, 124, 12).trim();
    const size = sizeField === '' ? 0 : Number.parseInt(sizeField, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`tar: unreadable size field "${sizeField}" for entry "${rawName}"`);
    }
    const type = String.fromCharCode(block[156]) || '0';
    const prefix = readString(block, 345, 155);

    offset += BLOCK;
    const data = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x' || type === 'g') continue;                    // PAX 元数据
    if (type !== '0' && type !== '\0' && type !== '') continue;    // 目录/链接等

    files.push({ name: prefix === '' ? rawName : `${prefix}/${rawName}`, data: Buffer.from(data) });
  }

  return files;
}

/**
 * 去掉归档根的 `package/` 前缀（npm pack 约定），并拒绝路径穿越。
 * @param {string} name @param {string} [root]
 * @returns {string | null} 相对路径；不属于该根时返回 null
 */
export function stripArchiveRoot(name, root = 'package/') {
  if (!name.startsWith(root)) return null;
  const relative = name.slice(root.length);
  if (relative === '' ) return null;
  if (relative.startsWith('/') || relative.includes('..')) {
    throw new Error(`tar: refusing to extract unsafe path "${name}"`);
  }
  return relative;
}
