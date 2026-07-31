# Independent Code Probabilities And Bulk Delete Design

## Goal

Each generated lottery code owns a fixed prize and probability snapshot. Creating or changing another code must not change an existing code's draw behavior. The admin generates one code at a time and can delete all generated codes with one confirmed action.

## Admin Workflow

The existing visual system and page structure remain in place.

### Prize Template

The existing global prize area becomes a reusable prize template. It continues to manage prize names, images, and stock defaults. Template changes affect only future code-generation forms and never rewrite existing code snapshots.

### Independent Code Generator

The generator always creates exactly one code. It contains:

- maximum uses;
- expiration time;
- active state;
- one probability input for every prize in the current template;
- a primary `生成独立代码` action.

The quantity input is removed. The form rejects generation unless at least one probability is greater than zero. On success, the current prize names, images, stock values, order, and probabilities are stored under the new campaign. The form remains populated so the administrator can adjust probabilities and generate the next code quickly.

### Generated Code List

Each code remains individually deletable. The list header adds a destructive `全部删除` button beside the code count. The button is disabled when no codes exist.

Selecting `全部删除` opens a confirmation that includes the current code count and states that the action cannot be undone. Confirmation deletes every campaign and its campaign-owned prizes and draw results in one transaction. Access records remain available because they are an independent operational log.

## Data Model And Migration

The existing `prizes` table is the source of truth for code-owned prize snapshots. No new per-code probability table is required.

During migration, every existing campaign with no rows in `prizes` receives a one-time copy of the current global prize template, including the current probability values. This prevents legacy generated codes from continuing to read live global probabilities after deployment.

The `global_prizes` table remains the reusable template only. It is never consulted when validating or drawing an existing code.

## API And Data Flow

1. The admin loads the reusable prize template.
2. The generator submits one code configuration with a complete prize snapshot.
3. The server validates and stores the campaign and its prize rows in one transaction.
4. Public code validation reads only that campaign's prize rows.
5. The draw endpoint selects a prize only from that campaign's rows and updates that campaign-owned prize inventory.
6. Public responses continue to omit probability values.

The existing public URL and code-entry interaction do not change. The entered code is the lookup key that selects the independent campaign configuration.

The bulk-delete endpoint requires an authenticated admin session and returns the number of deleted codes. The UI refreshes the generated-code list immediately after success.

## Error Handling

- Generation fails without changing the database when the template is empty.
- Generation fails when all submitted probabilities are zero.
- Generation fails when a probability or stock value is invalid.
- Bulk delete requires explicit confirmation in the UI.
- Bulk delete is transaction-based so a partial deletion cannot occur.
- A failed request leaves the visible list unchanged and shows an inline error message.

## Compatibility

- Existing public links and code entry remain unchanged.
- Existing access logs and XLSX export remain unchanged.
- Existing per-code delete remains available.
- Existing saved prize-template edits remain intact.
- Existing campaigns are migrated to independent snapshots once.

## Test Strategy

- Generate code A with prize A enabled and prize B disabled.
- Generate code B with the inverse probabilities.
- Verify both codes return their own prize lists and draw their own configured result.
- Change the global template and verify codes A and B do not change.
- Verify a legacy campaign without prize rows is backfilled exactly once.
- Verify public APIs never expose probabilities.
- Verify bulk delete requires admin authentication, deletes all campaigns atomically, cascades campaign prizes and draws, and preserves access records.
- Verify the bulk-delete button is disabled for an empty list and uses a count-aware confirmation.
- Run the complete API and lottery test suites.
