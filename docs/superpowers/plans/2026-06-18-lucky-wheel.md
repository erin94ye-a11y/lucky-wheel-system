# Lucky Wheel System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete lottery wheel system that can be deployed to Railway and managed from a browser admin panel.

**Architecture:** Express serves static HTML and JSON APIs. SQLite stores campaigns, prizes, and draw logs. The public page asks the server for validation and draw results so users cannot control the outcome from browser code.

**Tech Stack:** Node.js, Express, SQLite, HTML, CSS, vanilla JavaScript, Node test runner.

---

### Task 1: Core Lottery Rules

**Files:**
- Create: `package.json`
- Create: `src/lottery.js`
- Create: `test/lottery.test.js`

- [ ] Write tests for code generation, weighted selection, stock filtering, and validation.
- [ ] Run the tests and confirm they fail because the module is missing.
- [ ] Implement `src/lottery.js`.
- [ ] Run the tests and confirm they pass.

### Task 2: Database And API

**Files:**
- Create: `src/db.js`
- Create: `src/server.js`
- Create: `test/api.test.js`

- [ ] Write API tests for admin login, campaign creation, public code validation, draw creation, and draw log listing.
- [ ] Run the tests and confirm they fail because the server module is missing.
- [ ] Implement SQLite schema, session auth, campaign APIs, public APIs, image upload, and draw logging.
- [ ] Run the tests and confirm they pass.

### Task 3: HTML Frontend And Admin

**Files:**
- Create: `public/index.html`
- Create: `public/admin.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `public/admin.js`

- [ ] Build the public code-entry and wheel-draw page.
- [ ] Build the admin login, campaign editor, prize table, image upload controls, and draw logs.
- [ ] Verify both pages load from the Express server.

### Task 4: Deployment And Publishing

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `railway.json`

- [ ] Document local setup, Railway deployment, default admin credentials, and SQLite volume configuration.
- [ ] Run tests.
- [ ] Initialize git and commit the project.
- [ ] Upload to GitHub if a GitHub remote or creation path is available.
