/** Each query word can appear anywhere, in any order, ignoring case. */
export function matches(query: string, text: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every(word => hay.includes(word));
}
