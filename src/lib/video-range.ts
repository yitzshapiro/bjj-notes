const VIDEO_CHUNK_BYTES = 16 * 1024 * 1024;

export function normalizeVideoRange(range: string | null, sizeBytes: number | null) {
  if (!range) return null;
  const openEnded = range.match(/^bytes=(\d+)-$/i);
  if (!openEnded) return range;

  const start = Number(openEnded[1]);
  if (!Number.isSafeInteger(start) || start < 0) return range;
  const maximumEnd = sizeBytes && sizeBytes > 0 ? sizeBytes - 1 : Number.MAX_SAFE_INTEGER;
  const end = Math.min(start + VIDEO_CHUNK_BYTES - 1, maximumEnd);
  return `bytes=${start}-${end}`;
}
