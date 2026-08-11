import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import sharp from "sharp";

import { createApp, resolveAppMode } from "../src/server.js";

function startTestServer(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), "lucky-wheel-"));
  const databasePath = options.databasePath ?? join(workspace, "test.db");
  const app = createApp({
    databasePath,
    uploadDir: join(workspace, "uploads"),
    sessionSecret: options.useGeneratedSessionSecret ? undefined : "test-secret",
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
    return { status: response.status, body, headers: response.headers };
  }

  return { request, baseUrl, databasePath, close: () => server.close() };
}

test("Render deployments expose public and admin routes by default", () => {
  assert.equal(resolveAppMode(undefined, { RENDER: "true" }), "all");
  assert.equal(resolveAppMode(undefined, {}), "public");
  assert.equal(resolveAppMode(undefined, { RENDER: "true", APP_MODE: "public" }), "public");
  assert.equal(resolveAppMode("admin", { RENDER: "true" }), "admin");

  const renderConfig = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(renderConfig, /healthCheckPath:\s*\/health/);
  assert.match(renderConfig, /key:\s*APP_MODE\s+[\s\S]*?value:\s*all/);
  assert.match(renderConfig, /key:\s*SESSION_SECRET\s+[\s\S]*?generateValue:\s*true/);
});

test("public mode does not expose admin login page or admin APIs", async (t) => {
  const server = startTestServer({ mode: "public" });
  t.after(server.close);

  for (const path of ["/ADMIN", "/admin.html"]) {
    const adminPage = await server.request(path, {
      headers: { accept: "text/html" }
    });
    assert.equal(adminPage.status, 404);
  }

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
  assert.match(page.body, /<img class="brand-logo-image" src="\/assets\/jump-quantum-banner\.png" alt="JUMP QUTARIS" \/>/);
  assert.match(page.body, /INVESTOR REWARDS EVENT/);
  assert.match(page.body, /<p class="event-title" aria-label="INVESTOR REWARDS EVENT">INVESTOR REWARDS EVENT<\/p>/);
  assert.match(page.body, /<button class="spin-button" id="spinButton" type="button" disabled>Go<\/button>/);
  assert.doesNotMatch(page.body, /id="spinButton"[^>]*>Enter Code<\/button>/);
  assert.doesNotMatch(page.body, /brand-jump/);
  assert.doesNotMatch(page.body, /brand-quantum/);
  assert.doesNotMatch(page.body, /brand-name/);
  assert.match(page.body, /<section class="vision-panel" aria-labelledby="visionTitle">/);
  assert.match(page.body, /<h2 id="visionTitle">Our Vision<\/h2>/);
  assert.doesNotMatch(page.body, /<span>Investor Rewards Event<\/span>/);
  assert.match(page.body, /success should be shared/);
  assert.match(
    page.body,
    /This event is not simply about rewards but about appreciation, partnership, and long term growth\./
  );
  assert.doesNotMatch(page.body, /rewards&mdash;it|long-term growth/);
  assert.ok(page.body.indexOf('id="resultPanel"') < page.body.indexOf('class="vision-panel"'));
  assert.match(page.body, /brand-divider/);
  assert.match(page.body, /\/assets\/jump-quantum-banner\.png/);

  const logo = await server.request("/assets/jump-quantum-banner.png", { raw: true });
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type") ?? "", /image\/png/);
  const logoMeta = await sharp(logo.body).metadata();
  assert.equal(logoMeta.width, 600);
  assert.equal(logoMeta.height, 294);

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
  assert.match(script.body, /await reportVisitor\(\{ code \}\)/);
  assert.doesNotMatch(script.body, /void reportVisitor\(\)/);
  assert.doesNotMatch(script.body, /label\.append\(image\)/);
  assert.doesNotMatch(script.body, /getWheelSegments/);
  assert.doesNotMatch(script.body, /getPrizeWeight/);
  assert.match(script.body, /const slice = 360 \/ prizes\.length/);
  assert.match(script.body, /spinButton\.textContent = "Go"/);
  assert.doesNotMatch(script.body, /spinButton\.textContent = "Enter Code"/);
  assert.match(script.body, /wheel-surface/);
  assert.match(script.body, /wheel-divider/);
  assert.doesNotMatch(script.body, /wheel-backplate/);
  assert.doesNotMatch(script.body, /wheel-board-boundary/);
  assert.doesNotMatch(script.body, /wheel-sector-boundary/);
  assert.doesNotMatch(script.body, /renderWheelBackplate/);
  assert.doesNotMatch(script.body, /describeAnnularSector/);
  assert.match(script.body, /surface\.style\.background = `conic-gradient\(\$\{gradient\}\)`/);
  assert.doesNotMatch(script.body, /conic-gradient\(from -90deg, \$\{gradient\}\)/);

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
  assert.match(styles.body, /\.wheel-surface\s*{/);
  assert.match(styles.body, /\.wheel-divider\s*{/);
  const wheelDividerRule = styles.body.match(/\.wheel-divider\s*{([\s\S]*?)\n}/)?.[1] || "";
  assert.match(wheelDividerRule, /rgba\(255,\s*255,\s*255,\s*0\.96\)/);
  assert.match(wheelDividerRule, /#ffffff/);
  assert.doesNotMatch(wheelDividerRule, /rgba\(255,\s*42,\s*87|#ff4b70|rgba\(255,\s*38,\s*83/);
  assert.doesNotMatch(styles.body, /\.wheel-backplate/);
  assert.doesNotMatch(styles.body, /\.wheel-board-boundary/);
  assert.doesNotMatch(styles.body, /\.wheel-sector-boundary/);

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

test("admin code generator UI supports single and 20-code prize snapshots", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.doesNotMatch(adminPage.body, /批次名称/);
  assert.doesNotMatch(adminPage.body, /codeTitleInput/);
  assert.doesNotMatch(adminPage.body, /id="quantityInput"/);
  assert.match(adminPage.body, /id="codeProbabilityRows"/);
  assert.match(adminPage.body, /生成独立代码/);
  assert.match(adminPage.body, /id="batchGenerateButton"/);
  assert.match(adminPage.body, /批量生成20个代码/);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.doesNotMatch(adminScript.body, /codeTitleInput/);
  assert.doesNotMatch(adminScript.body, /quantityInput/);
  assert.match(adminScript.body, /\/api\/admin\/codes\/bulk/);
  assert.match(adminScript.body, /quantity: 20/);
  assert.match(adminScript.body, /"\/api\/admin\/codes"/);
  assert.match(adminScript.body, /prizes: readCodeProbabilityForm\(\)/);
  assert.match(adminScript.body, /const createdCampaigns = isBatch \? response\.campaigns/);
  assert.match(adminScript.body, /renderGeneratedCodes\(createdCampaigns\)/);
  assert.match(adminScript.body, /inventory_key: String\(prize\.inventory_key \?\? ""\)/);
  assert.match(adminScript.body, /deleteCampaign/);
  assert.match(adminScript.body, /method: "DELETE"/);
});

test("admin generated-code list includes a confirmed delete-all control", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.body, /id="deleteAllCodesButton"/);
  assert.match(adminPage.body, /全部删除/);

  const adminScript = await server.request("/admin.js", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.match(adminScript.body, /deleteAllCodesButton\.disabled = campaigns\.length === 0/);
  assert.match(adminScript.body, /async function deleteAllCampaigns\(\)/);
  assert.match(adminScript.body, /确认删除全部/);
  assert.match(adminScript.body, /api\("\/api\/admin\/campaigns", \{\s*method: "DELETE"/);
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
  assert.match(adminPage.body, /默认概率：用于新代码的初始值，不影响已生成代码/);
  assert.match(adminPage.body, /库存：留空表示不限量，填 0 表示不可抽中/);
  assert.match(adminPage.body, /图片：可填写图片地址或上传图片，保存后同步到转盘端/);
});

test("admin access log UI replaces draw logs and includes an xlsx export button", async (t) => {
  const server = startTestServer({ mode: "admin" });
  t.after(server.close);

  const adminPage = await server.request("/ADMIN", {
    headers: { accept: "text/html" }
  });
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.headers.get("cache-control") || "", /no-store/);
  assert.match(adminPage.body, /\/admin\.js\?v=[a-f0-9]{12}/);
  assert.match(adminPage.body, /\/styles\.css\?v=[a-f0-9]{12}/);
  assert.doesNotMatch(adminPage.body, /__ADMIN_ASSET_VERSION__/);
  assert.match(adminPage.body, /访问记录/);
  assert.doesNotMatch(adminPage.body, /参与记录/);
  assert.match(adminPage.body, /id="exportVisitsButton"/);
  assert.match(adminPage.body, /导出XLSX/);
  for (const heading of ["时间", "代码", "中奖奖品", "IP地址", "网络位置", "设备型号", "设备类型", "系统", "使用语言"]) {
    assert.match(adminPage.body, new RegExp(heading));
  }

  const adminScript = await server.request("/admin.js?v=cache-busting-test", {
    headers: { accept: "text/javascript" }
  });
  assert.equal(adminScript.status, 200);
  assert.match(adminScript.headers.get("cache-control") || "", /no-store/);
  assert.match(adminScript.body, /exportVisitsButton/);
  assert.match(adminScript.body, /renderVisits/);
  assert.match(adminScript.body, /\/api\/admin\/visits\/export/);
  assert.match(adminScript.body, /visit\.prize_name/);
  assert.match(adminScript.body, /visit\.location/);
  assert.doesNotMatch(adminScript.body, /renderDraws/);

  const renderVisitsBlock = adminScript.body.slice(
    adminScript.body.indexOf("function renderVisits"),
    adminScript.body.indexOf("async function api")
  );
  assert.equal((renderVisitsBlock.match(/<td>/g) || []).length, 9);
  assert.match(
    renderVisitsBlock,
    /visit\.ip_address[\s\S]*visit\.location[\s\S]*visit\.device_model[\s\S]*visit\.device_type[\s\S]*visit\.system[\s\S]*visit\.language/
  );
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
  const defaultPrizeRows = [...defaultPrizeBlock.matchAll(
    /\{ name: "([^"]+)", probability: ([0-9.]+), stock: "", image_url: "" \}/g
  )].map((match) => ({ name: match[1], probability: Number(match[2]) }));

  assert.deepEqual(defaultPrizeRows, [
    { name: "21USDT", probability: 0 },
    { name: "0.1 Ethereum", probability: 0 },
    { name: "Apple Mac", probability: 0 },
    { name: "iPhone 17 Pro Max", probability: 0 },
    { name: "1 Ethereum", probability: 0 },
    { name: "77USDT", probability: 0 },
    { name: "5 Gift Card", probability: 2 },
    { name: "Thanks for playing", probability: 0 },
    { name: "20 shares of NVDA", probability: 0 },
    { name: "10 Gift Card", probability: 0 }
  ]);
  assert.equal((defaultPrizeBlock.match(/stock:\s*""/g) || []).length, 10);
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

test("missing session configuration uses an unpredictable signing secret", async (t) => {
  const server = startTestServer({ mode: "all", useGeneratedSessionSecret: true });
  t.after(server.close);

  const body = Buffer.from(
    JSON.stringify({ username: "admin", expiresAt: Date.now() + 60_000 })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", "change-this-secret-in-production")
    .update(body)
    .digest("base64url");

  const forged = await server.request("/api/admin/me", {
    headers: { cookie: `lucky_admin=${body}.${signature}` }
  });
  assert.equal(forged.status, 401);
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
      quantity: 20,
      max_uses: 1,
      active: true
    })
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.campaigns.length, 20);
  assert.equal(new Set(generated.body.campaigns.map((campaign) => campaign.code)).size, 20);

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

test("first bulk generation seeds the visible prize template and creates 20 independent codes", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const generated = await server.request("/api/admin/codes/bulk", {
    method: "POST",
    body: JSON.stringify({
      quantity: 20,
      max_uses: 1,
      active: true,
      prizes: [
        { name: "Prize A", probability: 0, stock: null, image_url: "" },
        { name: "Prize B", probability: 2, stock: null, image_url: "" }
      ]
    })
  });

  assert.equal(generated.status, 201);
  assert.equal(generated.body.campaigns.length, 20);
  assert.equal(new Set(generated.body.campaigns.map((campaign) => campaign.code)).size, 20);
  assert.ok(
    generated.body.campaigns.every(
      (campaign) =>
        campaign.prizes[0].name === "Prize A" &&
        campaign.prizes[0].probability === 0 &&
        campaign.prizes[1].name === "Prize B" &&
        campaign.prizes[1].probability === 2
    )
  );

  const savedPrizes = await server.request("/api/admin/prizes");
  assert.deepEqual(
    savedPrizes.body.prizes.map((prize) => [prize.name, prize.probability]),
    [["Prize A", 0], ["Prize B", 2]]
  );
});

test("admin generates one independent code with its submitted prize snapshot", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  const denied = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ prizes: [] })
  });
  assert.equal(denied.status, 401);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

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
  assert.match(generated.body.campaign.code, /^[A-Z0-9]{8}$/);
  assert.deepEqual(
    generated.body.campaign.prizes.map(({ name, probability }) => ({ name, probability })),
    [
      { name: "Prize A", probability: 100 },
      { name: "Prize B", probability: 0 }
    ]
  );

  const publicView = await server.request(
    `/api/public/campaigns/${generated.body.campaign.code}`
  );
  assert.equal(publicView.status, 200);
  assert.deepEqual(publicView.body.prizes.map((prize) => prize.name), ["Prize A", "Prize B"]);
  assert.ok(publicView.body.prizes.every((prize) => prize.probability === undefined));
});

test("admin can delete all generated codes while preserving access records", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  const denied = await server.request("/api/admin/campaigns", { method: "DELETE" });
  assert.equal(denied.status, 401);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const template = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Prize A", probability: 50, stock: null, image_url: "" },
        { name: "Prize B", probability: 50, stock: null, image_url: "" }
      ]
    })
  });
  assert.equal(template.status, 200);

  const generatedCodes = [];
  for (const winningPrize of ["Prize A", "Prize B"]) {
    const generated = await server.request("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({
        max_uses: 1,
        active: true,
        prizes: template.body.prizes.map((prize) => ({
          ...prize,
          probability: prize.name === winningPrize ? 100 : 0
        }))
      })
    });
    assert.equal(generated.status, 201);
    generatedCodes.push(generated.body.campaign.code);
  }

  const visit = await server.request("/api/public/visits", {
    method: "POST",
    body: JSON.stringify({
      visitor_token: "delete-all-visitor",
      code: generatedCodes[0],
      device_model: "Test Device",
      device_type: "Desktop",
      system: "Test OS",
      language: "en-US"
    })
  });
  assert.equal(visit.status, 201);

  const deleted = await server.request("/api/admin/campaigns", { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted_count, 2);

  const campaigns = await server.request("/api/admin/campaigns");
  assert.deepEqual(campaigns.body.campaigns, []);

  const visits = await server.request("/api/admin/visits");
  assert.equal(visits.body.visits.length, 1);
  assert.equal(visits.body.visits[0].code, generatedCodes[0]);

  const publicView = await server.request(`/api/public/campaigns/${generatedCodes[0]}`);
  assert.equal(publicView.status, 404);
});

test("legacy bulk-generated codes snapshot the current global prize probabilities", async (t) => {
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
    assert.equal(draw.body.prize.name, "Old Probability Prize");
  } finally {
    Math.random = originalRandom;
  }
});

test("generated codes keep independent prize probabilities", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Template Prize", probability: 100, stock: null, image_url: "" }
      ]
    })
  });

  const codeA = await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "CODEA2026",
      max_uses: 1,
      active: true,
      prizes: [
        { name: "Prize A", probability: 100, stock: null, image_url: "" },
        { name: "Prize B", probability: 0, stock: null, image_url: "" }
      ]
    })
  });
  assert.equal(codeA.status, 201);

  const codeB = await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "CODEB2026",
      max_uses: 1,
      active: true,
      prizes: [
        { name: "Prize A", probability: 0, stock: null, image_url: "" },
        { name: "Prize B", probability: 100, stock: null, image_url: "" }
      ]
    })
  });
  assert.equal(codeB.status, 201);

  await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Changed Template", probability: 100, stock: null, image_url: "" }
      ]
    })
  });

  const viewA = await server.request("/api/public/campaigns/CODEA2026");
  const viewB = await server.request("/api/public/campaigns/CODEB2026");
  assert.equal(viewA.status, 200);
  assert.equal(viewB.status, 200);
  assert.deepEqual(viewA.body.prizes.map((prize) => prize.name), ["Prize A", "Prize B"]);
  assert.deepEqual(viewB.body.prizes.map((prize) => prize.name), ["Prize A", "Prize B"]);
  assert.ok(viewA.body.prizes.every((prize) => prize.probability === undefined));
  assert.ok(viewB.body.prizes.every((prize) => prize.probability === undefined));

  const drawA = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "CODEA2026" })
  });
  const drawB = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "CODEB2026" })
  });
  assert.equal(drawA.status, 200);
  assert.equal(drawB.status, 200);
  assert.equal(drawA.body.prize.name, "Prize A");
  assert.equal(drawB.body.prize.name, "Prize B");
});

test("independent code probabilities still share finite template inventory", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const template = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "One Shared Prize", probability: 100, stock: 1, image_url: "" }
      ]
    })
  });
  assert.equal(template.status, 200);
  const submittedPrizes = template.body.prizes.map((prize) => ({
    name: prize.name,
    probability: prize.probability,
    stock: prize.stock,
    image_url: prize.image_url,
    sort_order: prize.sort_order
  }));

  const codes = [];
  for (let index = 0; index < 2; index += 1) {
    const generated = await server.request("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({
        max_uses: 1,
        active: true,
        prizes: submittedPrizes
      })
    });
    assert.equal(generated.status, 201);
    codes.push(generated.body.campaign.code);
  }

  const firstDraw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: codes[0] })
  });
  assert.equal(firstDraw.status, 200);
  assert.equal(firstDraw.body.prize.name, "One Shared Prize");

  const secondDraw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: codes[1] })
  });
  assert.equal(secondDraw.status, 400);
  assert.match(secondDraw.body.error, /inventory is sold out/i);
});

test("code generation rejects a template whose positive-probability inventory is exhausted", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const template = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [{ name: "Last Prize", probability: 100, stock: 1, image_url: "" }]
    })
  });
  const firstCode = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ max_uses: 1, active: true, prizes: template.body.prizes })
  });
  assert.equal(firstCode.status, 201);

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: firstCode.body.campaign.code })
  });
  assert.equal(draw.status, 200);

  const exhausted = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ max_uses: 1, active: true, prizes: template.body.prizes })
  });
  assert.equal(exhausted.status, 400);
  assert.match(exhausted.body.error, /available inventory/i);
});

test("saving the same template without inventory keys does not reopen awarded stock", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });
  const template = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [{ name: "No Reopen", probability: 100, stock: 1, image_url: "" }]
    })
  });
  const code = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ max_uses: 1, active: true, prizes: template.body.prizes })
  });
  const draw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: code.body.campaign.code })
  });
  assert.equal(draw.status, 200);

  const legacySave = await server.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [{ name: "No Reopen", probability: 100, stock: 1, image_url: "" }]
    })
  });
  assert.equal(legacySave.status, 200);

  const reopened = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ max_uses: 1, active: true, prizes: legacySave.body.prizes })
  });
  assert.equal(reopened.status, 400);
  assert.match(reopened.body.error, /available inventory/i);
});

test("inventory migration keeps awards recorded on campaign snapshots", async (t) => {
  const originalServer = startTestServer({ mode: "all" });
  t.after(originalServer.close);

  await originalServer.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });
  const template = await originalServer.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [{ name: "Migrated Stock", probability: 100, stock: 1, image_url: "" }]
    })
  });

  const codes = [];
  for (let index = 0; index < 2; index += 1) {
    const generated = await originalServer.request("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({ max_uses: 1, active: true, prizes: template.body.prizes })
    });
    codes.push(generated.body.campaign.code);
  }

  const firstDraw = await originalServer.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: codes[0] })
  });
  assert.equal(firstDraw.status, 200);

  const damagedDb = new Database(originalServer.databasePath);
  damagedDb.prepare("UPDATE prizes SET inventory_key = NULL").run();
  damagedDb.prepare("DELETE FROM prize_inventory").run();
  damagedDb.prepare("DELETE FROM global_prizes").run();
  damagedDb.close();

  const migratedServer = startTestServer({
    mode: "all",
    databasePath: originalServer.databasePath
  });
  t.after(migratedServer.close);

  const secondDraw = await migratedServer.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: codes[1] })
  });
  assert.equal(secondDraw.status, 400);
  assert.match(secondDraw.body.error, /inventory is sold out/i);
});

test("updating campaign settings without prizes preserves awarded inventory", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const created = await server.request("/api/admin/campaigns", {
    method: "POST",
    body: JSON.stringify({
      code: "KEEPSTOCK",
      max_uses: 2,
      active: true,
      prizes: [{ name: "Only One", probability: 100, stock: 1, image_url: "" }]
    })
  });
  assert.equal(created.status, 201);

  const firstDraw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "KEEPSTOCK" })
  });
  assert.equal(firstDraw.status, 200);

  const updated = await server.request(`/api/admin/campaigns/${created.body.campaign.id}`, {
    method: "PUT",
    body: JSON.stringify({ active: true, max_uses: 2 })
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.campaign.prizes[0].won_count, 1);

  const secondDraw = await server.request("/api/public/draw", {
    method: "POST",
    body: JSON.stringify({ code: "KEEPSTOCK" })
  });
  assert.equal(secondDraw.status, 400);
  assert.match(secondDraw.body.error, /inventory is sold out/i);
});

test("code generation returns a validation error when no drawable prizes exist", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const independent = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({ max_uses: 1, active: true, prizes: [] })
  });
  assert.equal(independent.status, 400);
  assert.match(independent.body.error, /positive probability/i);

  const legacyBulk = await server.request("/api/admin/codes/bulk", {
    method: "POST",
    body: JSON.stringify({ quantity: 1, max_uses: 1, active: true })
  });
  assert.equal(legacyBulk.status, 400);
  assert.match(legacyBulk.body.error, /positive probability/i);
});

test("database migration creates indexes for campaign prize backfills", async (t) => {
  const server = startTestServer({ mode: "all" });
  t.after(server.close);

  const db = new Database(server.databasePath, { readonly: true });
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => row.name);
  db.close();

  assert.ok(indexes.includes("idx_prizes_campaign_id"));
  assert.ok(indexes.includes("idx_draws_campaign_prize"));
});

test("existing visit databases gain prize and network location fields during migration", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "lucky-wheel-legacy-visits-"));
  const databasePath = join(workspace, "legacy.db");
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_token TEXT NOT NULL UNIQUE,
      code TEXT,
      ip TEXT,
      forwarded_for TEXT,
      user_agent TEXT,
      device_model TEXT,
      device_type TEXT,
      system TEXT,
      language TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO visits (visitor_token, code, ip)
    VALUES ('legacy-visitor', 'LEGACY01', '192.0.2.44');
  `);
  legacyDb.close();

  const server = startTestServer({ mode: "all", databasePath });
  t.after(server.close);
  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const visits = await server.request("/api/admin/visits");
  assert.equal(visits.status, 200);
  assert.equal(visits.body.visits[0].code, "LEGACY01");
  assert.equal(visits.body.visits[0].prize_name, "");
  assert.equal(visits.body.visits[0].location, "");

  const migratedDb = new Database(databasePath, { readonly: true });
  const columns = migratedDb.prepare("PRAGMA table_info(visits)").all();
  migratedDb.close();
  assert.ok(columns.some((column) => column.name === "prize_name"));
  assert.ok(columns.some((column) => column.name === "location"));
});

test("legacy generated codes receive a fixed prize snapshot during migration", async (t) => {
  const originalServer = startTestServer({ mode: "all" });
  t.after(originalServer.close);

  await originalServer.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });
  await originalServer.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Legacy Prize", probability: 100, stock: null, image_url: "" }
      ]
    })
  });
  const legacyCode = await originalServer.request("/api/admin/codes/bulk", {
    method: "POST",
    body: JSON.stringify({ quantity: 1, max_uses: 1, active: true })
  });
  assert.equal(legacyCode.status, 201);
  const legacyCampaign = legacyCode.body.campaigns[0];
  const code = legacyCampaign.code;

  const legacyDb = new Database(originalServer.databasePath);
  legacyDb.prepare("DELETE FROM prizes WHERE campaign_id = ?").run(legacyCampaign.id);
  legacyDb.close();

  const migratedServer = startTestServer({
    mode: "all",
    databasePath: originalServer.databasePath
  });
  t.after(migratedServer.close);
  await migratedServer.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  await migratedServer.request("/api/admin/prizes", {
    method: "PUT",
    body: JSON.stringify({
      prizes: [
        { name: "Changed Template", probability: 100, stock: null, image_url: "" }
      ]
    })
  });

  const publicView = await migratedServer.request(`/api/public/campaigns/${code}`);
  assert.equal(publicView.status, 200);
  assert.deepEqual(publicView.body.prizes.map((prize) => prize.name), ["Legacy Prize"]);
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
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "172.68.164.143, 203.0.113.10",
      "cf-ipcity": "Miami",
      "cf-region": "Florida",
      "cf-ipcountry": "US",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      "accept-language": "en-US,en;q=0.9"
    },
    body: JSON.stringify({
      code: "TEST2026",
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
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "172.68.164.143, 203.0.113.10",
      "cf-ipcity": "Miami",
      "cf-region": "Florida",
      "cf-ipcountry": "US"
    },
    body: JSON.stringify({ code: "TEST2026", visitor_token: visit.body.visitor_token })
  });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.prize.name, "Phone");

  const logs = await server.request("/api/admin/visits");
  assert.equal(logs.status, 200);
  assert.equal(logs.body.visits.length, 1);
  assert.equal(logs.body.visits[0].code, "TEST2026");
  assert.equal(logs.body.visits[0].prize_name, "Phone");
  assert.equal(logs.body.visits[0].ip_address, "203.0.113.10");
  assert.equal(logs.body.visits[0].location, "Miami, Florida, US");
  assert.equal(logs.body.visits[0].device_model, "iPhone 15 Pro");
  assert.equal(logs.body.visits[0].device_type, "Mobile");
  assert.equal(logs.body.visits[0].system, "iOS 18");
  assert.equal(logs.body.visits[0].language, "en-US");
});

test("admin visit records only include reports with entered codes", async (t) => {
  const server = startTestServer();
  t.after(server.close);

  await server.request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" })
  });

  const blankVisit = await server.request("/api/public/visits", {
    method: "POST",
    headers: {
      "x-forwarded-for": "192.0.2.11",
      "user-agent": "Blank Visit Browser",
      "accept-language": "en-US,en;q=0.9"
    },
    body: JSON.stringify({
      device_model: "Windows PC",
      device_type: "Desktop",
      system: "Windows 10/11",
      language: "en-US"
    })
  });
  assert.equal(blankVisit.status, 201);
  assert.ok(blankVisit.body.visitor_token);

  let logs = await server.request("/api/admin/visits");
  assert.equal(logs.status, 200);
  assert.equal(logs.body.visits.length, 0);

  const codedVisit = await server.request("/api/public/visits", {
    method: "POST",
    headers: {
      "x-forwarded-for": "192.0.2.12",
      "user-agent": "Coded Visit Browser",
      "accept-language": "en-GB,en;q=0.9"
    },
    body: JSON.stringify({
      visitor_token: blankVisit.body.visitor_token,
      code: "ENTERED99",
      device_model: "Mac",
      device_type: "Desktop",
      system: "macOS 15",
      language: "en-GB"
    })
  });
  assert.equal(codedVisit.status, 201);

  logs = await server.request("/api/admin/visits");
  assert.equal(logs.status, 200);
  assert.equal(logs.body.visits.length, 1);
  assert.equal(logs.body.visits[0].code, "ENTERED99");
  assert.equal(logs.body.visits[0].ip_address, "192.0.2.12");
  assert.equal(logs.body.visits[0].location, "");
  assert.equal(logs.body.visits[0].device_model, "Mac");

  const exported = await server.request("/api/admin/visits/export", { raw: true });
  const workbookText = exported.body.toString("utf8");
  assert.match(workbookText, /ENTERED99/);
  assert.doesNotMatch(workbookText, /Blank Visit Browser/);
  assert.doesNotMatch(workbookText, /192\.0\.2\.11/);
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
      "cf-connecting-ip": "198.51.100.24",
      "x-forwarded-for": "172.68.164.143, 198.51.100.24",
      "cf-ipcity": "Paris",
      "cf-region": "Ile-de-France",
      "cf-ipcountry": "FR",
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

  const draw = await server.request("/api/public/draw", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "198.51.100.24",
      "x-forwarded-for": "172.68.164.143, 198.51.100.24",
      "cf-ipcity": "Paris",
      "cf-region": "Ile-de-France",
      "cf-ipcountry": "FR"
    },
    body: JSON.stringify({
      code: "EXPORT26",
      visitor_token: visit.body.visitor_token,
      device_model: "Pixel 9",
      device_type: "Mobile",
      system: "Android 15",
      language: "fr-FR"
    })
  });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.prize.name, "Phone");

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
  assert.match(workbookText, /中奖奖品/);
  assert.match(workbookText, /Phone/);
  assert.match(workbookText, /198\.51\.100\.24/);
  assert.doesNotMatch(workbookText, /172\.68\.164\.143/);
  assert.match(workbookText, /Paris, Ile-de-France, FR/);
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

  const generated = await server.request("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify({
      max_uses: 1,
      active: true,
      prizes: [{ name: "Delete Me", probability: 100, stock: null, image_url: "" }]
    })
  });
  assert.equal(generated.status, 201);
  const campaign = generated.body.campaign;

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
