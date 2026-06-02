export interface TextChunk {
  index: number;
  text: string;
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 160;

export function chunkText(
  content: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): TextChunk[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }
  if (chunkSize <= overlap || overlap < 0) {
    throw new Error("Chunk size must be greater than overlap.");
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(" ", end);
      if (boundary > start + Math.floor(chunkSize * 0.6)) {
        end = boundary;
      }
    }

    chunks.push({ index: chunks.length, text: normalized.slice(start, end).trim() });
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
