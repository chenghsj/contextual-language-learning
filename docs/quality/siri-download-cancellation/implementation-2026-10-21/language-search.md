# Searchable Siri voice languages

The Siri voice language selector now reuses SearchableSelectField and the existing five-locale language-search copy. The original language options, catalog-specific language entries, all-languages choice, current value and busy/connection disabling remain intact. Existing option keywords support English/native aliases and language codes where provided; catalog-only entries remain searchable by displayed label and code.

The browser fixture verified 韓 filters to 韓語, Enter selects 韓語, japanese finds 日語, an unknown query shows 找不到符合的語言, and 所有 selects 所有語言. Searching alone preserves the selected language. Evidence is in language-search.png and language-search-readback.txt. No Native Host or resource action changed.

Typecheck, formatting and extension build passed. Five selector tests and two focused searchable-language keyboard/disabled interaction tests passed. The initial broader shared-interaction test process was terminated with SIGKILL at approximately 105 seconds, so that run is not reported as passing; the relevant tests were rerun separately and passed. Actual production Chrome Sheet click-through was not performed for this small shared-component replacement.

Experience First favored the existing localized, keyboard-accessible search control over a second picker implementation. Only the Siri selector wiring changed in production.
