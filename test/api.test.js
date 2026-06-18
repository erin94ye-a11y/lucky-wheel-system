import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/server.js";

function startTestServer(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), "lucky-wheel-"));
  const app = createApp({
    databasePath: join(workspace, "test.db"),
    uploadDir: join(workspace, "uploads"),
    sessionSecret: "test-secret",
    adminUser: "admin",
    adminPassword: "admin",
    mode: options.mode ?? "all"
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
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }

  return { request, close: () => server.close() };
}

test("public mode does not expose admin login page or admin APIs", async (t) => {
  const server = startTestServer({ mode: "public" });
  t.after(server.close);

  const adminPage = await server.request("/admin.html", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 404);

  const adminApi = await server.request("/api/admin/me");
  assert.equal(adminApi.status, 404);
});

test("public H5 page hides the privacy note and ships nine fallback prize categories", async (t) => {
  const server = startTestServer({ mode: "public" });
  t.after(server.close);

  const page = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /参与抽奖会记录服务器可见 IP/);

  const script = await server.request("/app.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(script.status, 200);
  const fallbackPrizeNames = [
    "Grand Prize",
    "$100 Gift Card",
    "Bluetooth Speaker",
    "Coffee Voucher",
    "VIP Upgrade",
    "Movie Tickets",
    "Merch Bundle",
    "Bonus Entry",
    "Try Again"
  ];
  const defaultPrizePoolSource = script.body.slice(script.body.indexOf("function defaultPrizePool"));
  assert.equal(
    fallbackPrizeNames.filter((name) => defaultPrizePoolSource.includes(`name: "${name}"`)).length,
    9
  );
});

test("public page uses the reward style and replaces prize list with a winner carousel", async (t) => {
  const server = startTestServer({ mode: "public" });
  t.after(server.close);

  const page = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(page.status, 200);
  assert.match(page.body, /CryptoReward/);
  assert.match(page.body, /winnerFeed/);
  assert.match(page.body, /中奖动态/);
  assert.doesNotMatch(page.body, /本次奖品/);

  const script = await server.request("/app.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(script.status, 200);
  assert.match(script.body, /renderWinnerFeed/);
  assert.match(script.body, /winner-code/);
  assert.match(script.body, /winner-prize/);
  assert.match(script.body, /winner-time/);
});

test("admin mode serves the login page separately and hides public APIs", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.body, /后台登录/);
  assert.doesNotMatch(adminPage.body, /前台/);

  const publicApi = await server.request("/api/public/campaigns/TEST2026");
  assert.equal(publicApi.status, 404);
});

test("admin can generate an unused lottery code", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const denied = await server.request("/api/admin/codes/generate");
  assert.equal(denied.status, 401);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "ABCDEFGH",
      title: "Existing Code",
      max_uses: 1,
      active: true,
      prizes: [{ name: "Prize", probability: 100, stock: 1 }]
    })
  });

  const generated = await server.request("/api/admin/codes/generate");
  assert.equal(generated.status, 200);
  assert.match(generated.body.code, /^[A-Z0-9]{8}$/);
  assert.notEqual(generated.body.code, "ABCDEFGH");
});

test("admin manages one global prize pool and bulk-generates reusable codes", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const savedPrizes = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Grand Prize", probability: 25, stock: 2, image_url: "" },
        { name: "Gift Card", probability: 75, stock: null, image_url: "" }
      ]
    })
  });
  assert.equal(savedPrizes.status, 200);
  assert.equal(savedPrizes.body.prizes.length, 2);

  const generated = await server.request("/api/admin/codes/bulk", {
    method: "POST",
    body: JSON.stringify({
      title: "Launch Giveaway",
      quantity: 3,
      max_uses: 1,
      active: true
    })
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.campaigns.length, 3);
  assert.equal(new Set(generated.body.campaigns.map((campaign) => campaign.code)).size, 3);

  const code = generated.body.campaigns[0].code;
  const publicView = await server.request(`/api/public/campaigns/${code}`);
  assert.equal(publicView.status, 200);
  assert.deepEqual(
    publicView.body.prizes.map((prize) => prize.name),
    ["Grand Prize", "Gift Card"]
  );

  const prizePreview = await server.request("/api/public/prizes");
  assert.equal(prizePreview.status, 200);
  assert.equal(prizePreview.body.prizes.length, 2);
  assert.equal(prizePreview.body.prizes[0].probability, undefined);

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code })
  });
  assert.equal(draw.status, 200);
  assert.match(draw.body.prize.name, /Grand Prize|Gift Card/);
});

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
