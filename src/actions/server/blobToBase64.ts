// Node.js compatible version for server actions
export async function blobToBase64(blob: Blob): Promise<string> {
  // Convert Blob to ArrayBuffer
  const arrayBuffer = await blob.arrayBuffer();

  // Convert ArrayBuffer to Buffer (Node.js)
  const buffer = Buffer.from(arrayBuffer);

  // Convert Buffer to base64 string
  return buffer.toString("base64");
}
