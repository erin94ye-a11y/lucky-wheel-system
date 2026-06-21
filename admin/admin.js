const loginView = document.querySelector("#loginView");
const adminView = document.querySelector("#adminView");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const campaignList = document.querySelector("#campaignList");
const codeCount = document.querySelector("#codeCount");
const codeGeneratorForm = document.querySelector("#codeGeneratorForm");
const quantityInput = document.querySelector("#quantityInput");
const maxUsesInput = document.querySelector("#maxUsesInput");
const expiresInput = document.querySelector("#expiresInput");
const activeInput = document.querySelector("#activeInput");
const codeState = document.querySelector("#codeState");
const generatedCodes = document.querySelector("#generatedCodes");
const generatedCount = document.querySelector("#generatedCount");
const prizeForm = document.querySelector("#prizeForm");
const prizeState = document.querySelector("#prizeState");
const prizeRows = document.querySelector("#prizeRows");
const prizeRowTemplate = document.querySelector("#prizeRowTemplate");
const addPrizeButton = document.querySelector("#addPrizeButton");
const resetPrizeButton = document.querySelector("#resetPrizeButton");
const drawLogRows = document.querySelector("#drawLogRows");
const logCount = document.querySelector("#logCount");

let campaigns = [];
let prizesLoaded = false;

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginMessage("正在登录...", "");

  const response = await api("/api/admin/login", {
    method: "POST",
    body: {
      username: document.querySelector("#username").value,
      password: document.querySelector("#password").value
    }
  });

  if (response.ok) {
    setLoginMessage("", "");
    showAdmin();
    await refreshAll();
  } else {
    setLoginMessage(response.error, "error");
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  adminView.classList.add("is-hidden");
  loginView.classList.remove("is-hidden");
});

refreshButton.addEventListener("click", refreshAll);

codeGeneratorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setState(codeState, "正在生成代码...", "muted");

  const response = await api("/api/admin/codes/bulk", {
    method: "POST",
    body: {
      quantity: Number(quantityInput.value),
      max_uses: Number(maxUsesInput.value),
      expires_at: expiresInput.value ? new Date(expiresInput.value).toISOString() : null,
      active: activeInput.checked
    }
  });

  if (!response.ok) {
    setState(codeState, response.error || "代码生成失败", "error");
    return;
  }

  setState(codeState, `已生成 ${response.campaigns.length} 个代码`, "success");
  renderGeneratedCodes(response.campaigns);
  await refreshAll();
});

prizeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setState(prizeState, "正在保存奖品池...", "muted");

  const response = await api("/api/admin/prizes", {
    method: "PUT",
    body: { prizes: readPrizeForm() }
  });

  if (!response.ok) {
    setState(prizeState, response.error || "奖品池保存失败", "error");
    return;
  }

  setState(prizeState, "奖品池已保存", "success");
  renderPrizeSettings(response.prizes);
});

addPrizeButton.addEventListener("click", () => {
  addPrizeRow({ name: "", probability: 10, stock: "", image_url: "" });
});

resetPrizeButton.addEventListener("click", () => {
  renderPrizeSettings(defaultPrizes());
  setState(prizeState, "已恢复默认示例，保存后生效", "muted");
});

async function boot() {
  const response = await api("/api/admin/me");
  if (response.ok) {
    showAdmin();
    await refreshAll();
  }
}

function showAdmin() {
  loginView.classList.add("is-hidden");
  adminView.classList.remove("is-hidden");
}

async function refreshAll() {
  const [campaignResponse, prizeResponse, drawResponse] = await Promise.all([
    api("/api/admin/campaigns"),
    api("/api/admin/prizes"),
    api("/api/admin/draws")
  ]);

  if (campaignResponse.ok) {
    campaigns = campaignResponse.campaigns;
    renderCampaignList();
  }

  if (prizeResponse.ok && !prizesLoaded) {
    prizesLoaded = true;
    renderPrizeSettings(prizeResponse.prizes.length ? prizeResponse.prizes : defaultPrizes());
  }

  if (drawResponse.ok) {
    renderDraws(drawResponse.draws);
  }
}

function renderCampaignList() {
  codeCount.textContent = `${campaigns.length} 个`;
  campaignList.innerHTML = "";
  if (!campaigns.length) {
    campaignList.innerHTML = `<p class="privacy-note">还没有生成抽奖代码。</p>`;
    return;
  }

  for (const campaign of campaigns) {
    campaignList.append(createCampaignCodeItem(campaign));
  }
}

function renderGeneratedCodes(codes) {
  generatedCount.textContent = `${codes.length} 个`;
  generatedCodes.innerHTML = "";

  for (const campaign of codes) {
    generatedCodes.append(createCampaignCodeItem(campaign, "generated-code-item"));
  }
}

function createCampaignCodeItem(campaign, className = "campaign-item") {
  const item = document.createElement("div");
  item.className = className;
  item.innerHTML = `
    <div class="campaign-item-body">
      <strong>${escapeHtml(campaign.code)}</strong>
      <span>${campaign.used_count}/${campaign.max_uses} 次 · ${campaign.active ? "已启用" : "已停用"}</span>
    </div>
  `;

  const button = document.createElement("button");
  button.className = "code-delete-button";
  button.type = "button";
  button.textContent = "删除";
  button.addEventListener("click", () => {
    deleteCampaign(campaign);
  });
  item.append(button);
  return item;
}

async function deleteCampaign(campaign) {
  if (!window.confirm(`确认删除代码 ${campaign.code}？`)) {
    return;
  }

  setState(codeState, "正在删除代码...", "muted");
  const response = await api(`/api/admin/campaigns/${campaign.id}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    setState(codeState, response.error || "代码删除失败", "error");
    return;
  }

  setState(codeState, `已删除代码 ${campaign.code}`, "success");
  await refreshAll();
}

function renderPrizeSettings(prizes) {
  prizeRows.innerHTML = "";
  for (const prize of prizes) {
    addPrizeRow(prize);
  }
}

function addPrizeRow(prize) {
  const row = prizeRowTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector(".prize-name").value = prize.name ?? "";
  row.querySelector(".prize-probability").value = prize.probability ?? 10;
  row.querySelector(".prize-stock").value = prize.stock ?? "";
  row.querySelector(".prize-image").value = prize.image_url ?? "";

  row.querySelector(".remove-prize").addEventListener("click", () => {
    row.remove();
  });

  row.querySelector(".prize-upload").addEventListener("change", async (event) => {
    const file = event.currentTarget.files[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append("image", file);
    const response = await fetch("/api/admin/upload", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (response.ok) {
      row.querySelector(".prize-image").value = data.image_url;
      setState(prizeState, "图片已上传", "success");
    } else {
      setState(prizeState, data.error || "图片上传失败", "error");
    }
  });

  prizeRows.append(row);
}

function readPrizeForm() {
  return [...prizeRows.querySelectorAll(".prize-row")].map((row, index) => ({
    name: row.querySelector(".prize-name").value,
    probability: Number(row.querySelector(".prize-probability").value),
    stock: row.querySelector(".prize-stock").value,
    image_url: row.querySelector(".prize-image").value,
    sort_order: index
  }));
}

function renderDraws(draws) {
  logCount.textContent = `${draws.length} 条`;
  drawLogRows.innerHTML = draws
    .map(
      (draw) => `
        <tr>
          <td>${escapeHtml(formatTime(draw.created_at))}</td>
          <td>${escapeHtml(draw.code)}</td>
          <td>${escapeHtml(draw.prize_name)}</td>
          <td>${escapeHtml(draw.ip || "")}</td>
          <td>${escapeHtml(draw.forwarded_for || "")}</td>
          <td>${escapeHtml(draw.user_agent || "")}</td>
        </tr>
      `
    )
    .join("");
}

async function api(url, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: options.body instanceof FormData ? {} : { "content-type": "application/json" }
  };

  if (options.body) {
    fetchOptions.body = options.body instanceof FormData ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, ...data };
}

function setLoginMessage(text, type) {
  loginMessage.textContent = text;
  loginMessage.className = `form-message ${type || ""}`.trim();
}

function setState(element, text, type) {
  element.textContent = text;
  element.style.color =
    type === "error" ? "#bd2440" : type === "success" ? "#078f8a" : "#667085";
}

function defaultPrizes() {
  return [
    { name: "$77 USDT", probability: 10, stock: "", image_url: "" },
    { name: "#1 Ethereum", probability: 10, stock: "", image_url: "" },
    { name: "Thanks for playing", probability: 10, stock: "", image_url: "" },
    { name: "Apple Mac", probability: 10, stock: "", image_url: "" },
    { name: "iPhone 17 Pro Max", probability: 10, stock: "", image_url: "" },
    { name: "Thanks for playing", probability: 10, stock: "", image_url: "" },
    { name: "20 shares of NVDA", probability: 10, stock: "", image_url: "" },
    { name: "#1 oz gold", probability: 10, stock: "", image_url: "" },
    { name: "Thanks for playing", probability: 10, stock: "", image_url: "" }
  ];
}

function formatTime(value) {
  return new Date(`${value}Z`).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

boot();
