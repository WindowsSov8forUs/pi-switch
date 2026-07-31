# pi-switch

Multi-account provider switching for [Pi](https://github.com/earendil-works/pi).

Manage multiple API keys / OAuth accounts per provider, and define custom
(additional) providers with per-account credentials — all through two commands:

- `/switch` — pick a saved account and register it as a Pi provider
- `/switch models` — manage accounts: add (via Pi's native login flow),
  edit name/notes, delete; custom provider accounts are configured manually
  (see [Custom provider accounts](#custom-provider-accounts) below)

## Install

```bash
pi install npm:pi-switch
```

Distribution is npm-only. There is no git/local-path install path (see
[Development](#development) for how to run from source).

## Usage

### `/switch`

```
Select provider type
  ├─ Built-in Provider  →  provider list (only those with saved accounts)
  │                       →  account list → register + use /model to select
  └─ Additional Provider →  custom provider list
                           →  account list → register
```

Registration only registers the provider (`pi-switch:<key>:<account-id>`); you
then pick the model with Pi's `/model` — pi-switch does not hijack model
selection.

### `/switch models`

Account management with the same navigation style as Pi's `/login`.

```
Select provider type
  ├─ Built-in Provider → ALL built-in providers, with (count) suffix
  │                      → account list
  │                         ├─ + Add account...  (Pi native login flow:
  │                         │     API key prompt or full OAuth)
  │                         ├─ existing account → Edit account / Delete account
  └─ Additional Provider → custom providers (count)
                           └─ existing account → Edit name/notes / Delete
                             (custom providers and accounts are added manually
                              — see "Custom provider accounts" below)
```

## Data

Accounts are stored in `~/.pi/agent/pi-switch.json`:

```json
{
  "version": 1,
  "providers": {
    "anthropic": [
      { "id": "work-lz8abc", "name": "Work", "notes": "company key",
        "data": { "type": "api_key", "key": "$ANTHROPIC_WORK_KEY" } }
    ],
    "custom:my-llm": [
      { "id": "main-lz9def", "name": "Main", "notes": "",
        "data": { "baseUrl": "http://localhost:8080/v1",
                  "api": "openai-completions", "apiKey": "$MY_LLM_KEY",
                  "models": [...] } }
    ]
  }
}
```

- Built-in account `data` = the credential shape from `auth.json`
  (`{ type: "api_key", key }` or `{ type: "oauth", ... }`).
- Custom account `data` = the provider config shape from `models.json`
  (`{ baseUrl, api, apiKey, models }`).

## Custom provider accounts

Custom (`custom:<slug>`) providers are **configured by editing**
`~/.pi/agent/pi-switch.json` directly. There is no TUI flow to add them:
third-party gateways (OpenAI-compatible relays, New-API style hubs, etc.)
differ too much in what they expose for an interactive form to cover
reliably.

The account `data` field is the **same shape as a Pi provider registration**
(`ProviderConfig` — identical to an entry in Pi's `models.json`), so anything
you can configure in `models.json` can be stored here and activated with
`/switch`.

```json
{
  "version": 1,
  "providers": {
    "custom:my-llm": [
      {
        "id": "main-lz9def",
        "name": "Main",
        "notes": "company gateway",
        "data": {
          "name": "My LLM",
          "baseUrl": "https://gateway.example.com/v1",
          "api": "openai-responses",
          "apiKey": "$MY_LLM_KEY",
          "authHeader": true,
          "models": [
            {
              "id": "gpt-5.6-sol",
              "name": "GPT-5.6 Sol",
              "reasoning": true,
              "input": ["text", "image"],
              "contextWindow": 272000,
              "maxTokens": 128000,
              "cost": {
                "input": 5, "output": 30,
                "cacheRead": 0.5, "cacheWrite": 6.25
              }
            }
          ]
        }
      }
    ]
  }
}
```

### `data` fields

| Field | Required | Description |
|---|---|---|
| `baseUrl` | yes | API root URL |
| `api` | yes | wire protocol: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, `mistral-conversations` |
| `apiKey` | no | literal key, `$ENV_VAR` / `${ENV_VAR}` reference, or `!command` |
| `name` | no | display name |
| `headers` / `authHeader` | no | extra request headers / whether to send `Authorization: Bearer` |
| `models` | no* | model definitions (see below); without it the provider has no models |

### `models[]` entry fields

| Field | Description |
|---|---|
| `id` / `name` | model ID and display name |
| `api` | per-model protocol override |
| `reasoning` | whether the model supports extended thinking |
| `input` | `["text"]` or `["text", "image"]` |
| `contextWindow` / `maxTokens` | token limits |
| `cost` | per-million-token USD: `{ input, output, cacheRead, cacheWrite, tiers? }` |
| `thinkingLevelMap` | maps Pi thinking levels to provider-specific values (`null` marks a level unsupported) |
| `compat` | provider compatibility flags (`supportsStrictMode`, etc.) |

### Where does the model info come from?

- The model **id list** is usually available from the gateway's
  `GET /v1/models`, authenticated with the account's key. For aggregation
  gateways (e.g. New-API based hubs) this list is **per-token**: different
  accounts may see different models, so the snapshot belongs to the account.
- **Pricing** is sometimes exposed — New-API style hubs provide
  `GET /api/pricing` with `model_ratio` / `completion_ratio` /
  `cache_ratio` / `create_cache_ratio`, from which the `cost` values can be
  derived (and they may change over time).
- `contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, `compat` are
  rarely exposed by the API and usually have to be filled in from the vendor's
  docs. Treat the snapshot as best-effort: gateways adjust pricing and models
  without notice.

### Tips

- Already configured the provider in Pi's `models.json`? Copy that provider
  entry verbatim as the account `data` — the shapes are identical.
- Use `$ENV_VAR` references for `apiKey` instead of plaintext keys.
- The account `id` is arbitrary (unique per provider); it only appears in the
  registered provider id `pi-switch:custom:<slug>:<account-id>`.

## Development

Local development is **flat TypeScript** — no build step. The entry point is
`index.ts` at the repository root; Pi's extension discovery loads it directly
via jiti (it only falls back to `./dist/index.js` when the compiled output
exists, so keep `dist/` absent during local work). Edit any `.ts` file and
run `/reload` in Pi to pick up changes.

To verify the packaged (npm) artifact locally:

```bash
npm ci
npm run build        # tsc → dist/ (compiled output is gitignored)
pi -e ./dist/index.js   # load the compiled artifact once
```

### Release

Publishing is handled by GitHub Actions (`.github/workflows/release.yml`): a
push of a `v*` tag runs `npm ci` → `tsc` → `npm publish`. The tarball ships
only `dist/` + README + LICENSE (`files` whitelist); runtime deps are the
`@earendil-works/pi-*` peers provided by Pi, `devDependencies` are
CI-only.

```bash
npm version patch   # bumps version in package.json
npm run build       # sanity check before tagging
git push --tags
```

> **Note on git installs:** `pi install git:...` clones the repo and runs
> `npm install --omit=dev`, so the compiled `dist/` must exist in the clone.
> Since `dist/` is gitignored (built only in CI), git installs will silently
> load nothing. Use `npm:` installs only.

## License

MIT
