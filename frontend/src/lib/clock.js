// The app's "now".
//
// Every figure is real, so "today" is the real date. It is read once at load,
// which keeps a session internally consistent: a period chosen just before
// midnight does not change underneath the page. Elapsed times — "synced 3 min
// ago" — use the live clock, so they stay accurate for as long as the tab is
// open.
//
// This lives in its own module so both the data engine and the formatters can
// read it without importing each other.

export const TODAY = new Date();

/** Milliseconds for the present moment. */
export const now = () => Date.now();
