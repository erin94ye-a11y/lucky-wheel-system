const codeForm = document.querySelector("#codeForm");
const codeInput = document.querySelector("#codeInput");
const message = document.querySelector("#message");
const welcomeStage = document.querySelector("#welcomeStage");
const wheelStage = document.querySelector("#wheelStage");
const wheel = document.querySelector("#wheel");
const spinButton = document.querySelector("#spinButton");
const campaignCode = document.querySelector("#campaignCode");
const campaignTitle = document.querySelector("#campaignTitle");
const campaignMeta = document.querySelector("#campaignMeta");
const prizePreview = document.querySelector("#prizePreview");
const prizeCount = document.querySelector("#prizeCount");
const resultPanel = document.querySelector("#resultPanel");
const resultImage = document.querySelector("#resultImage");
const resultName = document.querySelector("#resultName");

const segmentColors = ["#e23d57", "#078f8a", "#1d3557", "#f5b942", "#8e5cf4", "#f97316"];

let activeCampaign = null;
let currentRotation = 0;
let isSpinning = false;

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("正在校验抽奖代码...", "");
  resultPanel.classList.add("is-hidden");

  try {
    const code = codeInput.value.trim().toUpperCase();
    const response = await fetch(`/api/public/campaigns/${encodeURIComponent(code)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "抽奖代码不可用。");
    }

    activeCampaign = data.campaign;
    renderCampaign(activeCampaign);
    setMessage("代码有效，可以开始抽奖。", "success");
  } catch (error) {
    wheelStage.classList.add("is-hidden");
    welcomeStage.classList.remove("is-hidden");
    setMessage(error.message, "error");
  }
});

const initialCode = new URLSearchParams(window.location.search).get("code");
if (initialCode) {
  codeInput.value = initialCode.trim().toUpperCase();
  codeForm.requestSubmit();
}

spinButton.addEventListener("click", async () => {
  if (!activeCampaign || isSpinning) {
    return;
  }

  isSpinning = true;
  spinButton.disabled = true;
  resultPanel.classList.add("is-hidden");
  setMessage("抽奖中...", "");

  try {
    const response = await fetch("/api/public/draw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: activeCampaign.code })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "抽奖失败。");
    }

    spinToPrize(data.prize, data.campaign);
  } catch (error) {
    setMessage(error.message, "error");
    spinButton.disabled = false;
    isSpinning = false;
  }
});

function renderCampaign(campaign) {
  activeCampaign = campaign;
  const remaining = Math.max(0, campaign.max_uses - campaign.used_count);
  campaignCode.textContent = `抽奖代码 ${campaign.code}`;
  campaignTitle.textContent = campaign.title;
  campaignMeta.textContent = `剩余次数 ${remaining} / ${campaign.max_uses}`;
  welcomeStage.classList.add("is-hidden");
  wheelStage.classList.remove("is-hidden");
  spinButton.disabled = remaining <= 0;
  spinButton.textContent = remaining <= 0 ? "次数已用完" : "开始抽奖";
  isSpinning = false;

  const prizes = campaign.prizes.length ? campaign.prizes : [{ name: "暂无奖品" }];
  renderPrizePreview(prizes);
  const slice = 360 / prizes.length;
  const gradient = prizes
    .map((_, index) => {
      const color = segmentColors[index % segmentColors.length];
      return `${color} ${index * slice}deg ${(index + 1) * slice}deg`;
    })
    .join(", ");

  wheel.style.background = `conic-gradient(from -90deg, ${gradient})`;
  wheel.innerHTML = "";

  prizes.forEach((prize, index) => {
    const label = document.createElement("div");
    label.className = "wheel-label";
    const angle = index * slice + slice / 2 - 90;
    const radius = Math.max(84, Math.min(170, wheel.clientWidth * 0.32));
    label.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`;

    if (prize.image_url) {
      const image = document.createElement("img");
      image.src = prize.image_url;
      image.alt = "";
      label.append(image);
    }

    const name = document.createElement("span");
    name.textContent = prize.name;
    label.append(name);
    wheel.append(label);
  });
}

function renderPrizePreview(prizes) {
  prizeCount.textContent = `${prizes.length} 项`;
  prizePreview.innerHTML = "";

  prizes.forEach((prize, index) => {
    const item = document.createElement("div");
    item.className = "prize-preview-item";

    const thumb = document.createElement("div");
    thumb.className = "prize-thumb";
    thumb.style.background = segmentColors[index % segmentColors.length];

    if (prize.image_url) {
      const image = document.createElement("img");
      image.src = prize.image_url;
      image.alt = "";
      thumb.append(image);
    } else {
      thumb.textContent = prize.name.slice(0, 1);
    }

    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = prize.name;
    const stock = document.createElement("span");
    stock.textContent = prize.available === null ? "库存不限" : `剩余 ${prize.available}`;
    detail.append(name, stock);
    item.append(thumb, detail);
    prizePreview.append(item);
  });
}

function spinToPrize(prize, updatedCampaign) {
  const prizes = activeCampaign.prizes;
  const selectedIndex = Math.max(
    0,
    prizes.findIndex((item) => item.id === prize.id || item.name === prize.name)
  );
  const slice = 360 / prizes.length;
  const targetCenter = selectedIndex * slice + slice / 2 - 90;
  const normalizedTarget = ((targetCenter % 360) + 360) % 360;
  const normalizedRotation = currentRotation % 360;
  const targetRotation = currentRotation + 2160 + (360 - normalizedTarget) - normalizedRotation;

  currentRotation = targetRotation;
  wheel.style.transform = `rotate(${currentRotation}deg)`;

  window.setTimeout(() => {
    resultName.textContent = prize.name;
    if (prize.image_url) {
      resultImage.src = prize.image_url;
      resultImage.classList.remove("is-hidden");
    } else {
      resultImage.removeAttribute("src");
      resultImage.classList.add("is-hidden");
    }
    resultPanel.classList.remove("is-hidden");
    renderCampaign(updatedCampaign);
    wheel.style.transform = `rotate(${currentRotation}deg)`;
    setMessage("抽奖完成。", "success");
  }, 4200);
}

function setMessage(text, type) {
  message.textContent = text;
  message.className = `form-message ${type || ""}`.trim();
}
