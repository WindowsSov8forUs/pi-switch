# pi-switch

Multi-account provider switching for [Pi](https://github.com/earendil-works/pi).

Manage multiple API keys / OAuth accounts per provider, and define custom
(additional) providers with per-account credentials — all through two commands:

- `/switch` — pick a saved account and register it as a Pi provider
- `/switch models` — manage accounts: add (via Pi's native login flow),
  edit name/notes, delete, and add custom providers

## Install

```bash
pi install npm:pi-switch          # once published
pi install git:github.com/<you>/pi-switch   # from git
pi install /path/to/pi-switch     # local path
```

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
                           ├─ + Add provider...  (define baseUrl/api/models,
                           │     login for first key)
                           ├─ + Add account...   (login for another key,
                           │     reuses provider definition)
                           └─ existing account → Edit / Delete
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

## Development

```bash
npm install          # dev deps: typescript + pi-coding-agent
npm run build        # tsc → dist/
pi install /path/to/pi-switch   # local install for testing
```

## License

MIT
