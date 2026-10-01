// ZIP_STORED only: our installer/result packages need no compression or executable importer.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function archive(files: { name: string; bytes: Uint8Array }[]): Blob {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length + file.bytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true); // Valid DOS date: 1980-01-01 (Windows ZIP extraction).
    view.setUint32(14, checksum, true);
    view.setUint32(18, file.bytes.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.bytes, 30 + name.length);
    locals.push(local);
    const row = new Uint8Array(46 + name.length);
    const entry = new DataView(row.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x800, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, checksum, true);
    entry.setUint32(20, file.bytes.length, true);
    entry.setUint32(24, file.bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    row.set(name, 46);
    central.push(row);
    offset += local.length;
  }
  const size = central.reduce((sum, row) => sum + row.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true);
  tail.setUint16(8, files.length, true);
  tail.setUint16(10, files.length, true);
  tail.setUint32(12, size, true);
  tail.setUint32(16, offset, true);
  return new Blob(
    [...locals, ...central, end].map((part) => part.buffer as ArrayBuffer),
    {
      type: 'application/zip',
    },
  );
}

export function readArchive(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const fail = (): never => {
    throw new Error('invalid_archive');
  };
  if (bytes.length < 22 || bytes.length > 45_000_000) return fail();
  const tail = bytes.length - 22;
  if (
    view.getUint32(tail, true) !== 0x06054b50 ||
    view.getUint32(tail + 4, true) !== 0 ||
    view.getUint16(tail + 20, true) !== 0
  )
    return fail();
  const count = view.getUint16(tail + 10, true);
  const size = view.getUint32(tail + 12, true);
  let cursor = view.getUint32(tail + 16, true);
  if (count < 2 || count > 21 || view.getUint16(tail + 8, true) !== count || cursor + size !== tail)
    return fail();
  const centralEnd = cursor + size;
  const files = new Map<string, Uint8Array>();
  let localEnd = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014b50) return fail();
    const flags = view.getUint16(cursor + 8, true);
    const packed = view.getUint32(cursor + 20, true);
    const length = view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true);
    const extra = view.getUint16(cursor + 30, true);
    const comment = view.getUint16(cursor + 32, true);
    const start = view.getUint32(cursor + 42, true);
    if (
      view.getUint16(cursor + 10, true) !== 0 ||
      flags & ~0x800 ||
      packed !== length ||
      length > 2_000_000 ||
      cursor + 46 + nameSize + extra + comment > centralEnd ||
      start !== localEnd ||
      start + 30 > view.getUint32(tail + 16, true)
    )
      return fail();
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    if (!/^(manifest\.json|segment-\d{2}\.wav)$/.test(name) || files.has(name)) return fail();
    if (
      view.getUint32(start, true) !== 0x04034b50 ||
      view.getUint16(start + 6, true) !== flags ||
      view.getUint16(start + 8, true) !== 0 ||
      view.getUint32(start + 18, true) !== length ||
      view.getUint32(start + 22, true) !== length ||
      view.getUint16(start + 26, true) !== nameSize
    )
      return fail();
    const localName = decoder.decode(bytes.subarray(start + 30, start + 30 + nameSize));
    if (localName !== name) return fail();
    const dataStart = start + 30 + nameSize + view.getUint16(start + 28, true);
    localEnd = dataStart + length;
    if (localEnd > view.getUint32(tail + 16, true)) return fail();
    const data = bytes.slice(dataStart, localEnd);
    if (
      crc32(data) !== view.getUint32(cursor + 16, true) ||
      view.getUint32(start + 14, true) !== view.getUint32(cursor + 16, true)
    )
      return fail();
    files.set(name, data);
    cursor += 46 + nameSize + extra + comment;
  }
  if (cursor !== centralEnd || localEnd !== view.getUint32(tail + 16, true)) return fail();
  return files;
}

export function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
