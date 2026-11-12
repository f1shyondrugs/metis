# iCloud calendar collection management

The optional extension under `integrations/icloud-calendar/` wraps the existing icloud-calendar-mcp package without changing its eight event tools. Its CLI accepts the absolute package directory as its only argument. Credentials continue to arrive through the existing protected MCP environment; never put their values into CLI arguments or copy them into helper scripts.

Additional tools:

- `get_calendar_properties`: names, IDs, writable flags and Apple's calendar color.
- `create_calendar`: name, hexadecimal RGBA color and stable request ID. Creates a VEVENT calendar with MKCALENDAR, escapes XML, serializes duplicate requests, and verifies the returned collection and color. Existing names are not overwritten.
- `move_event`: source href, expected UID/ETag, destination calendar ID and stable request ID. Sends an atomic DAV MOVE with If-Match and Overwrite:F. Source and destination must both be listed writable calendars on the same origin.

Moves retain the original resource rather than reconstructing it through create/delete. Verification compares the complete original and destination iCalendar data (normalizing only CRLF) and proves that the source no longer exists. UID, alarms, recurrence, description and other properties are retained. An ambiguous mutation response is reconciled by reading both locations, not by dispatching another mutation. Verification failures stop; the connector never deletes a source to resolve a collision.

Management mutation receipts use a separate Journal subdirectory to avoid replacing the original event request journal. Existing event handles and normal event functionality remain available. As with the upstream journal, concurrent independent gateway processes should not mutate the same connection simultaneously.

## Activation

Stage the two JavaScript modules in an immutable extension directory. Update only the existing account-owned MCP entry's public command/arguments through `upsert_mcp_server`, omitting env values so the protected gateway preserves and rebinds them internally. The new configuration revision opens a new child; existing in-flight calls are not terminated. Refresh the child catalog and inspect the three new schemas before use. Do not restart the app, worker, gateway or protected login service for this extension.

Run:

```sh
node --test tests/icloud-calendar-management.test.mjs
node --check integrations/icloud-calendar/cli.mjs
node scripts/check-icloud-extension.mjs /absolute/path/to/icloud-calendar-mcp
```

The last check uses synthetic credentials, isolated state and deliberately disabled network. It proves a real stdio MCP handshake, preservation of existing tools and safe error transport. Unit regressions run in `pnpm test:mcp-vault`.

No full Next build is needed: this extension is an independently loaded plain JavaScript child server and is not part of the app bundle.
