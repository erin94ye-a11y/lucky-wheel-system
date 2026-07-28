# Independent Code Probabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate exactly one lottery code at a time with an immutable campaign-owned prize/probability snapshot, and let an authenticated administrator delete all generated codes through one confirmed action.

**Architecture:** Keep `global_prizes` as the reusable admin template and use the existing `prizes` table as the source of truth for every generated campaign. The generator submits a complete prize snapshot, database migration backfills legacy campaigns that have no prize rows, and public validation/draw paths always read campaign-owned rows. A transaction-backed authenticated delete-all endpoint removes campaigns while preserving access records.

**Tech Stack:** Node.js 22, Express 4, better-sqlite3, vanilla HTML/CSS/JavaScript, Node test runner.

## Global Constraints

- Preserve the existing public URL and code-entry flow.
- Generate exactly one code per submit; remove the quantity control.
- Existing generated codes must stop following live global probability changes.
- Public API responses must never expose probability values.
- Preserve access records and XLSX export when all codes are deleted.
- Preserve the current uncommitted default-prize changes in `admin/admin.js` and `test/api.test.js`.
- Match the existing admin visual language; do not redesign unrelated panels.
- Do not upload or push to GitHub unless the user explicitly requests it.

---

### Task 1: Campaign-Owned Prize Snapshots

**Files:**
- Modify: `src/db.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `normalizePrizeInput(prizes)`, `listGlobalPrizes(db)`, existing `campaigns` and `prizes` tables.
- Produces: `generateIndependentCampaignCode(db, input) -> campaign`, `backfillCampaignPrizeSnapshots(db) -> number`, and `getCampaignByCode(db, code)` that reads only `prizes` rows owned by that campaign.

- [ ] **Step 1: Write failing snapshot-isolation tests**

Add an API test that saves a two-prize template, generates code A with `{A: 100, B: 0}`, generates code B with `{A: 0, B: 100}`, then verifies each public campaign returns its own ordered prize list and each draw returns the configured winner. After generation, replace the global template and verify both code responses and draw behavior remain unchanged.

```js
assert.equal(drawA.body.prize.name, "Prize A");
assert.equal(drawB.body.prize.name, "Prize B");
assert.deepEqual(viewA.body.prizes.map((prize) => prize.name), ["Prize A", "Prize B"]);
assert.ok(viewA.body.prizes.every((prize) => prize.probability === undefined));
```

- [ ] **Step 2: Run the isolation test and verify it fails**

Run:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes node@22 --test --test-name-pattern="generated codes keep independent prize probabilities" test/api.test.js
```

Expected: FAIL because `/api/admin/codes` or campaign-owned generation does not exist and `getCampaignByCode` still falls back to `global_prizes`.

- [ ] **Step 3: Implement independent generation and campaign-only lookup**

In `src/db.js`, add `generateIndependentCampaignCode(db, input)` that validates one complete `input.prizes` array, inserts one campaign, inserts every normalized prize row with its `campaign_id`, and returns `getCampaignById` inside one transaction.

Replace `listDrawablePrizesForCampaign` fallback behavior with campaign-only rows:

```js
function listDrawablePrizesForCampaign(db, campaignId) {
  return listPrizes(db, campaignId);
}
```

Add a migration helper that finds campaigns without prize rows and copies the current `global_prizes` rows exactly once. Invoke it after schema creation in `migrate(db)`.

- [ ] **Step 4: Run the isolation test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the database behavior**

```powershell
git add src/db.js test/api.test.js
git commit -m "feat: isolate prize probabilities by code"
```

---

### Task 2: Single-Code And Delete-All Admin APIs

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `generateIndependentCampaignCode(db, input)` from Task 1 and authenticated admin middleware.
- Produces: `POST /api/admin/codes` returning `{ campaign }`, `DELETE /api/admin/campaigns` returning `{ deleted_count }`, and `deleteAllCampaigns(db) -> number`.

- [ ] **Step 1: Write failing endpoint tests**

Add tests that verify:

```js
const generated = await server.request("/api/admin/codes", {
  method: "POST",
  body: JSON.stringify({
    max_uses: 1,
    active: true,
    prizes: [
      { name: "Prize A", probability: 100, stock: null, image_url: "" },
      { name: "Prize B", probability: 0, stock: null, image_url: "" }
    ]
  })
});
assert.equal(generated.status, 201);
assert.equal(generated.body.campaign.prizes[0].probability, 100);
```

Also test unauthenticated `DELETE /api/admin/campaigns` returns `401`, authenticated deletion returns the exact count, campaigns become unavailable, and a previously created coded visit remains in `/api/admin/visits`.

- [ ] **Step 2: Run endpoint tests and verify they fail**

Run:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes node@22 --test --test-name-pattern="single independent code|delete all generated codes" test/api.test.js
```

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement routes and transaction**

Add `deleteAllCampaigns(db)` in `src/db.js`:

```js
export function deleteAllCampaigns(db) {
  return db.transaction(() => db.prepare("DELETE FROM campaigns").run().changes)();
}
```

Import the new database functions in `src/server.js`. Add authenticated routes before the parameterized `/api/admin/campaigns/:id` route:

```js
app.post("/api/admin/codes", requireAdmin(sessionSecret), (request, response, next) => {
  try {
    response.status(201).json({ campaign: generateIndependentCampaignCode(db, request.body ?? {}) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/campaigns", requireAdmin(sessionSecret), (_request, response) => {
  response.json({ deleted_count: deleteAllCampaigns(db) });
});
```

Keep legacy endpoints only where existing tests or compatibility require them; the admin UI must use the new single-code endpoint.

- [ ] **Step 4: Run endpoint tests and verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the API behavior**

```powershell
git add src/server.js src/db.js test/api.test.js
git commit -m "feat: add independent code and delete-all APIs"
```

---

### Task 3: Independent Code Generator UI

**Files:**
- Modify: `admin/admin.html`
- Modify: `admin/admin.js`
- Modify: `public/styles.css`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `GET /api/admin/prizes`, `POST /api/admin/codes`, existing prize-row template data.
- Produces: one-code form payload `{ max_uses, expires_at, active, prizes }` and a probability editor sourced from the current prize template.

- [ ] **Step 1: Write failing admin markup/script tests**

Assert the admin page no longer contains `quantityInput`, contains `codeProbabilityRows`, uses the copy `生成独立代码`, and the script posts `prizes: readCodeProbabilityForm()` to `/api/admin/codes`.

```js
assert.doesNotMatch(adminPage.body, /id="quantityInput"/);
assert.match(adminPage.body, /id="codeProbabilityRows"/);
assert.match(adminPage.body, /生成独立代码/);
assert.match(adminScript.body, /api\("\/api\/admin\/codes"/);
```

- [ ] **Step 2: Run UI contract test and verify it fails**

Run:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes node@22 --test --test-name-pattern="independent code generator UI" test/api.test.js
```

Expected: FAIL because the current form still contains batch quantity and does not submit prizes.

- [ ] **Step 3: Implement the focused generator UI**

Remove the quantity field from `admin/admin.html`. Add a compact `code-probability-list` below the existing code settings. Each row displays the template prize name and one numeric input with `min="0"` and `step="0.01"`.

In `admin/admin.js`:

- render probability rows whenever the template loads;
- preserve unsaved probability input while background refresh runs;
- submit one complete snapshot to `/api/admin/codes`;
- reject an all-zero form before making the request;
- keep the values after generation so the next code is quick to configure;
- update the success state and generated-code list with the single returned campaign.

Add scoped styles in `public/styles.css` that reuse existing admin colors, borders, spacing, and responsive breakpoints. Keep prize names readable on H5-width admin screens and do not introduce a new visual theme.

- [ ] **Step 4: Run the UI contract test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the generator UI**

```powershell
git add admin/admin.html admin/admin.js public/styles.css test/api.test.js
git commit -m "feat: add per-code probability generator"
```

---

### Task 4: Delete-All Codes UI

**Files:**
- Modify: `admin/admin.html`
- Modify: `admin/admin.js`
- Modify: `public/styles.css`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `DELETE /api/admin/campaigns` and the current `campaigns` list.
- Produces: `deleteAllCodesButton`, count-aware confirmation, disabled empty state, inline success/error state.

- [ ] **Step 1: Write failing delete-all UI test**

Assert the header contains `deleteAllCodesButton` beside `codeCount`; the script disables it when `campaigns.length === 0`, confirms with the current count, calls `DELETE /api/admin/campaigns`, and refreshes the list only after success.

```js
assert.match(adminPage.body, /id="deleteAllCodesButton"/);
assert.match(adminScript.body, /DELETE/);
assert.match(adminScript.body, /campaigns\.length/);
assert.match(adminScript.body, /\/api\/admin\/campaigns/);
```

- [ ] **Step 2: Run the delete-all UI test and verify it fails**

Run:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes node@22 --test --test-name-pattern="delete all codes button" test/api.test.js
```

Expected: FAIL because the button and handler do not exist.

- [ ] **Step 3: Implement button, confirmation, and states**

Place a compact destructive button in the generated-code list panel title actions. Keep the existing count visible. Use native confirmation text that includes the count and clearly says the operation cannot be undone. On success, clear the generated preview, refresh campaigns, and show the returned deleted count. On failure, leave the list unchanged and display an error.

Style the action as a restrained red outline until hover/focus, with a minimum 44-pixel touch target on mobile. Preserve the individual delete buttons.

- [ ] **Step 4: Run the delete-all UI test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the delete-all UI**

```powershell
git add admin/admin.html admin/admin.js public/styles.css test/api.test.js
git commit -m "feat: add delete-all codes control"
```

---

### Task 5: Full Regression And Browser QA

**Files:**
- Modify only if verification finds a defect: `admin/admin.html`, `admin/admin.js`, `public/styles.css`, `src/db.js`, `src/server.js`, `test/api.test.js`

**Interfaces:**
- Consumes: all behavior from Tasks 1-4.
- Produces: verified desktop/mobile admin flow and passing complete test suite.

- [ ] **Step 1: Run the complete automated suite**

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes node@22 --test
```

Expected: all API and lottery tests PASS with zero failures.

- [ ] **Step 2: Start the local all-mode server**

```powershell
$env:APP_MODE='all'; $env:PORT='3000'; & 'C:\Program Files\nodejs\npx.cmd' --yes node@22 src/server.js
```

Expected: server listens on port 3000 and `/health` returns `{ "ok": true }`.

- [ ] **Step 3: Verify the admin workflow in the in-app browser**

At desktop and H5-width viewports:

- log in with the configured local admin credentials;
- confirm the quantity input is absent;
- configure one probability set and generate code A;
- configure the inverse set and generate code B;
- confirm both code cards remain visible and individually deletable;
- confirm `全部删除` is aligned beside the count, has a clear focus state, and is disabled after deletion;
- confirm no text overlaps and the probability list remains readable.

- [ ] **Step 4: Verify the public behavior**

Enter code A and code B separately. Confirm each wheel uses its own prize snapshot and the draw result matches its independent probability configuration.

- [ ] **Step 5: Inspect final diff and commit verification fixes**

```powershell
git diff --check
git status --short
```

If verification required changes, stage only files in this feature and commit:

```powershell
git add admin/admin.html admin/admin.js public/styles.css src/db.js src/server.js test/api.test.js
git commit -m "fix: complete independent code workflow"
```

