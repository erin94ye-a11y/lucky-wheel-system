import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/server.js";

function startTestServer() {
  const workspace = mkdtempSync(join(tmpdir(), "lucky-wheel-"));
  const app = createApp({
    databasePath: join(workspace, "test.db"),
    uploadDir: join(workspace, "uploads"),
    sessionSecret: "test-secret",
    adminUser: "admin",
    adminPassword: "admin"
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";

  async function request(path, options = {}) {
    const headers = {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {})
    };
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    return { status: response.status, body };
  }

  return { request, close: () => server.close() };
}

test("admin creates a campaign and public users can draw with IP logging", async (t) => {
  const server = startTestServer();
  t.after(server.close);

  const denied = await server.request("/api/admin/campaigns");
  assert.equal(denied.status, 401);

  const login = await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.username, "admin");

  const created = await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "TEST2026",
      title: "Summer Draw",
      max_uses: 2,
      active: true,
      prizes: [
        { name: "Phone", probability: 100, stock: 1, image_url: "/uploads/phone.png" }
      ]
    })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.campaign.code, "TEST2026");
  assert.equal(created.body.prizes[0].name, "Phone");

  const publicView = await server.request("/api/public/campaigns/TEST2026");
  assert.equal(publicView.status, 200);
  assert.equal(publicView.body.campaign.title, "Summer Draw");
  assert.equal(publicView.body.prizes[0].name, "Phone");
  assert.equal(publicView.body.prizes[0].probability, undefined);

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.10"
    },
    body: JSON.stringify({ code: "TEST2026" })
  });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.prize.name, "Phone");

  const logs = await server.request("/api/admin/draws");
  assert.equal(logs.status, 200);
  assert.equal(logs.body.draws.length, 1);
  assert.equal(logs.body.draws[0].code, "TEST2026");
  assert.equal(logs.body.draws[0].prize_name, "Phone");
  assert.equal(logs.body.draws[0].forwarded_for, "203.0.113.10");
});

test("a one-use campaign still returns the winning draw response", async (t) => {
  const server = startTestServer();
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "ONCE2026",
      title: "One Use",
      max_uses: 1,
      active: true,
      prizes: [{ name: "Only Prize", probability: 100, stock: 1 }]
    })
  });

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "ONCE2026" })
  });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.prize.name, "Only Prize");
  assert.equal(draw.body.campaign.used_count, 1);
});

test("draw returns a friendly error when prize stock is exhausted", async (t) => {
  const server = startTestServer();
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "STOCK2026",
      title: "Stock Test",
      max_uses: 2,
      active: true,
      prizes: [{ name: "Limited", probability: 100, stock: 1 }]
    })
  });

  const first = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "STOCK2026" })
  });
  assert.equal(first.status, 200);

  const second = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "STOCK2026" })
  });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /奖品库存/);
});
