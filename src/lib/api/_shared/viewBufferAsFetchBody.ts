// TypeScript's lib.dom.d.ts types BufferSource (part of fetch's BodyInit) as
// ArrayBufferView<ArrayBuffer>, and @types/node types Buffer's backing as
// ArrayBufferLike (buffer.buffer.d.ts), so a Buffer is not a BodyInit. A view
// over the same memory satisfies the type without a copy.
export function viewBufferAsFetchBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const backingStore = buffer.buffer;
  if (backingStore instanceof ArrayBuffer) {
    return new Uint8Array(backingStore, buffer.byteOffset, buffer.byteLength);
  }
  return new Uint8Array(buffer);
}
