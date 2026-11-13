interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  maxLength?: number;
  submitLabel?: string;
  disabled?: boolean;
}

/** Large on-screen number pad, so staff never need the phone keyboard for PINs. */
export function PinPad({ value, onChange, onSubmit, maxLength = 6, submitLabel = 'OK', disabled }: Props) {
  const press = (d: string) => {
    if (!disabled && value.length < maxLength) onChange(value + d);
  };
  return (
    <div>
      <div className="pin-dots" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} className={`pin-dot${i < value.length ? ' filled' : ''}`} />
        ))}
      </div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <button type="button" className="action" onClick={() => onChange(value.slice(0, -1))} disabled={disabled}>
          Delete
        </button>
        <button type="button" onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button
          type="button"
          className="action"
          onClick={onSubmit}
          disabled={disabled || value.length < 4}
          style={{ background: 'var(--brand)', color: '#fff', borderColor: 'var(--brand)' }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
