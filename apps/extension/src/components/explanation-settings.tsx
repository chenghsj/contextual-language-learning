import React from "react";
import { EXPLANATION_TYPES, explanationPreferences, type LearningProfile } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { sentenceAnalysisCopy } from "../i18n/sentence-analysis";
import { SelectField } from "./ui/select";

export function ExplanationSettings({
  profile,
  onChange,
  locale,
}: {
  profile: LearningProfile;
  onChange: (profile: LearningProfile) => void;
  locale: UiLocale;
}) {
  const copy = sentenceAnalysisCopy(locale);
  const { enabled, emphasized } = explanationPreferences(profile);
  return (
    <section className="my-4 min-w-0 border-t border-border pt-4" data-ui="explanationSettings">
      <h3 className="text-xs font-semibold">{copy.preferences}</h3>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">
        {copy.preferencesHint}
      </p>
      <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
        {EXPLANATION_TYPES.map(type => (
          <label key={type} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span>{copy.label(type)}</span>
            <SelectField
              ariaLabel={copy.label(type)}
              value={
                !enabled.includes(type) ? "off" : emphasized.includes(type) ? "detailed" : "normal"
              }
              className="h-8 w-24 shrink-0 text-xs"
              options={[
                { value: "off", label: copy.off },
                { value: "normal", label: copy.normal },
                { value: "detailed", label: copy.detailed },
              ]}
              onValueChange={value => {
                const nextEnabled = EXPLANATION_TYPES.filter(item =>
                  item === type ? value !== "off" : enabled.includes(item),
                );
                const nextEmphasized = nextEnabled.filter(item =>
                  item === type ? value === "detailed" : emphasized.includes(item),
                );
                onChange({
                  ...profile,
                  enabledExplanations: nextEnabled,
                  emphasizedExplanations: nextEmphasized,
                });
              }}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
