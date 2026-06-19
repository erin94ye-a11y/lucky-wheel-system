const codeForm = document.querySelector("#codeForm");
const codeInput = document.querySelector("#codeInput");
const message = document.querySelector("#message");
const welcomeStage = document.querySelector("#welcomeStage");
const wheelStage = document.querySelector("#wheelStage");
const wheel = document.querySelector("#wheel");
const spinButton = document.querySelector("#spinButton");
const campaignTitle = document.querySelector("#campaignTitle");
const resultPanel = document.querySelector("#resultPanel");
const resultImage = document.querySelector("#resultImage");
const resultName = document.querySelector("#resultName");

const segmentColors = [
  "#e23d57",
  "#078f8a",
  "#1d3557",
  "#f5b942",
  "#8e5cf4",
  "#f97316",
  "#2f80ed",
  "#16a34a",
  "#6d5dfc"
];

let activeCampaign = null;
let currentRotation = 0;
let isSpinning = false;

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultPanel.classList.add("is-hidden");

  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    codeInput.setAttribute("aria-invalid", "true");
    codeInput.focus();
    setMessage("Please enter your code.", "error");
    return;
  }

  codeInput.removeAttribute("aria-invalid");
  setMessage("Checking your code...", "");

  try {
    const response = await fetch(`/api/public/campaigns/${encodeURIComponent(code)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "This code is not available.");
    }

    activeCampaign = data.campaign;
    renderCampaign(activeCampaign);
    setMessage("Code verified. Your spin is ready.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
});

spinButton.addEventListener("click", async () => {
  if (!activeCampaign || isSpinning) {
    return;
  }

  isSpinning = true;
  spinButton.disabled = true;
  resultPanel.classList.add("is-hidden");
  setMessage("Spinning...", "");

  try {
    const response = await fetch("/api/public/draw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: activeCampaign.code })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to complete the draw. Please try again.");
    }

    spinToPrize(data.prize, data.campaign);
  } catch (error) {
    setMessage(error.message, "error");
    spinButton.disabled = false;
    isSpinning = false;
  }
});

async function bootPublicPage() {
  await loadPrizePool();
  const initialCode = new URLSearchParams(window.location.search).get("code");
  if (initialCode) {
    codeInput.value = initialCode.trim().toUpperCase();
    codeForm.requestSubmit();
  }
}

async function loadPrizePool() {
  try {
    const response = await fetch("/api/public/prizes");
    const data = await response.json();
    if (!response.ok || !data.prizes?.length) {
      renderStaticPrizePool(defaultPrizePool());
      return;
    }

    renderStaticPrizePool(data.prizes);
  } catch {
    renderStaticPrizePool(defaultPrizePool());
  }
}

function renderStaticPrizePool(prizes) {
  activeCampaign = null;
  campaignTitle.textContent = "Prize Wheel";
  welcomeStage.classList.add("is-hidden");
  wheelStage.classList.remove("is-hidden");
  spinButton.disabled = true;
  spinButton.textContent = "Enter Code";
  renderWheel(prizes);
}

function renderCampaign(campaign) {
  activeCampaign = campaign;
  const remaining = Math.max(0, campaign.max_uses - campaign.used_count);
  campaignTitle.textContent = "Prize Wheel";
  welcomeStage.classList.add("is-hidden");
  wheelStage.classList.remove("is-hidden");
  spinButton.disabled = remaining <= 0;
  spinButton.textContent = remaining <= 0 ? "Used" : "Spin Now";
  isSpinning = false;

  const prizes = campaign.prizes.length ? campaign.prizes : [{ name: "No prizes yet" }];
  renderWheel(prizes);
}

function renderWheel(prizes) {
  const slice = 360 / prizes.length;
  const dense = prizes.length >= 7;
  const crowded = prizes.length >= 9;
  const gradient = prizes
    .map((_, index) => {
      const color = segmentColors[index % segmentColors.length];
      return `${color} ${index * slice}deg ${(index + 1) * slice}deg`;
    })
    .join(", ");

  wheel.style.background = `conic-gradient(from -90deg, ${gradient})`;
  wheel.classList.toggle("is-dense", dense);
  wheel.classList.toggle("is-crowded", crowded);
  wheel.innerHTML = "";

  const wheelLayout = getWheelLayout();
  prizes.forEach((prize, index) => {
    const label = document.createElement("div");
    label.className = "wheel-label";
    const angle = index * slice + slice / 2 - 90;
    const nameLines = getWheelLabelLines(prize.name, prizes.length);
    const labelMetrics = getWheelLabelMetrics(nameLines, prizes.length, angle, wheelLayout);
    label.style.setProperty("--label-width", `${labelMetrics.width}px`);
    label.style.setProperty("--label-track-width", `${labelMetrics.trackWidth}px`);
    label.style.setProperty("--label-track-height", `${labelMetrics.trackHeight}px`);
    label.style.setProperty("--label-track-offset", `${labelMetrics.trackOffset}px`);
    label.style.setProperty("--label-rotation", `${labelMetrics.rotation}deg`);
    label.style.setProperty("--label-text-rotation", `${labelMetrics.textRotation}deg`);
    label.style.setProperty("--label-font-size", `${labelMetrics.fontSize}px`);
    label.classList.toggle("is-flipped", labelMetrics.isFlipped);

    if (prize.image_url) {
      const image = document.createElement("img");
      image.src = prize.image_url;
      image.alt = "";
      label.append(image);
    }

    const name = document.createElement("span");
    name.className = "wheel-label-text";
    for (const line of nameLines) {
      const lineNode = document.createElement("span");
      lineNode.className = "wheel-label-line";
      lineNode.textContent = line;
      name.append(lineNode);
    }
    label.append(name);
    wheel.append(label);
  });
}

function getWheelLayout() {
  const wheelRect = wheel.getBoundingClientRect();
  const wheelSize = wheelRect.width || wheel.offsetWidth || wheel.clientWidth || 320;
  const wheelRadius = wheelSize / 2;

  return {
    wheelRadius
  };
}

function getWheelLabelLines(name, prizeCount) {
  const label = String(name || "").trim() || "Prize";
  const words = label.split(/\s+/).filter(Boolean);
  if (label.length <= 18 || words.length <= 1) {
    return [label];
  }

  if (prizeCount >= 9) {
    return [words.slice(0, -1).join(" "), words.at(-1)];
  }

  return words.length <= 2 ? words : [words.slice(0, -1).join(" "), words.at(-1)];
}

function getWheelLabelMetrics(lines, prizeCount, angle, layout) {
  const wheelRadius = layout.wheelRadius;
  const crowded = prizeCount >= 9;
  const dense = prizeCount >= 7;
  const centerClearance = Math.max(wheelRadius * (crowded ? 0.24 : dense ? 0.23 : 0.22), 42);
  const innerGap = crowded ? 8 : dense ? 10 : 14;
  const outerGap = crowded ? 16 : dense ? 20 : 26;
  const trackOffset = Math.round(centerClearance + innerGap);
  const trackWidth = Math.round(Math.max(72, wheelRadius - outerGap - trackOffset));
  const fontSize = getWheelLabelFontSize(lines, prizeCount, trackWidth);
  const trackHeight = Math.round(lines.length * fontSize * 1.1 + Math.max(0, lines.length - 1) * 2);
  const normalizedAngle = normalizeDegrees(angle);
  const isFlipped = normalizedAngle > 90 && normalizedAngle < 270;

  return {
    fontSize,
    isFlipped,
    rotation: Number(angle.toFixed(3)),
    textRotation: isFlipped ? 180 : 0,
    trackHeight,
    trackOffset,
    trackWidth,
    width: trackWidth
  };
}

function getWheelLabelFontSize(lines, prizeCount, trackWidth) {
  const length = lines.join("").length;
  const longestLine = Math.max(...lines.map((line) => line.length));
  const maxByTrack = Math.floor((trackWidth - 4) / Math.max(1, longestLine * 0.62));
  const minimumSize = prizeCount >= 9 ? 10 : 12;
  const maximumSize = prizeCount >= 9 ? 15 : prizeCount >= 7 ? 16 : 18;
  let preferredSize = maximumSize;

  if (prizeCount >= 9) {
    preferredSize = length > 14 ? 12 : 14;
  } else if (prizeCount >= 7) {
    preferredSize = length > 16 ? 13 : 15;
  } else {
    preferredSize = length > 18 ? 14 : 17;
  }

  return Math.max(minimumSize, Math.min(preferredSize, maximumSize, maxByTrack));
}

function spinToPrize(prize, updatedCampaign) {
  const prizes = activeCampaign.prizes;
  const targetRotation = getSpinRotation(prizes, prize, currentRotation);

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
    setMessage("Spin complete.", "success");
  }, 4200);
}

function getSpinRotation(prizes, prize, rotation) {
  const selectedIndex = Math.max(
    0,
    prizes.findIndex((item) => item.id === prize.id || item.name === prize.name)
  );
  const slice = 360 / prizes.length;
  const segmentCenter = selectedIndex * slice + slice / 2;
  const desiredRotation = normalizeDegrees(-segmentCenter);
  const normalizedRotation = normalizeDegrees(rotation);
  const delta = normalizeDegrees(desiredRotation - normalizedRotation);
  return rotation + 2160 + delta;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function setMessage(text, type) {
  message.textContent = text;
  message.className = `form-message ${type || ""}`.trim();
}

function defaultPrizePool() {
  return [
    { name: "Grand Prize", image_url: "", available: null },
    { name: "$100 Gift Card", image_url: "", available: null },
    { name: "Bluetooth Speaker", image_url: "", available: null },
    { name: "Coffee Voucher", image_url: "", available: null },
    { name: "VIP Upgrade", image_url: "", available: null },
    { name: "Movie Tickets", image_url: "", available: null },
    { name: "Merch Bundle", image_url: "", available: null },
    { name: "Bonus Entry", image_url: "", available: null },
    { name: "Try Again", image_url: "", available: null }
  ];
}

bootPublicPage();
