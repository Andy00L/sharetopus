const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

export function truncateToGraphemesAndBytes(
  text: string,
  limits: { maxGraphemes: number; maxUtf8Bytes: number },
): string {
  let keptText = "";
  let keptGraphemes = 0;
  let keptBytes = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const segmentBytes = Buffer.byteLength(segment, "utf8");
    if (
      keptGraphemes + 1 > limits.maxGraphemes ||
      keptBytes + segmentBytes > limits.maxUtf8Bytes
    ) {
      break;
    }
    keptText += segment;
    keptGraphemes += 1;
    keptBytes += segmentBytes;
  }
  return keptText;
}

function isHighSurrogate(charCode: number): boolean {
  return charCode >= HIGH_SURROGATE_MIN && charCode <= HIGH_SURROGATE_MAX;
}

export function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remainingText = text;
  while (remainingText.length > maxChars) {
    const lastBreakIndex = Math.max(
      remainingText.lastIndexOf("\n", maxChars),
      remainingText.lastIndexOf(" ", maxChars),
    );
    let cutIndex = lastBreakIndex > 0 ? lastBreakIndex : maxChars;
    if (isHighSurrogate(remainingText.charCodeAt(cutIndex - 1))) cutIndex -= 1;
    chunks.push(remainingText.slice(0, cutIndex));
    const isBreakAtCut = cutIndex === lastBreakIndex;
    remainingText = remainingText.slice(isBreakAtCut ? cutIndex + 1 : cutIndex);
  }
  chunks.push(remainingText);
  return chunks.filter((chunk) => chunk.trim().length > 0);
}
