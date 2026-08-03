# pi-switch

Multi-account provider switching for [Pi](https://github.com/earendil-works/pi).

Manage multiple API keys / OAuth accounts per provider, and define custom
(additional) providers with per-account credentials — all through `/switch`
with subcommands:

- `/switch` — make a saved account active on its original Pi provider ID
- `/switch models` — manage accounts: add (via Pi's native login flow),
  edit name/notes, delete; custom provider accounts are configured manually
  (see [Custom provider accounts](#custom-provider-accounts) below)
- `/switch reload` — import accounts from Pi's existing `auth.json`
  (api_key / oauth credentials) and `models.json` (custom providers, as
  `custom:<id>`) into `pi-switch.json`; skips accounts whose `data`
  deep-equals an existing account (dedup), auto-generates `id`, sets
  `name` = provider id, `notes` = ""

## Install

Install a pinned GitHub Release:

```bash
pi install git:github.com/WindowsSov8forUs/pi-switch@v0.1.0
```

To try it without changing Pi settings:

```bash
pi -e git:github.com/WindowsSov8forUs/pi-switch@v0.1.0
```

A tag pins the installed version. After a new release, run `pi install` again
with the new tag. An unpinned default-branch install can instead be updated
with `pi update --extensions`, but is less reproducible.

## Usage

### `/switch`

```
Select provider type
  ├─ Built-in Provider  →  provider list (only those with saved accounts)
  │                       →  account list → switch native credential
  └─ Additional Provider →  custom provider list
                           →  account list → apply config to original provider
```

`/switch` changes the account behind the **original provider ID**; it does not
create `pi-switch:*` providers:

- Built-in providers: the selected credential replaces that provider's active
  credential in Pi's native runtime and `auth.json` (for example,
  `openai-codex` remains `openai-codex`).
- Additional providers: the selected provider snapshot is applied to its
  original ID in `models.json` (`custom:my-llm` switches `my-llm`).
- The current model selection is not changed. If it already belongs to the
  switched provider, its next request uses the selected account.

The active account is marked `(active)` in account selectors. Codex OAuth is
refreshed before an account becomes active, and rotated OAuth tokens are saved
back to that account immediately. Later token refreshes are synchronized when
switching away or when the session shuts down.

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

### `/switch reload`

Import accounts from Pi's existing configuration into `pi-switch.json` — an
idempotent one-shot migration instead of re-typing credentials:

| Source | Imported as | Condition |
|---|---|---|
| `auth.json` | provider id (e.g. `anthropic`) | credential shaped as `{ type: "api_key" \| "oauth", ... }` |
| `models.json` | `custom:<provider-id>` | entry has both `baseUrl` and `models` |

```
/switch reload
→ Imported 3 account(s), skipped 1 duplicate(s).
```

Rules:

- `id` is auto-generated (`slugify(name)-<timestamp36>`); `name` = provider
  id; `notes` = `""`.
- `data` is copied verbatim from the source file.
- **Dedup:** an account whose `data` deep-equals an existing account's `data`
  is skipped (counted in the notification).
- `models.json` entries without both `baseUrl` and `models` (e.g. pure
  built-in overrides) are skipped; non-`api_key`/`oauth` `auth.json` entries
  are skipped.

Because it dedups on `data` equality, re-running it is a no-op after the
first import.

## Data

Accounts are stored in `~/.pi/agent/pi-switch.json`:

```json
{
  "version": 1,
  "active": {
    "anthropic": "work-lz8abc",
    "custom:my-llm": "main-lz9def"
  },
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
- `active` maps each provider key to the account currently applied to Pi's
  native `auth.json` or `models.json`. It is managed by `/switch`.

## Custom provider accounts

Custom (`custom:<slug>`) providers are **configured by editing**
`~/.pi/agent/pi-switch.json` directly. There is no TUI flow to add them:
third-party gateways (OpenAI-compatible relays, New-API style hubs, etc.)
differ too much in what they expose for an interactive form to cover
reliably.

The account `data` field is the **same shape as a Pi provider configuration**
(`ProviderConfig` — identical to an entry in Pi's `models.json`), so anything
you can configure in `models.json` can be stored here and applied to the
original provider ID with `/switch`.

```json
{
  "version": 1,
  "active": {},
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

- Already configured providers in Pi's `models.json` / `auth.json`? Run
  `/switch reload` to import them into `pi-switch.json` instead of copying
  entries by hand — the shapes are identical.
- Use `$ENV_VAR` references for `apiKey` instead of plaintext keys.
- The account `id` is arbitrary (unique per provider); it is used by the
  `active` map and is never exposed as a Pi provider ID.

## Development

Local development is **flat TypeScript**. The entry point is `index.ts` at the
repository root, and Pi loads it directly through jiti. Edit any `.ts` file
and run `/reload` in Pi to pick up changes.

```bash
npm ci
npm run build       # Type-check and optionally emit ignored dist/ output
pi -e ./index.ts
```

### Release

`.github/workflows/release.yml` validates an existing GitHub Release after it is published:

1. Update `version` in `package.json` and commit it to the default branch.
2. Create and publish a `v<version>` GitHub Release for that commit.
3. The `release.published` event checks out the Release tag, runs `npm ci` and
   `npm run build`, and validates the tag against `package.json`.
4. After validation, CI adds the exact pinned `pi install` command to the
   existing Release notes and job summary. It does not create a tag or Release.

Pi clones the selected tag, installs production dependencies, and loads
`index.ts` from `package.json`'s `pi.extensions`; no compiled Release asset is
required.

## License

MIT
