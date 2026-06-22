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

const VISITOR_TOKEN_STORAGE_KEY = "jump_quantum_visitor_token";

let activeCampaign = null;
let currentRotation = 0;
let isSpinning = false;
let visitorToken = readStoredVisitorToken();

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
    await reportVisitor({ code });
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
      body: JSON.stringify({
        code: activeCampaign.code,
        visitor_token: visitorToken
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to complete the draw. Please try again.");
    }
    if (data.visitor_token) {
      storeVisitorToken(data.visitor_token);
    }

    spinToPrize(data.prize, data.campaign);
  } catch (error) {
    setMessage(error.message, "error");
    spinButton.disabled = false;
    isSpinning = false;
  }
});

async function bootPublicPage() {
  void reportVisitor();
  await loadPrizePool();
  const initialCode = new URLSearchParams(window.location.search).get("code");
  if (initialCode) {
    codeInput.value = initialCode.trim().toUpperCase();
    codeForm.requestSubmit();
  }
}

async function reportVisitor(details = {}) {
  try {
    const visitorInfo = await collectVisitorInfo();
    const response = await fetch("/api/public/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitor_token: visitorToken,
        ...visitorInfo,
        ...details
      })
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    if (data.visitor_token) {
      storeVisitorToken(data.visitor_token);
    }
  } catch {
    // Visitor logging must never block the prize wheel experience.
  }
}

async function collectVisitorInfo() {
  const userAgent = navigator.userAgent || "";
  const language = navigator.language || navigator.languages?.[0] || "";
  let userAgentData = {};

  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      userAgentData = await navigator.userAgentData.getHighEntropyValues([
        "model",
        "platform",
        "platformVersion"
      ]);
    } catch {
      userAgentData = navigator.userAgentData || {};
    }
  }

  return {
    device_model: detectDeviceModel(userAgentData, userAgent),
    device_type: detectDeviceType(userAgentData, userAgent),
    system: detectSystem(userAgentData, userAgent),
    language
  };
}

function detectDeviceModel(userAgentData, userAgent) {
  if (userAgentData.model) {
    return userAgentData.model;
  }

  if (/iPhone/i.test(userAgent)) {
    return "iPhone";
  }
  if (/iPad/i.test(userAgent)) {
    return "iPad";
  }

  const androidModel = userAgent.match(/Android [^;)]*;\s*([^;)]+?)\s+Build/i);
  if (androidModel?.[1]) {
    return androidModel[1].trim();
  }

  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "Mac";
  }
  if (/Windows/i.test(userAgent)) {
    return "Windows PC";
  }
  if (/Linux/i.test(userAgent)) {
    return "Linux Device";
  }

  return "Unknown";
}

function detectDeviceType(userAgentData, userAgent) {
  if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) {
    return "Tablet";
  }

  if (userAgentData.mobile || /Mobi|Android|iPhone|iPod/i.test(userAgent)) {
    return "Mobile";
  }

  return "Desktop";
}

function detectSystem(userAgentData, userAgent) {
  const platform = userAgentData.platform || navigator.platform || "";

  const ios = userAgent.match(/(?:iPhone|iPad|iPod).*OS ([\d_]+)/i);
  if (ios?.[1]) {
    return `iOS ${ios[1].replace(/_/g, ".")}`;
  }

  const android = userAgent.match(/Android ([\d.]+)/i);
  if (android?.[1]) {
    return `Android ${android[1]}`;
  }

  const windows = userAgent.match(/Windows NT ([\d.]+)/i);
  if (windows?.[1]) {
    return windows[1] === "10.0" ? "Windows 10/11" : `Windows ${windows[1]}`;
  }

  const mac = userAgent.match(/Mac OS X ([\d_]+)/i);
  if (mac?.[1]) {
    return `macOS ${mac[1].replace(/_/g, ".")}`;
  }

  if (/Linux/i.test(userAgent)) {
    return "Linux";
  }

  return platform || "Unknown";
}

function readStoredVisitorToken() {
  try {
    return window.localStorage.getItem(VISITOR_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeVisitorToken(value) {
  visitorToken = value;
  try {
    window.localStorage.setItem(VISITOR_TOKEN_STORAGE_KEY, value);
  } catch {
    // Some embedded browsers disable local storage.
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
    const angle = index * slice + slice / 2 - 90;

    if (prize.image_url) {
      const imageMetrics = getWheelImageMetrics(prizes.length, angle, wheelLayout);
      const imageFrame = document.createElement("span");
      imageFrame.className = "wheel-prize-image";
      imageFrame.style.setProperty("--wheel-image-size", `${imageMetrics.size}px`);
      imageFrame.style.left = `${imageMetrics.x}px`;
      imageFrame.style.top = `${imageMetrics.y}px`;

      const image = document.createElement("img");
      image.src = prize.image_url;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      imageFrame.append(image);
      wheel.append(imageFrame);
    }

    const label = document.createElement("div");
    label.className = "wheel-label";
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

function getWheelImageMetrics(prizeCount, angle, layout) {
  const wheelRadius = layout.wheelRadius;
  const crowded = prizeCount >= 9;
  const imageSize = Math.round(
    clamp(wheelRadius * (crowded ? 0.34 : 0.36), crowded ? 60 : 64, crowded ? 78 : 90)
  );
  const maximumOffset = Math.max(wheelRadius * 0.45, wheelRadius - imageSize * 0.62 - 10);
  const centerOffset = Math.round(
    Math.min(Math.max(wheelRadius * (crowded ? 0.55 : 0.58), wheelRadius * 0.45), maximumOffset)
  );
  const radians = (angle * Math.PI) / 180;

  return {
    size: imageSize,
    x: Math.round(wheelRadius + Math.cos(radians) * centerOffset),
    y: Math.round(wheelRadius + Math.sin(radians) * centerOffset)
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
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
