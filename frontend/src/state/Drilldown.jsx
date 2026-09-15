import { createContext, useContext, useState, useCallback } from 'react';

/**
 * Drill-down is a stack. Every push narrows the scope by one dimension, so the
 * numbers at each level always sum to the level above it. The breadcrumb is
 * simply the stack rendered.
 */
const Ctx = createContext(null);

export function DrilldownProvider({ children, initialStack = [] }) {
  const [stack, setStack] = useState(initialStack);

  const open = useCallback((node) => setStack([node]), []);
  const push = useCallback((node) => setStack(prev => [...prev, node]), []);
  const back = useCallback(() => setStack(prev => prev.slice(0, -1)), []);
  const goTo = useCallback((index) => setStack(prev => prev.slice(0, index + 1)), []);
  const close = useCallback(() => setStack([]), []);

  return (
    <Ctx.Provider value={{ stack, open, push, back, goTo, close, isOpen: stack.length > 0 }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDrill() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDrill must be used inside <DrilldownProvider>');
  return v;
}
