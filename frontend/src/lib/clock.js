// The app's "now".
//
// Every timestamp in Ardent is simulated against a fixed present, so measuring
// elapsed time against the machine clock is wrong twice over: it drifts as the
// real date moves, and where the simulated present sits ahead of the real one
// it produces negative ages that render as "just now" forever.
//
// This lives in its own module so both the data engine and the formatters can
// read it without importing each other.

export const TODAY = new Date(2026, 8, 30); // 30 Sep 2026

/** Milliseconds for the app's present. */
export const now = () => TODAY.getTime();
