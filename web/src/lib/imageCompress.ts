/** Client-side receipt image compression before upload / OCR.
 *
 *  Runs entirely in the browser via <canvas>. Downscales to fit within a
 *  max edge (preserving aspect), encodes as JPEG, and — critically —
 *  CHECKS the result against a byte target, stepping down through
 *  progressively smaller/rougher attempts until it fits. The first
 *  version encoded once at 1600px/Q0.72 and shipped whatever came out;
 *  a noisy iPhone photo (low light, busy background) can exceed the
 *  /scan route's 500 KB ceiling at those settings, which surfaced as
 *  "Image too large. Max 512000 bytes" on iOS.
 *
 *  Ladder order keeps the receipt legible for OCR: hold 1600px on the
 *  long edge (small printed totals survive) and drop quality first;
 *  shrink dimensions only when quality alone can't fit the budget.
 *  Typical photos exit on the first attempt.
 */

/** Headroom under the 500 KB ceilings on /api/expense-logs (+ /scan). */
const TARGET_BYTES = 480 * 1024;

/** (long edge px, JPEG quality) attempts, best-looking first. */
const ATTEMPTS: ReadonlyArray<readonly [number, number]> = [
  [1600, 0.72],
  [1600, 0.55],
  [1280, 0.55],
  [1024, 0.5],
  [800, 0.45],
];

export async function compressReceiptImage(file: File): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  let smallest: Blob | null = null;
  for (const [edge, quality] of ATTEMPTS) {
    const blob = await encodeJpeg(img, edge, quality);
    if (blob.size <= TARGET_BYTES) return blob;
    if (!smallest || blob.size < smallest.size) smallest = blob;
  }
  // Pathological input — every attempt overshot. Return the smallest so
  // the server's size check names the real problem instead of a silent
  // client-side dead end.
  return smallest!;
}

async function encodeJpeg(
  img: HTMLImageElement,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const { width, height } = fitWithin(
    img.naturalWidth,
    img.naturalHeight,
    maxEdge,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode receipt image."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed."));
    img.src = src;
  });
}

function fitWithin(
  w: number,
  h: number,
  edge: number,
): { width: number; height: number } {
  if (w <= edge && h <= edge) return { width: w, height: h };
  const scale = w >= h ? edge / w : edge / h;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
