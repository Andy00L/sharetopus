// fetch's BodyInit takes a Uint8Array backed by an ArrayBuffer, and a Buffer's
// backing is typed ArrayBufferLike: a view over the same memory satisfies it
// without the full copy `new Uint8Array(buffer)` makes. Only a
// SharedArrayBuffer backing, which file and network reads never produce, is copied.
export function viewBufferAsFetchBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const backingStore = buffer.buffer;
  if (backingStore instanceof ArrayBuffer) {
    return new Uint8Array(backingStore, buffer.byteOffset, buffer.byteLength);
  }
  return new Uint8Array(buffer);
}
