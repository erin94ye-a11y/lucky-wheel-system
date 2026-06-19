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
  setMessage("Checking your code...", "");
  resultPanel.classList.add("is-hidden");

  try {
    const code = codeInput.value.trim().toUpperCase();
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
    label.style.setProperty("--label-x", `${labelMetrics.x}px`);
    label.style.setProperty("--label-y", `${labelMetrics.y}px`);
    label.style.setProperty("--label-width", `${labelMetrics.width}px`);
    label.style.setProperty("--label-font-size", `${labelMetrics.fontSize}px`);

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
  const buttonRect = spinButton.getBoundingClientRect();
  const wheelSize = wheelRect.width || wheel.offsetWidth || wheel.clientWidth || 320;
  const wheelRadius = wheelSize / 2;
  const wheelCenterX = wheelRect.left + wheelRadius;
  const wheelCenterY = wheelRect.top + wheelRadius;

  return {
    wheelRadius,
    button: {
      left: buttonRect.left - wheelCenterX,
      right: buttonRect.right - wheelCenterX,
      top: buttonRect.top - wheelCenterY,
      bottom: buttonRect.bottom - wheelCenterY
    }
  };
}

function getWheelLabelLines(name, prizeCount) {
  const label = String(name || "").trim() || "Prize";
  const words = label.split(/\s+/).filter(Boolean);
  if (prizeCount < 7 || words.length <= 1) {
    return [label];
  }

  if (prizeCount >= 9) {
    return words.length <= 3 ? words : [words.slice(0, 2).join(" "), words.slice(2).join(" ")];
  }

  return words.length <= 2 ? words : [words.slice(0, -1).join(" "), words.at(-1)];
}

function getWheelLabelMetrics(lines, prizeCount, angle, layout) {
  const wheelRadius = layout.wheelRadius;
  const crowded = prizeCount >= 9;
  const dense = prizeCount >= 7;
  const fontSize = getWheelLabelFontSize(lines, prizeCount);
  const longestLine = Math.max(...lines.map((line) => line.length));
  const width = Math.round(
    Math.min(
      crowded ? 76 : dense ? 102 : 130,
      Math.max(crowded ? 48 : 64, longestLine * fontSize * 0.66 + 10)
    )
  );
  const labelHeight = lines.length * fontSize * 1.04 + Math.max(0, lines.length - 1) * 1;
  const margin = crowded ? 10 : dense ? 18 : 24;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const maximumXDistance = Math.abs(cos) > 0.04 ? (wheelRadius - width / 2 - margin) / Math.abs(cos) : Number.POSITIVE_INFINITY;
  const maximumYDistance = Math.abs(sin) > 0.04 ? (wheelRadius - labelHeight / 2 - margin) / Math.abs(sin) : Number.POSITIVE_INFINITY;
  const minimumDistance = wheelRadius * (crowded ? 0.46 : dense ? 0.42 : 0.36);
  const preferredDistance = wheelRadius * (crowded ? 0.66 : dense ? 0.54 : 0.5);
  const maximumDistance = Math.max(minimumDistance, Math.min(maximumXDistance, maximumYDistance));
  let distance = Math.min(Math.max(preferredDistance, minimumDistance), maximumDistance);

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const rect = getLabelRect(cos, sin, distance, width, labelHeight);
    if (!rectIntersects(rect, expandRect(layout.button, crowded ? 8 : 10))) {
      break;
    }
    distance = Math.min(maximumDistance, distance + 3);
  }

  return {
    fontSize,
    width,
    x: Math.round(cos * distance),
    y: Math.round(sin * distance)
  };
}

function getLabelRect(cos, sin, distance, width, height) {
  const x = cos * distance;
  const y = sin * distance;
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2
  };
}

function expandRect(rect, padding) {
  return {
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding
  };
}

function rectIntersects(first, second) {
  return !(first.right <= second.left || first.left >= second.right || first.bottom <= second.top || first.top >= second.bottom);
}

function getWheelLabelFontSize(lines, prizeCount) {
  const length = lines.join("").length;
  if (prizeCount >= 9) {
    return length > 14 ? 12 : 13;
  }

  if (prizeCount >= 7) {
    return length > 16 ? 13 : 15;
  }

  return length > 18 ? 14 : 17;
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
    setMessage("Spin complete.", "success");
  }, 4200);
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
