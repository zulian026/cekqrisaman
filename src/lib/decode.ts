/**
 * QR decoding: native BarcodeDetector fast path (Chrome Android), with a
 * ZXing WebAssembly fallback for everything else. All decoding is local.
 */
import { prepareZXingModule, readBarcodesFromImageData } from 'zxing-wasm/reader';
// @ts-ignore -- Vite resolves the ?url import to the emitted .wasm asset.
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

let prepared = false;
function prepareWasm() {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
    },
  });
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const w = window as unknown as { BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike };
  if (!w.BarcodeDetector) return null;
  try {
    return new w.BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export async function decodeImageData(imageData: ImageData): Promise<string | null> {
  const detector = getBarcodeDetector();
  if (detector) {
    try {
      const bitmap = await createImageBitmap(imageData);
      const codes = await detector.detect(bitmap);
      bitmap.close();
      if (codes.length > 0) return codes[0].rawValue;
    } catch {
      /* fall through to ZXing */
    }
  }
  prepareWasm();
  const results = await readBarcodesFromImageData(imageData, {
    formats: ['QRCode'],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
  });
  return results.length > 0 ? results[0].text : null;
}

export async function decodeBlob(blob: Blob): Promise<string | null> {
  const detector = getBarcodeDetector();
  if (detector) {
    try {
      const codes = await detector.detect(blob as ImageBitmapSource);
      if (codes.length > 0) return codes[0].rawValue;
    } catch {
      /* fall through to canvas + ZXing */
    }
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    // Cap the working size: huge photos decode slower and no better.
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return await decodeImageData(imageData);
  } finally {
    bitmap.close();
  }
}

export async function decodeVideoFrame(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const detector = getBarcodeDetector();
  if (detector) {
    try {
      const codes = await detector.detect(video as unknown as ImageBitmapSource);
      if (codes.length > 0) return codes[0].rawValue;
      return null;
    } catch {
      /* fall through to canvas path */
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
