import { Link } from 'react-router-dom';
import { Plug } from 'lucide-react';

/**
 * Shown wherever a figure needs a source that is not connected.
 *
 * The alternative is inventing a number, and a dashboard that invents numbers
 * cannot be trusted for the ones it does not.
 */
export function NotConnected({ title, needs, children, compact = false, showLink = true }) {
  return (
    <div className={`not-connected${compact ? ' compact' : ''}`}>
      <span className="not-connected-icon"><Plug size={compact ? 15 : 20} strokeWidth={1.7} /></span>
      <div className="not-connected-body">
        <div className="not-connected-title">{title}</div>
        {needs && <div className="not-connected-needs">Needs {needs}</div>}
        {children && <div className="not-connected-text">{children}</div>}
      </div>
      {showLink && (
        <Link to="/sources" className="btn btn-sm not-connected-action">Data sources</Link>
      )}
    </div>
  );
}
