/** Preserve custom installation names while retiring the previous default brand. */
export function productName(value?: string) {
  const name=value?.trim();
  return !name || name==="Metis AI" ? "Metis" : name;
}
