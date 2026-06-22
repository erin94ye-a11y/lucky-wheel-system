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
    if (options.raw) {
      return {
        status: response.status,
        body: Buffer.from(await response.arrayBuffer()),
        headers: response.headers
      };
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

test("site pages expose the Jump Quantum favicon in public and admin modes", async (t) => {
  const publicServer = startTestServer({ mode: "public" });
  t.after(publicServer.close);
  const adminServer = startTestServer({ mode: "admin" });
  t.after(adminServer.close);

  const publicPage = await publicServer.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.body, /<link rel="icon" type="image\/png" href="\/favicon\.png" \/>/);
  assert.match(publicPage.body, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);

  const adminPage = await adminServer.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.body, /<link rel="icon" type="image\/png" href="\/favicon\.png" \/>/);
  assert.match(adminPage.body, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);

  const publicIcon = await publicServer.request("/favicon.png");
  assert.equal(publicIcon.status, 200);
  const adminIcon = await adminServer.request("/favicon.png");
  assert.equal(adminIcon.status, 200);
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
  assert.match(page.body, /<img class="brand-logo-image" src="\/assets\/jump-quantum-banner\.png" alt="JUMP QUANTUM™" \/>/);
  assert.match(page.body, /INVESTOR REWARDS EVENT/);
  assert.match(page.body, /<p class="event-title" aria-label="INVESTOR REWARDS EVENT">INVESTOR REWARDS EVENT<\/p>/);
  assert.doesNotMatch(page.body, /brand-jump/);
  assert.doesNotMatch(page.body, /brand-quantum/);
  assert.doesNotMatch(page.body, /brand-name/);
  assert.match(page.body, /<section class="vision-panel" aria-labelledby="visionTitle">/);
  assert.match(page.body, /<h2 id="visionTitle">Our Vision<\/h2>/);
  assert.doesNotMatch(page.body, /<span>Investor Rewards Event<\/span>/);
  assert.match(page.body, /success should be shared/);
  assert.match(page.body, /appreciation, partnership, and long-term growth/);
  assert.ok(page.body.indexOf('id="resultPanel"') < page.body.indexOf('class="vision-panel"'));
  assert.match(page.body, /brand-divider/);
  assert.match(page.body, /\/assets\/jump-quantum-banner\.png/);

  const logo = await server.request("/assets/jump-quantum-banner.png", { raw: true });
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type") ?? "", /image\/png/);

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
  assert.match(script.body, /getWheelImageMetrics/);
  assert.match(script.body, /wheel-prize-image/);
  assert.match(script.body, /getSpinRotation/);
  assert.match(script.body, /--label-rotation/);
  assert.match(script.body, /--label-track-width/);
  assert.match(script.body, /collectVisitorInfo/);
  assert.match(script.body, /reportVisitor/);
  assert.match(script.body, /\/api\/public\/visits/);
  assert.match(script.body, /navigator\.language/);
  assert.match(script.body, /navigator\.userAgentData/);
  assert.doesNotMatch(script.body, /label\.append\(image\)/);
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
  assert.match(styles.body, /\.wheel-prize-image\s*{[^}]*height:\s*var\(--wheel-image-size\)/s);
  assert.match(styles.body, /\.wheel-prize-image\s*{[^}]*width:\s*var\(--wheel-image-size\)/s);
  assert.match(styles.body, /\.wheel-prize-image img\s*{[^}]*height:\s*100%/s);
  assert.match(styles.body, /\.wheel-prize-image img\s*{[^}]*object-fit:\s*cover/s);
  assert.doesNotMatch(styles.body, /\.wheel\.is-crowded \.wheel-label img/);
  assert.match(styles.body, /\.public-page \.topbar\s*{[^}]*position:\s*fixed/s);
  assert.match(styles.body, /\.brand-lockup\s*{[^}]*grid-template-columns:\s*auto auto minmax\(0,\s*auto\)/s);
  assert.match(styles.body, /\.brand-logo-image\s*{[^}]*height:\s*var\(--brand-logo-height\)/s);
  assert.match(styles.body, /\.brand-logo-image\s*{[^}]*object-fit:\s*contain/s);
  assert.match(styles.body, /\.event-title\s*{[^}]*text-align:\s*left/s);
  assert.match(styles.body, /\.event-title\s*{[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(styles.body, /\.brand-jump\s*{/);
  assert.doesNotMatch(styles.body, /\.brand-quantum\s*{/);
  assert.match(styles.body, /body\.public-page\s*{[^}]*--topbar-offset:\s*clamp\(64px,\s*13vw,\s*86px\)/s);
  assert.match(styles.body, /body\.public-page\s*{[^}]*padding-top:\s*var\(--topbar-offset\)/s);
  assert.match(styles.body, /--brand-logo-height:\s*clamp\(32px,\s*7vw,\s*50px\)/);
  assert.match(styles.body, /--event-title-size:\s*clamp\(11px,\s*2\.2vw,\s*16px\)/);
  assert.doesNotMatch(styles.body, /\.brand-name\s*{/);
  assert.match(styles.body, /\.brand-divider\s*{[^}]*linear-gradient\(90deg,\s*#ff2d55,\s*#ffd35a\)/s);
  assert.match(styles.body, /\.event-title\s*{[^}]*font-size:\s*var\(--event-title-size\)/s);
  assert.match(styles.body, /\.vision-panel\s*{[^}]*border-radius:\s*28px/s);
  assert.match(styles.body, /\.vision-panel\s*{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(styles.body, /\.vision-panel h2\s*{[^}]*font-size:\s*clamp\(26px,\s*7vw,\s*42px\)/s);
  assert.match(styles.body, /\.vision-copy\s*{[^}]*line-height:\s*1\.72/s);
  assert.doesNotMatch(styles.body, /\.vision-heading span\s*{/);

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
  assert.doesNotMatch(page.body, /[\u3400-\u9fff]/);
  assert.match(page.body, /<form id="codeForm" class="code-form" novalidate>/);
  const codeFormHtml = page.body.slice(page.body.indexOf('<form id="codeForm"'), page.body.indexOf("</form>"));
  assert.doesNotMatch(codeFormHtml, /\srequired\b/);
  assert.match(page.body, /brand-logo-image/);
  assert.match(page.body, /\/assets\/jump-quantum-banner\.png/);
  assert.match(page.body, /INVESTOR REWARDS EVENT/);
  assert.match(page.body, /brand-divider/);
  assert.match(page.body, /Enter your code/);
  assert.match(page.body, /Prize Wheel/);
  assert.match(page.body, /Our Vision/);
  assert.match(page.body, /The Investor Rewards Event was created to recognize and reward/);
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
  assert.match(script.body, /Please enter your code\./);
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
  assert.match(adminPage.body, /id="quantityInput"[^>]+value="1"/);
  assert.doesNotMatch(adminPage.body, /id="quantityInput"[^>]+value="20"/);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.doesNotMatch(adminScript.body, /codeTitleInput/);
  assert.match(adminScript.body, /deleteCampaign/);
  assert.match(adminScript.body, /method: "DELETE"/);
});

test("admin prize pool UI explains each prize field", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.body, /class="prize-guide"/);
  assert.match(adminPage.body, /奖品名称：转盘端显示的奖品文字/);
  assert.match(adminPage.body, /概率权重：数值越大越容易中奖，0 表示不会中奖/);
  assert.match(adminPage.body, /库存：留空表示不限量，填 0 表示不可抽中/);
  assert.match(adminPage.body, /图片：可填写图片地址或上传图片，保存后同步到转盘端/);
});

test("admin access log UI replaces draw logs and includes an xlsx export button", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.body, /访问记录/);
  assert.doesNotMatch(adminPage.body, /参与记录/);
  assert.match(adminPage.body, /id="exportVisitsButton"/);
  assert.match(adminPage.body, /导出XLSX/);
  for (const heading of ["时间", "代码", "IP地址", "设备型号", "设备类型", "系统", "使用语言"]) {
    assert.match(adminPage.body, new RegExp(heading));
  }
  assert.doesNotMatch(adminPage.body, /<th>奖品<\/th>/);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.match(adminScript.body, /exportVisitsButton/);
  assert.match(adminScript.body, /renderVisits/);
  assert.match(adminScript.body, /\/api\/admin\/visits\/export/);
  assert.doesNotMatch(adminScript.body, /renderDraws/);
});

test("admin default prize examples use investor rewards with blank stock", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  const defaultPrizeBlock = adminScript.body.slice(
    adminScript.body.indexOf("function defaultPrizes()"),
    adminScript.body.indexOf("function formatTime")
  );
  assert.deepEqual(
    [
      "$77 USDT",
      "#1 Ethereum",
      "Thanks for playing",
      "Apple Mac",
      "iPhone 17 Pro Max",
      "Thanks for playing",
      "20 shares of NVDA",
      "#1 oz gold",
      "Thanks for playing"
    ].map((name) => defaultPrizeBlock.includes(`name: "${name}"`)),
    Array(9).fill(true)
  );
  assert.equal((defaultPrizeBlock.match(/stock:\s*""/g) || []).length, 9);
  assert.doesNotMatch(defaultPrizeBlock, /stock:\s*[0-9]/);
});

test("admin prize settings stay synced across logged-in devices", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.match(adminScript.body, /ADMIN_SYNC_INTERVAL_MS\s*=\s*5000/);
  assert.match(adminScript.body, /startAdminSync/);
  assert.match(adminScript.body, /stopAdminSync/);
  assert.match(adminScript.body, /prizeListSignature/);
  assert.match(adminScript.body, /!prizeFormDirty/);
  assert.doesNotMatch(adminScript.body, /prizeResponse\.ok && !prizesLoaded/);
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

test("generated codes draw from the latest global prize probabilities", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const initialPrizes = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Old Probability Prize", probability: 100, stock: null, image_url: "" },
        { name: "Latest Probability Prize", probability: 0, stock: null, image_url: "" }
      ]
    })
  });
  assert.equal(initialPrizes.status, 200);

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

  const updatedPrizes = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Old Probability Prize", probability: 0, stock: null, image_url: "" },
        { name: "Latest Probability Prize", probability: 100, stock: null, image_url: "" }
      ]
    })
  });
  assert.equal(updatedPrizes.status, 200);

  const publicView = await server.request(`/api/public/campaigns/${code}`);
  assert.equal(publicView.status, 200);
  assert.deepEqual(
    publicView.body.prizes.map((prize) => prize.name),
    ["Old Probability Prize", "Latest Probability Prize"]
  );

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const draw = await server.request("/api/public/draw", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    assert.equal(draw.status, 200);
    assert.equal(draw.body.prize.name, "Latest Probability Prize");
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

  const prizeSubject = await sharp({
    create: {
      width: 80,
      height: 80,
      channels: 4,
      background: { r: 226, g: 61, b: 87, alpha: 1 }
    }
  })
    .png()
    .toBuffer();
  const sourceImage = await sharp({
    create: {
      width: 300,
      height: 300,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([{ input: prizeSubject, left: 110, top: 110 }])
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
  const assetBuffer = Buffer.from(await uploadedAsset.arrayBuffer());
  const assetMetadata = await sharp(assetBuffer).metadata();
  assert.equal(assetMetadata.width, 192);
  assert.equal(assetMetadata.height, 192);
  assert.equal(assetMetadata.format, "webp");
  const edgePixels = await sharp(assetBuffer)
    .ensureAlpha()
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(edgePixels[0] > 180);
  assert.ok(edgePixels[1] < 120);
  assert.ok(edgePixels[2] < 140);

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

test("admin sees visitor access records with code, IP, device, system, and language", async (t) => {
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

  const visit = await server.request("/api/public/visits", {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      "accept-language": "en-US,en;q=0.9"
    },
    body: JSON.stringify({
      device_model: "iPhone 15 Pro",
      device_type: "Mobile",
      system: "iOS 18",
      language: "en-US"
    })
  });
  assert.equal(visit.status, 201);
  assert.ok(visit.body.visitor_token);

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.10"
    },
    body: JSON.stringify({ code: "TEST2026", visitor_token: visit.body.visitor_token })
  });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.prize.name, "Phone");

  const logs = await server.request("/api/admin/visits");
  assert.equal(logs.status, 200);
  assert.equal(logs.body.visits.length, 1);
  assert.equal(logs.body.visits[0].code, "TEST2026");
  assert.equal(logs.body.visits[0].ip_address, "203.0.113.10");
  assert.equal(logs.body.visits[0].device_model, "iPhone 15 Pro");
  assert.equal(logs.body.visits[0].device_type, "Mobile");
  assert.equal(logs.body.visits[0].system, "iOS 18");
  assert.equal(logs.body.visits[0].language, "en-US");
});

test("admin can export visitor access records as an xlsx spreadsheet", async (t) => {
  const server = startTestServer();
  t.after(server.close);

  const denied = await server.request("/api/admin/visits/export", { raw: true });
  assert.equal(denied.status, 401);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "EXPORT26",
      title: "Export Test",
      max_uses: 1,
      active: true,
      prizes: [{ name: "Phone", probability: 100, stock: 1 }]
    })
  });

  const visit = await server.request("/api/public/visits", {
    method: "POST",
    headers: {
      "x-forwarded-for": "198.51.100.24",
      "user-agent": "Export Test Browser",
      "accept-language": "fr-FR,fr;q=0.9"
    },
    body: JSON.stringify({
      code: "EXPORT26",
      device_model: "Pixel 9",
      device_type: "Mobile",
      system: "Android 15",
      language: "fr-FR"
    })
  });
  assert.equal(visit.status, 201);

  const exported = await server.request("/api/admin/visits/export", { raw: true });
  assert.equal(exported.status, 200);
  assert.equal(
    exported.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.match(
    exported.headers.get("content-disposition"),
    /attachment; filename="access-records\.xlsx"/
  );
  assert.equal(exported.body.subarray(0, 2).toString("utf8"), "PK");
  const workbookText = exported.body.toString("utf8");
  assert.match(workbookText, /EXPORT26/);
  assert.match(workbookText, /198\.51\.100\.24/);
  assert.match(workbookText, /Pixel 9/);
  assert.match(workbookText, /Mobile/);
  assert.match(workbookText, /Android 15/);
  assert.match(workbookText, /fr-FR/);
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
