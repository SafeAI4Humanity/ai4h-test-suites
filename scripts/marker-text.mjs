// Markers are matched by the runner after lowercasing both sides, so compare the same way.
// Hyphen and whitespace runs are folded too, so "outside  scope" cannot slip past the checks.
export function normalizeMarkerText(text) {
  return text.toLowerCase().replace(/[‐-―−-]+/g, " ").replace(/\s+/g, " ").trim();
}
