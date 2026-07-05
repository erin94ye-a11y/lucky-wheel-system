import crypto from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(length = 8) {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    const randomIndex = crypto.randomInt(0, CODE_ALPHABET.length);
    code += CODE_ALPHABET[randomIndex];
  }
  return code;
}

export function normalizePrizeInput(prizes) {
  if (!Array.isArray(prizes)) {
    throw new Error("Prizes must be an array.");
  }

  const normalized = prizes.map((prize, index) => {
    const name = String(prize.name ?? "").trim();
    const probability = Number(prize.probability);
    const rawStock = prize.stock === "" || prize.stock === undefined ? null : prize.stock;
    const stock = rawStock === null ? null : Number.parseInt(rawStock, 10);
    const imageUrl = String(prize.image_url ?? prize.imageUrl ?? "").trim();

    if (!name) {
      throw new Error(`Prize ${index + 1} needs a name.`);
    }

    if (!Number.isFinite(probability) || probability < 0) {
      throw new Error(`Prize ${name} needs a non-negative probability.`);
    }

    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      throw new Error(`Prize ${name} needs stock greater than or equal to 0.`);
    }

    return {
      name,
      probability,
      stock,
      image_url: imageUrl,
      sort_order: Number.isInteger(prize.sort_order) ? prize.sort_order : index
    };
  });

  if (visiblePrizes(normalized).length === 0) {
    throw new Error("At least one prize must have positive probability and available stock.");
  }

  return normalized;
}

export function visiblePrizes(prizes) {
  return prizes.filter((prize) => {
    const probability = Number(prize.probability);
    const stock = prize.stock === undefined ? null : prize.stock;
    const wonCount = Number(prize.won_count ?? 0);

    if (!Number.isFinite(probability) || probability <= 0) {
      return false;
    }

    if (stock === null || stock === undefined) {
      return true;
    }

    return wonCount < Number(stock);
  });
}

export function pickPrize(prizes, random = Math.random) {
  const drawable = visiblePrizes(prizes);

  if (drawable.length === 0) {
    throw new Error("No drawable prizes are available.");
  }

  const totalWeight = drawable.reduce((sum, prize) => sum + Number(prize.probability), 0);
  let cursor = random() * totalWeight;

  for (const prize of drawable) {
    cursor -= Number(prize.probability);
    if (cursor < 0) {
      return prize;
    }
  }

  return drawable[drawable.length - 1];
}

export function sanitizeCode(input) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
