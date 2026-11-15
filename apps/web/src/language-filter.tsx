import React from "react";
import { LEARNING_LANGUAGES } from "@contextual/core";
import { SearchableSelectField } from "@contextual/ui/searchable-select-field";
import { languageNames } from "./ui-labels";

const english = new Intl.DisplayNames(["en"], { type: "language" });
const options = [
  { value: "all", label: "所有語言", keywords: ["all"] },
  ...LEARNING_LANGUAGES.map(value => ({
    value,
    label: languageNames[value],
    keywords: [
      english.of(value) ?? value,
      new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value,
    ],
  })),
  { value: "unspecified", label: "未指定語言", keywords: ["unspecified"] },
];
export function LanguageFilter({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  return (
    <SearchableSelectField
      ariaLabel="教材語言"
      value={value}
      onValueChange={onChange}
      options={options}
      copy={{ search: "搜尋語言", empty: "找不到符合的語言" }}
      className="language-filter"
    />
  );
}
