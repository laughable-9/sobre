/** Client-side receipt image compression before upload / OCR.
 *
 *  Runs entirely in the browser via <canvas>. Downscales to fit within
 *  MAX_EDGE (preserving aspect) then encodes as JPEG at Q=0.72. A 4032x3024
 *  iPhone photo (~4 MB) usually lands under 250 KB, well within the free
 *  Supabase Storage budget and the 500 KB defensive ceiling on the /scan
 *  route.
 *
 *  Keeps the receipt legible: 1600px on the long edge preserves small
 *  printed text (the total, the date). Going lower saves bytes but
 *  degrades OCR accuracy on skinny thermal-printer fonts.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;

export async function compressReceiptImage(file: File): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_EDGE);
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
      JPEG_QUALITY,
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

function fitWithin(w: number, h: number, edge: number): { width: number; height: number } {
  if (w <= edge && h <= edge) return { width: w, height: h };
  const scale = w >= h ? edge / w : edge / h;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
