export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="screen-header">
          <h2 className="screen-title" style={{ fontSize: '1.3rem' }}>{title}</h2>
          <button className="btn btn-small" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
