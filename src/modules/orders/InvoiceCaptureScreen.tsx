import { useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { listProducts } from '../../db/repositories/products';
import { getAliasMap } from '../../db/repositories/aliases';
import { getSetting } from '../../db/repositories/settings';
import { parseTallyInvoice } from '../../domain/invoiceParser';
import { canUseCamera, takeInvoicePhoto } from '../../services/camera';
import { READ_PASSES, readInvoicePass } from '../../services/ocr';
import { draftFromInvoice, draftStore } from './draft';

/** Photograph or upload an invoice; it is read on the phone, then shown for review. */
export function InvoiceCaptureScreen() {
  const { db } = useSession();
  const { push } = useNav();
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const process = async (blob: Blob, name: string, source: 'camera' | 'upload') => {
    setError(null);
    setProgress(0);
    try {
      const own = (await getSetting(db, 'business.gstin')) ?? undefined;
      const texts: string[] = [];
      let parsed = parseTallyInvoice([], own);
      for (let i = 0; i < READ_PASSES.length; i++) {
        setStage(i === 0 ? 'Reading the invoice on this phone…' : `Double-checking (pass ${i + 1} of ${READ_PASSES.length})…`);
        setProgress(0);
        texts.push(await readInvoicePass(blob, name, READ_PASSES[i], setProgress));
        parsed = parseTallyInvoice(texts, own);
        // Stop early once two readings agree that everything adds up.
        if (i >= 1 && parsed.lines.length > 0 && parsed.issues.length === 0 && parsed.lines.every((l) => l.issues.length === 0)) break;
      }
      const text = texts.join('\n\n----- next reading -----\n\n');
      const [products, aliases] = await Promise.all([listProducts(db), getAliasMap(db)]);
      draftStore.set(draftFromInvoice(parsed, products, aliases, { blob, name, source }, text));
      setStage(null);
      push({ name: 'orderReview' });
    } catch (err) {
      setStage(null);
      setError(`Could not read the invoice: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const photo = async () => {
    try {
      const blob = await takeInvoicePhoto();
      if (blob) await process(blob, 'photo.jpg', 'camera');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await process(f, f.name, 'upload');
  };

  return (
    <div className="screen">
      <ScreenHeader title="Order from invoice" />
      <div className="banner banner-ok">Works offline. The invoice is read on this phone; nothing is sent to the internet.</div>
      {stage ? (
        <div className="card center" style={{ minHeight: 200 }}>
          <div>
            <div className="list-title">{stage}</div>
            <progress max={1} value={progress} style={{ width: '100%', height: 24, marginTop: 16 }} />
            <p className="subtle">This takes about 10 to 30 seconds. The invoice is read more than once so lines are not missed.</p>
          </div>
        </div>
      ) : (
        <>
          {canUseCamera() && (
            <button className="btn btn-primary btn-block btn-scan" onClick={photo}>Take photo of invoice</button>
          )}
          <label className={`btn btn-block file-btn${canUseCamera() ? '' : ' btn-primary btn-scan'}`}>
            Choose photo or PDF
            <input type="file" accept="image/*,application/pdf,.pdf" onChange={upload} hidden />
          </label>
          <div className="card subtle">
            <b>Tips for photos:</b> lay the invoice flat, fill the screen with it, use good light, avoid shadows and keep the phone straight above it.
          </div>
        </>
      )}
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
    </div>
  );
}
