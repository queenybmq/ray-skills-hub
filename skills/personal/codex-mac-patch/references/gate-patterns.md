# Gate Patterns Reference

Each gate is a behavioral check in a minified JS file under `webview/assets/` in the Electron asar. File hash suffixes change per Codex version, so gates are located by content pattern, not filename.

## Gate catalog

### fastmode-request
- **File**: `read-service-tier-for-request-*.js`
- **Intent**: API request handler — wraps the `fast_mode` feature check behind `authMethod==='chatgpt'`
- **Marker**: `featureRequirements?.fast_mode`
- **Behavior**: When `authMethod` is not `chatgpt`, returns `false` regardless of actual fast_mode status
- **Bypass**: Remove the `chatgpt` ternary wrapper; let the check pass through based on the actual `fast_mode` value
- **Example (v26.602)**:
  - find: `n===\`chatgpt\`?(await e.query.fetch(c,{authMethod:n,hostId:t})).requirements?.featureRequirements?.fast_mode!==!1:!1`
  - replace: `(await e.query.fetch(c,{authMethod:n,hostId:t})).requirements?.featureRequirements?.fast_mode!==!1`

### fastmode-ui
- **File**: `use-service-tier-settings-*.js`
- **Intent**: Settings UI — controls whether Fast Mode toggle appears
- **Marker**: `isServiceTierAllowed`
- **Behavior**: `isServiceTierAllowed = authMethod==='chatgpt' && !maintenance && ...` — hides toggle for non-chatgpt users
- **Bypass**: Remove the `authMethod` check from the conjunction; keep maintenance check
- **Example (v26.602)**:
  - find: `f=a&&!u&&c!=null&&c?.requirements?.featureRequirements?.fast_mode!==!1`
  - replace: `f=!u&&c?.requirements?.featureRequirements?.fast_mode!==!1`

### computer-use-gate
- **File**: `use-is-plugins-enabled-*.js`
- **Intent**: Central plugin availability resolver — gates Computer Use, browser, and external browser on Statsig feature flags and platform checks
- **Marker**: `statsig-disabled`
- **Behavior**: Returns one of: `loading`, `available`, `config-requirement-disabled`, `unsupported-platform`, `statsig-disabled`, `window-type-disabled`, `disabled`. The Statsig and config-requirement branches block non-chatgpt users.
- **Bypass**: Remove Statsig and config-requirement branches; keep `unsupported-platform` (legitimate) and `window-type-disabled` checks. `isHostCompatiblePlatform` already includes macOS — no platform bypass needed.
- **Statsig IDs** (for reference, do NOT patch the central statsig client):
  - `1506311413` — Computer Use
  - `410262010` — browser_use
  - `410065390` — browser_use_external
- **Example (v26.602)**:
  - find: `return e?o===\`electron\`?r?a?\`loading\`:i?n?\`loading\`:t?\`available\`:\`config-requirement-disabled\`:\`unsupported-platform\`:\`statsig-disabled\`:\`window-type-disabled\`:\`disabled\``
  - replace: `return e?o===\`electron\`?a?\`loading\`:i?\`available\`:\`unsupported-platform\`:\`window-type-disabled\`:\`disabled\``

### plugins-authblocked
- **File**: `plugins-page-*.js`
- **Intent**: Plugins page — the authBlocked state prevents access
- **Marker**: `fi=_e(di)` (the variable `fi` holds the authBlocked boolean)
- **Behavior**: `fi = _e(di)` evaluates auth state; when true, page shows "auth required"
- **Bypass**: Force `fi = false`
- **Example (v26.602)**:
  - find: `fi=_e(di)`
  - replace: `fi=!1`

### mobile-login-loop
- **File**: `codex-mobile-setup-flow-*.js`
- **Intent**: Mobile remote control setup — forces redirect to `/login` when not authenticated
- **Marker**: `codex-mobile-setup-flow`
- **Behavior**: `J && f(\`/login\`, {replace: true})` — redirects to login, creating an infinite loop for non-chatgpt auth
- **Bypass**: Replace with `false` to skip the redirect
- **Example (v26.602)**:
  - find: `J&&f(\`/login\`,{replace:!0})`
  - replace: `!1`

### locale-i18n
- **File**: `app-main-*.js`
- **Intent**: Internationalization feature flag
- **Marker**: `enable_i18n`
- **Behavior**: `s = a?.get('enable_i18n', false)` — disables i18n by default
- **Bypass**: Force `s = true`
- **Example (v26.602)**:
  - find: `s=a?.get(\`enable_i18n\`,!1)`
  - replace: `s=!0`

## Troubleshooting

### Pattern mismatch after update
The minifier may change variable names or expression structure. To re-analyze:
1. Extract the file from the asar
2. Search for the **marker** string (e.g., `featureRequirements?.fast_mode`, `statsig-disabled`)
3. Identify the gate logic around it — usually a ternary, conjunction, or function call
4. Craft a new `find`/`replace` that achieves the same bypass
5. Verify `find` appears **exactly once** in the file

### New gates in future versions
If a new feature is blocked, look for:
- `authMethod === 'chatgpt'` checks
- Statsig feature flag lookups (numeric IDs in `evaluateGate` or similar)
- `isServiceTierAllowed`, `isPluginsEnabled`, `authBlocked` patterns
Add the new gate to both `discover.mjs` GATES array and the PATCHES in repack.mjs.

### Statsig client
Do NOT patch the central `statsig-*.js` module — it would break all Statsig checks, including legitimate ones. Gate bypasses should be at the point of use, not at the SDK level.
