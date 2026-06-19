import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

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
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
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

  return { request, baseUrl, close: () => server.close() };
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
  assert.doesNotMatch(page.body, /[\u3400-\u9fff]/);
  assert.doesNotMatch(page.body, /topbar-cta/);
  assert.doesNotMatch(page.body, /CryptoReward/);
  assert.match(page.body, /JUMP QUANTUM™/);
  assert.match(page.body, /INVESTOR REWARDS EVENT/);
  assert.match(page.body, /brand-jump/);
  assert.match(page.body, /brand-quantum/);
  assert.match(page.body, /brand-divider/);
  assert.doesNotMatch(page.body, /\/assets\/jump-quantum-logo\.png/);

  const script = await server.request("/app.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(script.status, 200);
  assert.doesNotMatch(script.body, /[\u3400-\u9fff]/);
  assert.match(script.body, /--label-width/);
  assert.match(script.body, /--label-track-offset/);
  assert.match(script.body, /--label-track-height/);
  assert.match(script.body, /getWheelLabelLines/);
  assert.match(script.body, /getWheelLayout/);
  assert.match(script.body, /getWheelLabelMetrics/);
  assert.match(script.body, /getSpinRotation/);
  assert.match(script.body, /--label-rotation/);
  assert.match(script.body, /--label-track-width/);
  assert.doesNotMatch(script.body, /getWheelSegments/);
  assert.doesNotMatch(script.body, /getPrizeWeight/);
  assert.match(script.body, /const slice = 360 \/ prizes\.length/);

  const styles = await server.request("/styles.css", {
    headers: { accept: "text/css" }
  });
  assert.equal(styles.status, 200);
  assert.match(styles.body, /rotate\(var\(--label-rotation\)\)/);
  assert.match(styles.body, /translateX\(var\(--label-track-offset\)\)/);
  assert.match(styles.body, /width:\s*var\(--label-track-width\)/);
  assert.match(styles.body, /--label-text-rotation/);
  assert.match(styles.body, /width:\s*var\(--label-width\)/);
  assert.match(styles.body, /\.wheel-label-line/);
  assert.doesNotMatch(styles.body, /\.wheel\.is-crowded \.wheel-label img\s*{[^}]*display:\s*none/s);
  assert.match(styles.body, /\.wheel\.is-crowded \.wheel-label img\s*{[^}]*height:\s*26px/s);
  assert.match(styles.body, /\.public-page \.topbar\s*{[^}]*flex-direction:\s*column/s);
  assert.match(styles.body, /\.public-page \.topbar\s*{[^}]*align-items:\s*flex-start/s);
  assert.match(styles.body, /\.event-title\s*{[^}]*text-align:\s*left/s);
  assert.match(styles.body, /\.brand-jump\s*{[^}]*color:\s*#[a-fA-F0-9]{6}/s);
  assert.match(styles.body, /\.brand-quantum\s*{[^}]*color:\s*#[a-fA-F0-9]{6}/s);
  assert.match(styles.body, /body\.public-page\s*{[^}]*--topbar-offset:\s*clamp\(118px,\s*31\.2vw,\s*229px\)/s);
  assert.match(styles.body, /body\.public-page\s*{[^}]*padding-top:\s*var\(--topbar-offset\)/s);
  assert.match(styles.body, /\.public-page \.topbar\s*{[^}]*position:\s*fixed/s);
  assert.match(styles.body, /--brand-jump-size:\s*clamp\(24px,\s*7\.68vw,\s*51px\)/);
  assert.match(styles.body, /--brand-quantum-size:\s*clamp\(14px,\s*4\.22vw,\s*28px\)/);
  assert.match(styles.body, /--event-title-size:\s*clamp\(16px,\s*4\.99vw,\s*34px\)/);
  assert.match(styles.body, /\.brand-name\s*{[^}]*flex-direction:\s*column/s);
  assert.match(styles.body, /\.brand-quantum\s*{[^}]*font-size:\s*var\(--brand-quantum-size\)/s);
  assert.match(styles.body, /\.brand-divider\s*{[^}]*linear-gradient\(90deg,\s*#ff2d55,\s*#ffd35a\)/s);
  assert.match(styles.body, /\.event-title\s*{[^}]*font-size:\s*var\(--event-title-size\)/s);

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

test("public page keeps the code entry flow and removes the unused reward intro", async (t) => {
  const server = startTestServer({ mode: "public" });
  t.after(server.close);

  const page = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(page.status, 200);
  assert.match(page.body, /JUMP QUANTUM™/);
  assert.match(page.body, /INVESTOR REWARDS EVENT/);
  assert.match(page.body, /brand-divider/);
  assert.match(page.body, /Enter your code/);
  assert.match(page.body, /Prize Wheel/);
  assert.doesNotMatch(page.body, /reward-kicker/);
  assert.doesNotMatch(page.body, /stats-strip/);
  assert.doesNotMatch(page.body, /ticket-preview/);
  assert.doesNotMatch(page.body, /累计天数/);
  assert.doesNotMatch(page.body, /本次奖品/);
  assert.doesNotMatch(page.body, /winnerFeed/);
  assert.doesNotMatch(page.body, /中奖动态/);
  assert.doesNotMatch(page.body, /中奖播报/);

  const script = await server.request("/app.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(script.status, 200);
  assert.doesNotMatch(script.body, /renderWinnerFeed/);
  assert.doesNotMatch(script.body, /winner-code/);
  assert.doesNotMatch(script.body, /winner-prize/);
  assert.doesNotMatch(script.body, /winner-time/);
  assert.doesNotMatch(script.body, /campaignTitle\.textContent = campaign\.title/);
});

test("admin bulk code UI omits batch title and includes code deletion", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.doesNotMatch(adminPage.body, /批次名称/);
  assert.doesNotMatch(adminPage.body, /codeTitleInput/);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.doesNotMatch(adminScript.body, /codeTitleInput/);
  assert.match(adminScript.body, /deleteCampaign/);
  assert.match(adminScript.body, /method: "DELETE"/);
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
  assert.equal(publicView.body.campaign.title, undefined);
  assert.deepEqual(
    publicView.body.prizes.map((prize) => prize.name),
    ["Grand Prize", "Gift Card"]
  );
  assert.ok(publicView.body.prizes.every((prize) => prize.probability === undefined));

  const prizePreview = await server.request("/api/public/prizes");
  assert.equal(prizePreview.status, 200);
  assert.equal(prizePreview.body.prizes.length, 2);
  assert.ok(prizePreview.body.prizes.every((prize) => prize.probability === undefined));

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const draw = await server.request("/api/public/draw", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    assert.equal(draw.status, 200);
    assert.equal(draw.body.prize.name, "Gift Card");
  } finally {
    Math.random = originalRandom;
  }
});

test("admin upload creates wheel-sized images and public APIs normalize upload URLs", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const sourceImage = await sharp({
    create: {
      width: 240,
      height: 120,
      channels: 4,
      background: { r: 226, g: 61, b: 87, alpha: 1 }
    }
  })
    .png()
    .toBuffer();
  const formData = new FormData();
  formData.append("image", new Blob([sourceImage], { type: "image/png" }), "wide-prize.png");

  const upload = await server.request("/api/admin/upload", {
    method: "POST",
    body: formData
  });
  assert.equal(upload.status, 200);
  assert.match(upload.body.image_url, /^\/uploads\/.+\.webp$/);

  const uploadedAsset = await fetch(`${server.baseUrl}${upload.body.image_url}`);
  assert.equal(uploadedAsset.status, 200);
  assert.equal(uploadedAsset.headers.get("content-type"), "image/webp");
  const assetMetadata = await sharp(Buffer.from(await uploadedAsset.arrayBuffer())).metadata();
  assert.equal(assetMetadata.width, 96);
  assert.equal(assetMetadata.height, 96);
  assert.equal(assetMetadata.format, "webp");

  const savedPrizes = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        {
          name: "Uploaded Prize",
          probability: 100,
          stock: null,
          image_url: `${server.baseUrl.replace(/:\d+$/, ":3001")}${upload.body.image_url}`
        }
      ]
    })
  });
  assert.equal(savedPrizes.status, 200);

  const publicPreview = await server.request("/api/public/prizes");
  assert.equal(publicPreview.status, 200);
  assert.equal(publicPreview.body.prizes[0].image_url, upload.body.image_url);

  const generated = await server.request("/api/admin/codes/bulk", {
    method: "POST",
    body: JSON.stringify({
      quantity: 1,
      max_uses: 1,
      active: true
    })
  });
  assert.equal(generated.status, 201);

  const code = generated.body.campaigns[0].code;
  const publicCampaign = await server.request(`/api/public/campaigns/${code}`);
  assert.equal(publicCampaign.status, 200);
  assert.equal(publicCampaign.body.prizes[0].image_url, upload.body.image_url);
  assert.equal(publicCampaign.body.prizes[0].available, null);

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code })
  });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.prize.image_url, upload.body.image_url);
  assert.equal(draw.body.campaign.prizes[0].image_url, upload.body.image_url);
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
  assert.equal(publicView.body.campaign.title, undefined);
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

test("admin can delete a generated lottery code", async (t) => {
  const server = startTestServer();
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const generated = await server.request("/api/admin/codes/bulk", {
    method: "POST",
    body: JSON.stringify({
      quantity: 1,
      max_uses: 1,
      active: true
    })
  });
  assert.equal(generated.status, 201);
  const campaign = generated.body.campaigns[0];

  const deleted = await server.request(`/api/admin/campaigns/${campaign.id}`, {
    method: "DELETE"
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted.id, campaign.id);

  const campaigns = await server.request("/api/admin/campaigns");
  assert.equal(campaigns.status, 200);
  assert.equal(campaigns.body.campaigns.some((item) => item.id === campaign.id), false);

  const publicView = await server.request(`/api/public/campaigns/${campaign.code}`);
  assert.equal(publicView.status, 404);
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
  assert.match(second.body.error, /inventory/i);
});
