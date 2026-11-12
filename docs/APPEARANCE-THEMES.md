# Appearance themes

Metis includes Midnight (default), Graphite, Nord, Forest, Sand, and Paper. The retired pure-black-and-white Metis preset is no longer offered; existing selections resolve to Midnight without deleting custom themes or overwriting other saved choices. Custom themes use a portable JSON file. Start with **Export JSON** in Appearance settings to get the current design variables, edit the file, then import it or paste its contents into the JSON editor.

Theme selection and custom themes are saved to the signed-in account, shared across devices, and loaded before the first paint. The browser refreshes them on focus and every 30 seconds while visible. Changes become active after the server confirms the save; failed saves preserve the previous theme and the open editor draft. Revision checks reject stale changes from another tab/device and requests made after switching accounts.

Remote desktop clients from v1.4.13 receive only their paired account's selected theme through the authenticated device heartbeat. The hub and Computer Use overlay update within 20 seconds while connected, including custom-variable aliases and light/dark mode. Unchanged revisions are omitted, older clients keep their existing heartbeat contract, and invalid theme data does not interrupt device control.

Existing browser-local themes are migrated once into the first signed-in account on that browser. When account preferences already exist, their selection is preserved and distinct local themes are merged. Imported IDs/content are deduplicated; local data is removed only after a confirmed account save. Migration errors preserve local data and do not block normal account edits. Browser storage is optional for account persistence. The public static demo keeps its own local-only settings.

The authenticated `/api/appearance` endpoint stores the full theme collection in the existing account-scoped settings table. GET returns `{ ownerId, state, revision }`; PATCH requires the same owner/revision preconditions and a validated state. Maximum collection size is 20 custom themes and 512 KiB. Responses are private and not cached.

```json
{
  "format": "metis-theme",
  "version": 1,
  "name": "Warm desk",
  "mode": "light",
  "variables": {
    "--background": "#f5f1e8",
    "--foreground": "#302b24",
    "--primary": "#685139",
    "--primary-foreground": "#fffdf8",
    "--sidebar": "#ece5d8",
    "--spacing": "0.25rem",
    "--radius": "0.5rem",
    "--font-sans": "system-ui, sans-serif",
    "--text-sm": "0.9rem",
    "--shadow-md": "0 4px 12px rgb(0 0 0 / 15%)"
  }
}
```

`mode` selects light or dark component behavior and supplies defaults for omitted variables. An export includes the resolved defaults and overrides, so it can be imported without its original preset. Color aliases such as `--color-background: var(--background)` and radius expressions remain linked to their base variables.

Any valid CSS custom-property name is accepted, including additional Tailwind palette, type, spacing, radius, shadow, animation, and project-specific tokens. For example, `--color-blue-500`, `--text-base--line-height`, `--font-weight-medium`, and `--radius-md` can be supplied independently. Names are case-sensitive. Values must be CSS strings; numbers require quotes in JSON. Fonts use installed system fonts or fonts already loaded by Metis.

Variables apply to the application root design system. They change styles that consume or inherit those variables. Component-private variables defined on a child element and fixed CSS values keep their component's behavior; adding a new variable does not create a new styling hook.

The import limit is 256 KiB, with at most 2,048 variables and 4,096 characters per value. Metis rejects malformed JSON, unsupported format versions, empty names, CSS rules/declarations, `!important`, resource URLs/functions, scripts, and comments. Color functions, `var()`, `calc()`, font lists, shadows, and gradients are supported. The browser decides whether a consuming CSS property accepts a particular value.

[The JSON schema](./appearance-theme.schema.json) documents the file structure for editors. Runtime validation also checks the CSS value restrictions above.
