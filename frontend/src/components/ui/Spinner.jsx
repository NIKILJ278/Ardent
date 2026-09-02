export default function Spinner({ size = 'md', center = false }) {
  const s = size === 'sm' ? '1.25rem' : size === 'lg' ? '3rem' : '2rem';
  const el = <div className="ardent-spinner" style={{ width: s, height: s }} />;
  if (!center) return el;
  return <div className="d-flex justify-content-center align-items-center py-5">{el}</div>;
}
