import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
function assertRange(buffer, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw Object.assign(new Error(`ZIP ${label} 越界`), { code: 'ZIP_CORRUPT', offset, length });
}
function findEocd(buffer) {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) if (buffer.readUInt32LE(offset) === EOCD) return offset;
  throw Object.assign(new Error('ZIP 缺少中央目录结束记录'), { code: 'ZIP_EOCD_MISSING' });
}
function decodeName(bytes, flags) {
  if (flags & 0x800) return bytes.toString('utf8');
  const utf8 = bytes.toString('utf8');
  return utf8.includes('\uFFFD') ? bytes.toString('latin1') : utf8;
}

export class ZipArchive {
  constructor(input, { maxEntries = 10000, maxEntryBytes = 128 * 1024 * 1024, maxTotalBytes = 512 * 1024 * 1024 } = {}) {
    this.buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    this.maxEntries = maxEntries; this.maxEntryBytes = maxEntryBytes; this.maxTotalBytes = maxTotalBytes;
    this.entries = this.readDirectory();
  }
  readDirectory() {
    const eocd = findEocd(this.buffer);
    const disk = this.buffer.readUInt16LE(eocd + 4), centralDisk = this.buffer.readUInt16LE(eocd + 6);
    if (disk !== 0 || centralDisk !== 0) throw Object.assign(new Error('暂不支持多磁盘 ZIP'), { code: 'ZIP_MULTIDISK_UNSUPPORTED' });
    const count = this.buffer.readUInt16LE(eocd + 10), centralSize = this.buffer.readUInt32LE(eocd + 12), centralOffset = this.buffer.readUInt32LE(eocd + 16);
    if (count > this.maxEntries) throw Object.assign(new Error(`ZIP 条目数超过限制: ${count}`), { code: 'ZIP_ENTRY_LIMIT' });
    assertRange(this.buffer, centralOffset, centralSize, '中央目录');
    const entries = new Map(); let offset = centralOffset, total = 0;
    for (let index = 0; index < count; index += 1) {
      assertRange(this.buffer, offset, 46, '中央目录条目');
      if (this.buffer.readUInt32LE(offset) !== CENTRAL) throw Object.assign(new Error('ZIP 中央目录签名无效'), { code: 'ZIP_CENTRAL_INVALID', index });
      const flags = this.buffer.readUInt16LE(offset + 8), method = this.buffer.readUInt16LE(offset + 10);
      const crc32 = this.buffer.readUInt32LE(offset + 16), compressedSize = this.buffer.readUInt32LE(offset + 20), uncompressedSize = this.buffer.readUInt32LE(offset + 24);
      const nameLength = this.buffer.readUInt16LE(offset + 28), extraLength = this.buffer.readUInt16LE(offset + 30), commentLength = this.buffer.readUInt16LE(offset + 32), localOffset = this.buffer.readUInt32LE(offset + 42);
      assertRange(this.buffer, offset + 46, nameLength + extraLength + commentLength, '中央目录名称');
      const name = decodeName(this.buffer.subarray(offset + 46, offset + 46 + nameLength), flags).replace(/\\/g, '/');
      if (uncompressedSize > this.maxEntryBytes) throw Object.assign(new Error(`ZIP 条目过大: ${name}`), { code: 'ZIP_ENTRY_TOO_LARGE', name, uncompressedSize });
      total += uncompressedSize; if (total > this.maxTotalBytes) throw Object.assign(new Error('ZIP 解压总大小超过限制'), { code: 'ZIP_TOTAL_TOO_LARGE', total });
      entries.set(name, { name, flags, method, crc32, compressedSize, uncompressedSize, localOffset, directory: name.endsWith('/') });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }
  list(prefix = '') { return [...this.entries.keys()].filter((name) => name.startsWith(prefix)); }
  has(name) { return this.entries.has(String(name).replace(/\\/g, '/')); }
  read(name) {
    const key = String(name).replace(/\\/g, '/'), entry = this.entries.get(key);
    if (!entry) throw Object.assign(new Error(`ZIP 条目不存在: ${key}`), { code: 'ZIP_ENTRY_NOT_FOUND', name: key });
    if (entry.directory) return Buffer.alloc(0);
    if (entry.flags & 0x1) throw Object.assign(new Error(`ZIP 条目已加密: ${key}`), { code: 'ZIP_ENCRYPTED_UNSUPPORTED', name: key });
    assertRange(this.buffer, entry.localOffset, 30, '本地文件头');
    if (this.buffer.readUInt32LE(entry.localOffset) !== LOCAL) throw Object.assign(new Error(`ZIP 本地文件头无效: ${key}`), { code: 'ZIP_LOCAL_INVALID', name: key });
    const nameLength = this.buffer.readUInt16LE(entry.localOffset + 26), extraLength = this.buffer.readUInt16LE(entry.localOffset + 28), start = entry.localOffset + 30 + nameLength + extraLength;
    assertRange(this.buffer, start, entry.compressedSize, '压缩数据');
    const compressed = this.buffer.subarray(start, start + entry.compressedSize);
    let output;
    if (entry.method === 0) output = Buffer.from(compressed);
    else if (entry.method === 8) output = inflateRawSync(compressed, { maxOutputLength: this.maxEntryBytes });
    else throw Object.assign(new Error(`ZIP 压缩算法不受支持: ${entry.method}`), { code: 'ZIP_COMPRESSION_UNSUPPORTED', method: entry.method, name: key });
    if (entry.uncompressedSize !== 0xffffffff && output.length !== entry.uncompressedSize) throw Object.assign(new Error(`ZIP 解压大小不匹配: ${key}`), { code: 'ZIP_SIZE_MISMATCH', expected: entry.uncompressedSize, actual: output.length });
    return output;
  }
  text(name, encoding = 'utf8') { return this.read(name).toString(encoding); }
}

export function openZip(input, options) { return new ZipArchive(input, options); }
