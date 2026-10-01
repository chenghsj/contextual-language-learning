# Pi feedback localization

The extension presents Pi feedback in the current UI locale (English, Traditional
Chinese, Simplified Chinese, Japanese, Korean). Generated lesson text continues to
use the lesson's instruction language. Provider and model names, codes, URLs and
input values are preserved.

## Display boundaries

| Pi output | Extension boundary | Behavior |
| --- | --- | --- |
| Provider listing, login, logout and transport errors | `PiSettings` | Localized feedback with diagnostic details |
| OAuth URL instructions and device codes | `PiSettings` | Localized instructions; original URL/code retained |
| Authentication prompts and choices | `PiSettings` | Known SDK copy translated; unknown requirements shown under localized copy, with original instructions expanded |
| Login completion | Sonner success toast | Uses the current locale even if changed during login |
| Model discovery errors and notices | `AiModelSelection` | Localized summary and expandable diagnostics |
| Generation, preflight, resume and background transport failures | `NoticeViewport` | Localized summary and expandable diagnostics |
| Generation progress | `App` | Application status and counts localized at display time |
| Persisted job failures | `TaskHistory` | Localized at display time without rewriting stored errors |

`pi-auth.ts` covers interactive SDK strings from the six supported providers:
OpenAI, Anthropic, Google/Gemini, GitHub Copilot, OpenRouter and Antigravity.
The bundled versions audited are Pi 0.99.1 and pi-antigravity 0.8.1. The UI also
recognizes browser/device choices provided by the SDK's shared authentication
helpers.

`pi-feedback.ts` classifies runtime errors (credentials, denied/expired device
authorization, quota, rate limit, network, unavailable models, invalid output,
local service and busy jobs). Arbitrary SDK/API/network error bodies cannot be
exhaustively translated. They always receive localized feedback and retain their
original text in expandable technical details. Unknown selection labels retain
their original wording alongside a localized label so choices remain distinguishable.
Unknown authentication instructions are expanded by default to avoid hiding input
requirements. SDK message content is rendered as text, never HTML.

## Upgrade and validation

`pi-feedback.test.ts` records interactive outputs from the installed provider
implementations and verifies five-locale fallback behavior. UI tests cover actual
login events/prompts, locale changes before completion, unknown instructions,
model errors and persisted generation failures. After upgrading Pi or adding a
provider, audit its authentication output and add known strings to these fixtures;
new remote diagnostics remain covered by the fallback automatically.

This concerns messages rendered inside the extension. Provider-owned sign-in
websites and SDK-hosted OAuth callback pages are outside the extension UI.
