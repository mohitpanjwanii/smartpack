import { useEffect, useRef, useState } from 'react';
import { isCameraScanAvailable, scanOnce, ScanCancelled } from '../../services/scanner';

interface Props {
  onCode: (code: string) => void | Promise<void>;
  busy?: boolean;
  label?: string;
}

/**
 * One input that accepts barcodes three ways:
 * - the phone camera (big button, on phones),
 * - a USB/Bluetooth barcode gun (it types the code and presses Enter),
 * - typing by hand.
 * The text box keeps focus so a barcode gun works without tapping first.
 */
export function ScanInput({ onCode, busy, label = 'Scan or type a barcode' }: Props) {
  const [value, setValue] = useState('');
  const [camError, setCamError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  const submit = async (code: string) => {
    if (!code.trim() || busy) return;
    setValue('');
    await onCode(code);
    ref.current?.focus();
  };

  const camera = async () => {
    setCamError(null);
    try {
      await submit(await scanOnce());
    } catch (err) {
      if (!(err instanceof ScanCancelled)) setCamError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="scan-input">
      {isCameraScanAvailable() && (
        <button type="button" className="btn btn-primary btn-block btn-scan" onClick={camera} disabled={busy}>
          Scan with camera
        </button>
      )}
      <form
        className="scan-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
      >
        <input
          ref={ref}
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button className="btn" type="submit" disabled={busy || !value.trim()}>Enter</button>
      </form>
      {camError && <div className="banner banner-warn">{camError}</div>}
    </div>
  );
}
