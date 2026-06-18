const loginView = document.querySelector("#loginView");
const adminView = document.querySelector("#adminView");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const newCampaignButton = document.querySelector("#newCampaignButton");
const campaignList = document.querySelector("#campaignList");
const campaignForm = document.querySelector("#campaignForm");
const editorTitle = document.querySelector("#editorTitle");
const saveState = document.querySelector("#saveState");
const campaignTitleInput = document.querySelector("#campaignTitleInput");
const campaignCodeInput = document.querySelector("#campaignCodeInput");
const generateCodeButton = document.querySelector("#generateCodeButton");
const maxUsesInput = document.querySelector("#maxUsesInput");
const expiresInput = document.querySelector("#expiresInput");
const activeInput = document.querySelector("#activeInput");
const prizeRows = document.querySelector("#prizeRows");
const prizeRowTemplate = document.querySelector("#prizeRowTemplate");
const addPrizeButton = document.querySelector("#addPrizeButton");
const resetFormButton = document.querySelector("#resetFormButton");
const drawLogRows = document.querySelector("#drawLogRows");
const logCount = document.querySelector("#logCount");

let campaigns = [];
let selectedCampaignId = null;

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
newCampaignButton.addEventListener("click", resetForm);
resetFormButton.addEventListener("click", resetForm);

addPrizeButton.addEventListener("click", () => {
  addPrizeRow({ name: "", probability: 10, stock: "", image_url: "" });
});

generateCodeButton.addEventListener("click", async () => {
  saveState.textContent = "正在生成代码...";
  saveState.style.color = "#667085";
  const response = await api("/api/admin/codes/generate");
  if (response.ok) {
    campaignCodeInput.value = response.code;
    saveState.textContent = "代码已生成";
    saveState.style.color = "#078f8a";
  } else {
    saveState.textContent = response.error || "代码生成失败";
    saveState.style.color = "#bd2440";
  }
});

campaignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveState.textContent = "保存中...";

  const payload = readCampaignForm();
  const url = selectedCampaignId
    ? `/api/admin/campaigns/${selectedCampaignId}`
    : "/api/admin/campaigns";
  const method = selectedCampaignId ? "PUT" : "POST";
  const response = await api(url, { method, body: payload });

  if (!response.ok) {
    saveState.textContent = response.error;
    saveState.style.color = "#bd2440";
    return;
  }

  saveState.textContent = "已保存";
  saveState.style.color = "#078f8a";
  selectedCampaignId = response.campaign.id;
  await refreshAll();
  selectCampaign(selectedCampaignId);
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
  const [campaignResponse, drawResponse] = await Promise.all([
    api("/api/admin/campaigns"),
    api("/api/admin/draws")
  ]);

  if (campaignResponse.ok) {
    campaigns = campaignResponse.campaigns;
    renderCampaignList();
    if (!selectedCampaignId && campaigns[0]) {
      selectCampaign(campaigns[0].id);
    }
  }

  if (drawResponse.ok) {
    renderDraws(drawResponse.draws);
  }
}

function renderCampaignList() {
  campaignList.innerHTML = "";
  if (!campaigns.length) {
    campaignList.innerHTML = `<p class="privacy-note">还没有抽奖代码。</p>`;
    return;
  }

  for (const campaign of campaigns) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `campaign-item ${campaign.id === selectedCampaignId ? "active" : ""}`;
    item.innerHTML = `
      <strong>${escapeHtml(campaign.title)}</strong>
      <span>代码 ${escapeHtml(campaign.code)} · ${campaign.used_count}/${campaign.max_uses} 次</span>
      <span>${campaign.active ? "已启用" : "已停用"}</span>
    `;
    item.addEventListener("click", () => selectCampaign(campaign.id));
    campaignList.append(item);
  }
}

function selectCampaign(id) {
  const campaign = campaigns.find((item) => item.id === id);
  if (!campaign) {
    return;
  }

  selectedCampaignId = id;
  editorTitle.textContent = "编辑抽奖活动";
  saveState.textContent = "";
  campaignTitleInput.value = campaign.title;
  campaignCodeInput.value = campaign.code;
  maxUsesInput.value = campaign.max_uses;
  expiresInput.value = campaign.expires_at ? toDateTimeLocal(campaign.expires_at) : "";
  activeInput.checked = campaign.active;
  prizeRows.innerHTML = "";
  for (const prize of campaign.prizes) {
    addPrizeRow(prize);
  }
  renderCampaignList();
}

function resetForm() {
  selectedCampaignId = null;
  editorTitle.textContent = "新建抽奖活动";
  saveState.textContent = "";
  campaignTitleInput.value = "";
  campaignCodeInput.value = "";
  maxUsesInput.value = "1";
  expiresInput.value = "";
  activeInput.checked = true;
  prizeRows.innerHTML = "";
  addPrizeRow({ name: "一等奖", probability: 10, stock: 1, image_url: "" });
  addPrizeRow({ name: "谢谢参与", probability: 90, stock: "", image_url: "" });
  renderCampaignList();
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
      saveState.textContent = "图片已上传";
      saveState.style.color = "#078f8a";
    } else {
      saveState.textContent = data.error || "图片上传失败";
      saveState.style.color = "#bd2440";
    }
  });

  prizeRows.append(row);
}

function readCampaignForm() {
  return {
    title: campaignTitleInput.value,
    code: campaignCodeInput.value,
    max_uses: Number(maxUsesInput.value),
    expires_at: expiresInput.value ? new Date(expiresInput.value).toISOString() : null,
    active: activeInput.checked,
    prizes: [...prizeRows.querySelectorAll(".prize-row")].map((row, index) => ({
      name: row.querySelector(".prize-name").value,
      probability: Number(row.querySelector(".prize-probability").value),
      stock: row.querySelector(".prize-stock").value,
      image_url: row.querySelector(".prize-image").value,
      sort_order: index
    }))
  };
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

function toDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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

resetForm();
boot();
