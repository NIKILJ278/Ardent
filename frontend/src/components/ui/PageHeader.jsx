export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header d-flex justify-content-between align-items-start flex-wrap gap-2">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="d-flex gap-2">{actions}</div>}
    </div>
  );
}
