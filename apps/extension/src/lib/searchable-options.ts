export type SearchableOption = { value: string; label: string; keywords?: readonly string[] };

function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

export function filterSearchableOptions(options: readonly SearchableOption[], query: string): SearchableOption[] {
  const search = normalizeSearch(query);
  if (!search) return [...options];
  return options.filter(option => [option.label, option.value, ...(option.keywords ?? [])]
    .some(text => normalizeSearch(text).includes(search)));
}
