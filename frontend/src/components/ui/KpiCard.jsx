export default function KpiCard({ label, value, delta, deltaType = 'neutral', icon: Icon, prefix = '', suffix = '' }) {
  const deltaColor = deltaType === 'up' ? 'var(--color-success)' : deltaType === 'down' ? 'var(--color-destructive)' : 'var(--color-muted-fg)';
  const deltaArrow = deltaType === 'up' ? '▲' : deltaType === 'down' ? '▼' : '—';

  return (
    <div className="kpi-card">
      <div className="d-flex justify-content-between align-items-start">
        <div>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value">{prefix}{value}{suffix}</div>
          {delta !== undefined && (
            <div className="kpi-delta" style={{ color: deltaColor }}>
              {deltaArrow} {delta}
            </div>
          )}
        </div>
        {Icon && (
          <div className="kpi-icon">
            <Icon size={20} color="var(--color-primary)" />
          </div>
        )}
      </div>
    </div>
  );
}
