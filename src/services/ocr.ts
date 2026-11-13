/**
 * Free, offline invoice reading. Uses Tesseract (open-source text
 * recognition) running inside the app, with the English language data
 * bundled in the app. No internet, no account, no cost per invoice.
 */
import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('ocr/', document.baseURI).href;
      const w = await createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') progressHandler?.(m.progress);
        },
      });
      return w;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  progressHandler = onProgress;
  return workerPromise;
}
let progressHandler: ((p: number) => void) | undefined;

/** Load an image file into a canvas, scaled so the long side is about `target` px, in greyscale. */
async function imageToCanvas(blob: Blob, target: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(3, target / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = 'grayscale(1) contrast(1.15)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Render each page of a PDF (up to 5) at the given dpi, on white. */
async function pdfToCanvases(blob: Blob, dpi: number): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: HTMLCanvasElement[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas);
  }
  return pages;
}

export function isPdf(blob: Blob, name = ''): boolean {
  return blob.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}

export interface ReadPass {
  /** Tesseract page segmentation: 4 = columns of text, 6 = one uniform block. */
  psm: 4 | 6;
  /** Detail level: 1 = normal (about 200 dpi), 1.5 = finer. */
  detail: 1 | 1.5;
}

/** The passes tried in order; results are merged line by line. */
export const READ_PASSES: ReadPass[] = [
  { psm: 4, detail: 1 },
  { psm: 6, detail: 1 },
  { psm: 4, detail: 1.5 },
];

/** Read all text from an invoice photo or PDF with one pass. */
export async function readInvoicePass(blob: Blob, name: string, pass: ReadPass, onProgress?: (p: number) => void): Promise<string> {
  const canvases = isPdf(blob, name) ? await pdfToCanvases(blob, 200 * pass.detail) : [await imageToCanvas(blob, 2400 * pass.detail)];
  const worker = await getWorker(onProgress);
  const texts: string[] = [];
  for (const canvas of canvases) {
    await worker.setParameters({ tessedit_pageseg_mode: String(pass.psm) as never, preserve_interword_spaces: '1' });
    texts.push((await worker.recognize(canvas)).data.text);
  }
  return texts.join('\n');
}
