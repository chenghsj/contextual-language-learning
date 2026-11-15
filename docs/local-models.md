# Local and custom models

The browser extension's Native Host connects to OpenAI-compatible chat-completion
servers through the bundled Pi SDK. Start the model server separately; the app
does not download models. One local/custom connection can be saved at a time.

1. Update the Native Host and reload the extension after building this version.
2. Open **Settings → AI and models → Add AI connection → Local / custom**.
3. Enter the API base URL. Common defaults are `http://localhost:11434/v1` for
   Ollama and `http://localhost:1234/v1` for LM Studio. Use the address shown by
   your server. `localhost` refers to the computer running the Native Host.
4. Choose **Test connection** to query `/models`. The first returned model fills
   an empty Model ID field; other returned IDs are offered as input suggestions.
   You can enter the model ID manually and save if model listing is unsupported.
5. Enter an API key only if your server requires one. In **Advanced settings**,
   match the context window and maximum output to your server's actual limits.
   Defaults are 32,768 context tokens and 8,192 output tokens. Enable
   `reasoning_effort` only if the server and selected model support that parameter.
6. Choose **Save and use**. The connection and model become the active selection
   for the existing lesson and custom-content generation flows.

The connection test checks the model-list endpoint. It does not run inference or
prove lesson quality. Generation errors still appear through the existing Pi
feedback and job handling.

The connected service's **Edit connection** action reopens the settings. Saving an
edit selects the new model and refreshes its capabilities. **Remove connection**
deletes the settings and saved key, while preserving existing lessons.

API keys use the Host's existing secure credential store. Settings responses never
return the key. Leaving the key field blank preserves a saved key only for the
same API base URL; changing the address requires entering the key again. Use
**Remove saved key** to keep the endpoint but clear its authentication. Configuration
contains only the endpoint and model metadata in the product's `pi/local-model.json`;
global Pi CLI configuration and extensions remain isolated.

## Verification

- `node --import tsx --test packages/core/src/local-model.test.ts apps/local-host/src/agents/local-model.test.ts`
  validates persistence, credential scoping and real Pi streaming against a local
  simulated OpenAI-compatible HTTP server.
- `pnpm --filter @contextual/extension test:local-model-ui` verifies failed and
  successful connection tests, save, edit, selection and removal at 320px/light
  and 480px/dark with a simulated Native Host.

On 2026-11-13, the existing local Ollama server's `qwen2.5:7b` also returned
`{"local":true}` through this Pi adapter in 12.7 seconds including model loading
(102 input tokens, 6 output tokens). This used temporary configuration with an
8,192-token context and 512-token maximum output, and did not change the user's
saved settings. It verifies basic inference, not full lesson quality.
