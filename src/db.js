import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { generateCode, normalizePrizeInput, pickPrize, sanitizeCode } from "./lottery.js";

export function openDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      image_url TEXT,
      probability REAL NOT NULL,
      stock INTEGER,
      won_count INTEGER NOT NULL DEFAULT 0,
      inventory_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS global_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      image_url TEXT,
      probability REAL NOT NULL,
      stock INTEGER,
      won_count INTEGER NOT NULL DEFAULT 0,
      inventory_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prize_inventory (
      inventory_key TEXT PRIMARY KEY,
      stock INTEGER,
      won_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      prize_id INTEGER,
      prize_name TEXT NOT NULL,
      ip TEXT,
      forwarded_for TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS visits (
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
  `);

  ensureColumn(db, "prizes", "inventory_key", "TEXT");
  ensureColumn(db, "global_prizes", "inventory_key", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prizes_campaign_id ON prizes(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_draws_campaign_prize ON draws(campaign_id, prize_id);
    CREATE INDEX IF NOT EXISTS idx_prizes_inventory_key ON prizes(inventory_key);
    CREATE INDEX IF NOT EXISTS idx_global_prizes_inventory_key ON global_prizes(inventory_key);
  `);
  backfillInventoryKeys(db);
  backfillCampaignPrizeSnapshots(db);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function backfillInventoryKeys(db) {
  db.prepare(`
    UPDATE global_prizes
    SET inventory_key = lower(hex(randomblob(16)))
    WHERE inventory_key IS NULL OR trim(inventory_key) = ''
  `).run();

  for (const prize of db.prepare("SELECT * FROM global_prizes").all()) {
    upsertInventory(db, prize.inventory_key, prize.stock, prize.won_count);
  }

  db.prepare(`
    UPDATE prizes
    SET inventory_key = (
      SELECT global_prizes.inventory_key
      FROM global_prizes
      WHERE global_prizes.name = prizes.name
        AND global_prizes.sort_order = prizes.sort_order
      LIMIT 1
    )
    WHERE (inventory_key IS NULL OR trim(inventory_key) = '')
      AND EXISTS (
        SELECT 1
        FROM global_prizes
        WHERE global_prizes.name = prizes.name
          AND global_prizes.sort_order = prizes.sort_order
      )
  `).run();

  const unmatchedGroups = db.prepare(`
    SELECT name, sort_order
    FROM prizes
    WHERE inventory_key IS NULL OR trim(inventory_key) = ''
    GROUP BY name, sort_order
  `).all();
  const assignGroupInventory = db.prepare(`
    UPDATE prizes
    SET inventory_key = ?
    WHERE (inventory_key IS NULL OR trim(inventory_key) = '')
      AND name = ?
      AND sort_order = ?
  `);
  for (const group of unmatchedGroups) {
    assignGroupInventory.run(randomUUID(), group.name, group.sort_order);
  }

  db.prepare(`
    INSERT INTO prize_inventory (inventory_key, stock, won_count)
    SELECT inventory_key, MIN(stock), SUM(won_count)
    FROM prizes
    GROUP BY inventory_key
    ON CONFLICT(inventory_key) DO UPDATE SET
      won_count = MAX(prize_inventory.won_count, excluded.won_count),
      updated_at = datetime('now')
  `).run();
}

function backfillCampaignPrizeSnapshots(db) {
  return db.prepare(`
    INSERT INTO prizes (
      campaign_id,
      name,
      image_url,
      probability,
      stock,
      won_count,
      inventory_key,
      sort_order
    )
    SELECT
      campaigns.id,
      global_prizes.name,
      global_prizes.image_url,
      global_prizes.probability,
      global_prizes.stock,
      (
        SELECT COUNT(*)
        FROM draws
        WHERE draws.campaign_id = campaigns.id
          AND draws.prize_id = global_prizes.id
      ),
      global_prizes.inventory_key,
      global_prizes.sort_order
    FROM campaigns
    CROSS JOIN global_prizes
    WHERE NOT EXISTS (
      SELECT 1
      FROM prizes
      WHERE prizes.campaign_id = campaigns.id
    )
  `).run().changes;
}

export function listCampaigns(db) {
  const campaigns = db
    .prepare("SELECT * FROM campaigns ORDER BY created_at DESC, id DESC")
    .all()
    .map(serializeCampaign);

  return campaigns.map((campaign) => ({
    ...campaign,
    prizes: listPrizes(db, campaign.id)
  }));
}

export function getCampaignByCode(db, code) {
  const campaign = db
    .prepare("SELECT * FROM campaigns WHERE code = ?")
    .get(sanitizeCode(code));

  if (!campaign) {
    return null;
  }

  return {
    ...serializeCampaign(campaign),
    prizes: listDrawablePrizesForCampaign(db, campaign.id)
  };
}

export function getCampaignById(db, id) {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);

  if (!campaign) {
    return null;
  }

  return {
    ...serializeCampaign(campaign),
    prizes: listPrizes(db, campaign.id)
  };
}

export function createCampaign(db, input) {
  return saveCampaign(db, null, input);
}

export function updateCampaign(db, id, input) {
  return saveCampaign(db, id, input);
}

export function deleteCampaign(db, id) {
  const campaign = getCampaignById(db, id);
  if (!campaign) {
    const error = new Error("Campaign not found.");
    error.statusCode = 404;
    throw error;
  }

  db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  return campaign;
}

export function deleteAllCampaigns(db) {
  const transaction = db.transaction(() => db.prepare("DELETE FROM campaigns").run().changes);
  return transaction();
}

export function generateCampaignCode(db) {
  return ensureUniqueCode(db, null);
}

export function generateIndependentCampaignCode(db, input) {
  const prizes = resolveGeneratedPrizes(db, input.prizes ?? [], { seedWhenEmpty: true });
  return saveCampaign(db, null, {
    ...input,
    code: null,
    title: "Lucky Draw",
    prizes
  });
}

export function listGlobalPrizes(db) {
  return db
    .prepare(`
      SELECT
        global_prizes.*,
        prize_inventory.stock AS inventory_stock,
        prize_inventory.won_count AS inventory_won_count
      FROM global_prizes
      LEFT JOIN prize_inventory
        ON prize_inventory.inventory_key = global_prizes.inventory_key
      ORDER BY global_prizes.sort_order ASC, global_prizes.id ASC
    `)
    .all()
    .map(serializeGlobalPrize);
}

export function replaceGlobalPrizes(db, input) {
  const transaction = db.transaction(() => {
    const prizes = normalizePrizeInput(input.prizes ?? []);
    const existingPrizes = listGlobalPrizes(db);
    const existingByKey = new Map(
      existingPrizes.map((prize) => [prize.inventory_key, prize])
    );
    const existingByOrder = new Map(
      existingPrizes.map((prize) => [prize.sort_order, prize])
    );
    db.prepare("DELETE FROM global_prizes").run();

    const insertPrize = db.prepare(`
      INSERT INTO global_prizes (
        name,
        image_url,
        probability,
        stock,
        inventory_key,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const prize of prizes) {
      let inventoryKey = prize.inventory_key;
      if (inventoryKey && !existingByKey.has(inventoryKey)) {
        const error = new Error("The prize template changed. Refresh the admin page and try again.");
        error.statusCode = 400;
        throw error;
      }
      inventoryKey =
        inventoryKey || existingByOrder.get(prize.sort_order)?.inventory_key || randomUUID();
      upsertInventory(db, inventoryKey, prize.stock);
      insertPrize.run(
        prize.name,
        prize.image_url,
        prize.probability,
        prize.stock,
        inventoryKey,
        prize.sort_order
      );
    }

    return listGlobalPrizes(db);
  });

  return transaction();
}

export function bulkGenerateCampaignCodes(db, input) {
  const transaction = db.transaction(() => {
    const quantity = Number.parseInt(input.quantity ?? 1, 10);
    const title = "Lucky Draw";
    const maxUses = Number.parseInt(input.max_uses ?? 1, 10);
    const active = input.active === false || input.active === 0 || input.active === "0" ? 0 : 1;
    const expiresAt = input.expires_at ? String(input.expires_at) : null;
    const prizes = resolveGeneratedPrizes(db, input.prizes ?? listGlobalPrizes(db), {
      seedWhenEmpty: true
    });

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      const error = new Error("Quantity must be between 1 and 500.");
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isInteger(maxUses) || maxUses <= 0) {
      const error = new Error("Max uses must be greater than 0.");
      error.statusCode = 400;
      throw error;
    }

    const insertCampaign = db.prepare(`
      INSERT INTO campaigns (code, title, max_uses, active, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const created = [];

    for (let index = 0; index < quantity; index += 1) {
      const code = ensureUniqueCode(db, null);
      const result = insertCampaign.run(code, title, maxUses, active, expiresAt);
      const campaignId = Number(result.lastInsertRowid);
      replaceCampaignPrizes(db, campaignId, prizes);
      created.push(getCampaignById(db, campaignId));
    }

    return created;
  });

  return transaction();
}

function resolveGeneratedPrizes(db, inputPrizes, options = {}) {
  const submittedPrizes = normalizePrizeInput(inputPrizes);
  let templatePrizes = listGlobalPrizes(db);

  if (!templatePrizes.length && options.seedWhenEmpty) {
    templatePrizes = replaceGlobalPrizes(db, { prizes: submittedPrizes });
  }

  const templateByKey = new Map(
    templatePrizes.map((prize) => [prize.inventory_key, prize])
  );
  const resolvedPrizes = submittedPrizes.map((prize) => {
    let templatePrize = null;
    if (prize.inventory_key) {
      templatePrize = templateByKey.get(prize.inventory_key) ?? null;
      if (!templatePrize) {
        const error = new Error("The prize template changed. Refresh the admin page and try again.");
        error.statusCode = 400;
        throw error;
      }
    } else {
      templatePrize = templatePrizes.find(
        (candidate) =>
          candidate.sort_order === prize.sort_order && candidate.name === prize.name
      ) ?? null;
    }

    if (!templatePrize) {
      const error = new Error("Each generated code must use a prize from the saved template.");
      error.statusCode = 400;
      throw error;
    }

    return {
      name: templatePrize.name,
      image_url: templatePrize.image_url,
      probability: prize.probability,
      stock: templatePrize.stock,
      won_count: templatePrize.won_count,
      inventory_key: templatePrize.inventory_key,
      sort_order: templatePrize.sort_order
    };
  });

  const hasAvailablePrize = resolvedPrizes.some(
    (prize) =>
      prize.probability > 0 &&
      (prize.stock === null || prize.won_count < prize.stock)
  );
  if (!hasAvailablePrize) {
    const error = new Error("At least one positive-probability prize must have available inventory.");
    error.statusCode = 400;
    throw error;
  }

  return resolvedPrizes;
}

function saveCampaign(db, id, input) {
  const transaction = db.transaction(() => {
    const existing = id ? getCampaignById(db, id) : null;
    if (id && !existing) {
      const error = new Error("Campaign not found.");
      error.statusCode = 404;
      throw error;
    }

    const code = ensureUniqueCode(db, input.code || existing?.code, id);
    const title = String(input.title ?? existing?.title ?? "Lucky Draw").trim() || "Lucky Draw";
    const maxUses = Number.parseInt(input.max_uses ?? existing?.max_uses ?? 1, 10);
    const activeValue = input.active ?? existing?.active ?? true;
    const active = activeValue === false || activeValue === 0 || activeValue === "0" ? 0 : 1;
    const expiresValue = Object.hasOwn(input, "expires_at")
      ? input.expires_at
      : existing?.expires_at;
    const expiresAt = expiresValue ? String(expiresValue) : null;
    const shouldReplacePrizes = !id || Object.hasOwn(input, "prizes");
    const prizes = shouldReplacePrizes ? normalizePrizeInput(input.prizes ?? []) : null;

    if (!Number.isInteger(maxUses) || maxUses <= 0) {
      const error = new Error("Max uses must be greater than 0.");
      error.statusCode = 400;
      throw error;
    }

    let campaignId = id;
    if (id) {
      db.prepare(`
        UPDATE campaigns
        SET code = ?, title = ?, max_uses = ?, active = ?, expires_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(code, title, maxUses, active, expiresAt, id);
      if (shouldReplacePrizes) {
        db.prepare("DELETE FROM prizes WHERE campaign_id = ?").run(id);
      }
    } else {
      const result = db.prepare(`
        INSERT INTO campaigns (code, title, max_uses, active, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(code, title, maxUses, active, expiresAt);
      campaignId = Number(result.lastInsertRowid);
    }

    if (shouldReplacePrizes) {
      insertCampaignPrizes(db, campaignId, prizes);
    }

    return getCampaignById(db, campaignId);
  });

  return transaction();
}

function replaceCampaignPrizes(db, campaignId, inputPrizes) {
  const prizes = normalizePrizeInput(inputPrizes ?? []);
  db.prepare("DELETE FROM prizes WHERE campaign_id = ?").run(campaignId);
  insertCampaignPrizes(db, campaignId, prizes);
}

function insertCampaignPrizes(db, campaignId, prizes) {
  const insertPrize = db.prepare(`
    INSERT INTO prizes (
      campaign_id,
      name,
      image_url,
      probability,
      stock,
      inventory_key,
      sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const prize of prizes) {
    const inventoryKey = prize.inventory_key || randomUUID();
    upsertInventory(db, inventoryKey, prize.stock, 0, false);
    insertPrize.run(
      campaignId,
      prize.name,
      prize.image_url,
      prize.probability,
      prize.stock,
      inventoryKey,
      prize.sort_order
    );
  }
}

function upsertInventory(db, inventoryKey, stock, wonCount = 0, updateStock = true) {
  db.prepare(`
    INSERT INTO prize_inventory (inventory_key, stock, won_count)
    VALUES (?, ?, ?)
    ON CONFLICT(inventory_key) DO UPDATE SET
      stock = CASE WHEN ? THEN excluded.stock ELSE prize_inventory.stock END,
      won_count = MAX(prize_inventory.won_count, excluded.won_count),
      updated_at = datetime('now')
  `).run(inventoryKey, stock, Number(wonCount ?? 0), updateStock ? 1 : 0);
}

function ensureUniqueCode(db, requestedCode, campaignId = null) {
  let code = sanitizeCode(requestedCode);
  if (!code) {
    code = generateCode();
  }

  for (let attempts = 0; attempts < 20; attempts += 1) {
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE code = ?")
      .get(code);

    if (!existing || Number(existing.id) === Number(campaignId)) {
      return code;
    }

    if (requestedCode) {
      const error = new Error("This lottery code already exists.");
      error.statusCode = 409;
      throw error;
    }

    code = generateCode();
  }

  const error = new Error("Could not generate a unique lottery code.");
  error.statusCode = 500;
  throw error;
}

export function performDraw(db, code, requestMeta) {
  const transaction = db.transaction(() => {
    const campaign = getCampaignByCode(db, code);
    validateDrawableCampaign(campaign);

    let selectedPrize;
    try {
      selectedPrize = pickPrize(campaign.prizes);
    } catch {
      const error = new Error("Prize inventory is sold out. Please contact the campaign administrator.");
      error.statusCode = 400;
      throw error;
    }

    const inventoryUpdate = db.prepare(`
      UPDATE prize_inventory
      SET won_count = won_count + 1, updated_at = datetime('now')
      WHERE inventory_key = ?
        AND (stock IS NULL OR won_count < stock)
    `).run(selectedPrize.inventory_key);
    if (inventoryUpdate.changes !== 1) {
      const error = new Error("Prize inventory is sold out. Please contact the campaign administrator.");
      error.statusCode = 400;
      throw error;
    }
    db.prepare("UPDATE prizes SET won_count = won_count + 1 WHERE id = ?").run(selectedPrize.id);
    db.prepare(`
      UPDATE campaigns
      SET used_count = used_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(campaign.id);

    const result = db.prepare(`
      INSERT INTO draws (campaign_id, code, prize_id, prize_name, ip, forwarded_for, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      campaign.code,
      selectedPrize.id,
      selectedPrize.name,
      requestMeta.ip,
      requestMeta.forwardedFor,
      requestMeta.userAgent
    );

    return {
      draw: getDrawById(db, Number(result.lastInsertRowid)),
      prize: selectedPrize,
      campaign: getCampaignByCode(db, campaign.code)
    };
  });

  return transaction();
}

export function validateDrawableCampaign(campaign) {
  if (!campaign) {
    const error = new Error("Lottery code not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!campaign.active) {
    const error = new Error("This lottery code is not active yet.");
    error.statusCode = 400;
    throw error;
  }

  if (campaign.expires_at && new Date(campaign.expires_at).getTime() < Date.now()) {
    const error = new Error("This lottery code has expired.");
    error.statusCode = 400;
    throw error;
  }

  if (campaign.used_count >= campaign.max_uses) {
    const error = new Error("This lottery code has no spins left.");
    error.statusCode = 400;
    throw error;
  }

  return campaign;
}

export function listDraws(db, limit = 100) {
  return db
    .prepare(`
      SELECT draws.*, campaigns.title AS campaign_title
      FROM draws
      JOIN campaigns ON campaigns.id = draws.campaign_id
      ORDER BY draws.created_at DESC, draws.id DESC
      LIMIT ?
    `)
    .all(limit)
    .map(serializeDraw);
}

export function recordVisit(db, input = {}) {
  const visitorToken = sanitizeVisitorToken(input.visitor_token);
  if (!visitorToken) {
    const error = new Error("Visitor token is required.");
    error.statusCode = 400;
    throw error;
  }

  const visit = {
    visitor_token: visitorToken,
    code: emptyToNull(sanitizeCode(input.code)),
    ip: emptyToNull(limitText(input.ip, 120)),
    forwarded_for: emptyToNull(limitText(input.forwarded_for, 240)),
    user_agent: emptyToNull(limitText(input.user_agent, 600)),
    device_model: emptyToNull(limitText(input.device_model, 160)),
    device_type: emptyToNull(limitText(input.device_type, 60)),
    system: emptyToNull(limitText(input.system, 120)),
    language: emptyToNull(limitText(input.language, 120))
  };

  db.prepare(`
    INSERT INTO visits (
      visitor_token,
      code,
      ip,
      forwarded_for,
      user_agent,
      device_model,
      device_type,
      system,
      language
    )
    VALUES (
      @visitor_token,
      @code,
      @ip,
      @forwarded_for,
      @user_agent,
      @device_model,
      @device_type,
      @system,
      @language
    )
    ON CONFLICT(visitor_token) DO UPDATE SET
      code = COALESCE(excluded.code, visits.code),
      ip = COALESCE(excluded.ip, visits.ip),
      forwarded_for = COALESCE(excluded.forwarded_for, visits.forwarded_for),
      user_agent = COALESCE(excluded.user_agent, visits.user_agent),
      device_model = COALESCE(excluded.device_model, visits.device_model),
      device_type = COALESCE(excluded.device_type, visits.device_type),
      system = COALESCE(excluded.system, visits.system),
      language = COALESCE(excluded.language, visits.language),
      updated_at = datetime('now')
  `).run(visit);

  return getVisitByToken(db, visitorToken);
}

export function listVisits(db, limit = 100) {
  return db
    .prepare(`
      SELECT *
      FROM visits
      WHERE code IS NOT NULL AND trim(code) <> ''
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .all(limit)
    .map(serializeVisit);
}

function getDrawById(db, id) {
  return serializeDraw(
    db
      .prepare(`
        SELECT draws.*, campaigns.title AS campaign_title
        FROM draws
        JOIN campaigns ON campaigns.id = draws.campaign_id
        WHERE draws.id = ?
      `)
      .get(id)
  );
}

function getVisitByToken(db, visitorToken) {
  return serializeVisit(db.prepare("SELECT * FROM visits WHERE visitor_token = ?").get(visitorToken));
}

function listPrizes(db, campaignId) {
  return db
    .prepare(`
      SELECT
        prizes.*,
        prize_inventory.stock AS inventory_stock,
        prize_inventory.won_count AS inventory_won_count
      FROM prizes
      LEFT JOIN prize_inventory
        ON prize_inventory.inventory_key = prizes.inventory_key
      WHERE prizes.campaign_id = ?
      ORDER BY prizes.sort_order ASC, prizes.id ASC
    `)
    .all(campaignId)
    .map(serializePrize);
}

function listDrawablePrizesForCampaign(db, campaignId) {
  return listPrizes(db, campaignId);
}

export function publicCampaign(campaign, options = {}) {
  if (options.validate !== false) {
    validateDrawableCampaign(campaign);
  }

  return {
    id: campaign.id,
    code: campaign.code,
    max_uses: campaign.max_uses,
    used_count: campaign.used_count,
    expires_at: campaign.expires_at,
    prizes: campaign.prizes.map((prize) => ({
      id: prize.id,
      name: prize.name,
      image_url: prize.image_url,
      available: prize.stock === null ? null : Math.max(0, prize.stock - prize.won_count)
    }))
  };
}

function serializeCampaign(campaign) {
  return {
    id: Number(campaign.id),
    code: campaign.code,
    title: campaign.title,
    max_uses: Number(campaign.max_uses),
    used_count: Number(campaign.used_count),
    active: Boolean(campaign.active),
    expires_at: campaign.expires_at,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at
  };
}

function serializePrize(prize) {
  const inventoryStock = Object.hasOwn(prize, "inventory_stock")
    ? prize.inventory_stock
    : prize.stock;
  return {
    id: Number(prize.id),
    campaign_id: Number(prize.campaign_id),
    pool: "campaign",
    name: prize.name,
    image_url: prize.image_url,
    probability: Number(prize.probability),
    stock: inventoryStock === null ? null : Number(inventoryStock),
    won_count: Number(prize.inventory_won_count ?? prize.won_count),
    inventory_key: prize.inventory_key,
    sort_order: Number(prize.sort_order)
  };
}

function serializeGlobalPrize(prize) {
  const inventoryStock = Object.hasOwn(prize, "inventory_stock")
    ? prize.inventory_stock
    : prize.stock;
  return {
    id: Number(prize.id),
    campaign_id: null,
    pool: "global",
    name: prize.name,
    image_url: prize.image_url,
    probability: Number(prize.probability),
    stock: inventoryStock === null ? null : Number(inventoryStock),
    won_count: Number(prize.inventory_won_count ?? prize.won_count),
    inventory_key: prize.inventory_key,
    sort_order: Number(prize.sort_order)
  };
}

function serializeDraw(draw) {
  return {
    id: Number(draw.id),
    campaign_id: Number(draw.campaign_id),
    campaign_title: draw.campaign_title,
    code: draw.code,
    prize_id: draw.prize_id === null ? null : Number(draw.prize_id),
    prize_name: draw.prize_name,
    ip: draw.ip,
    forwarded_for: draw.forwarded_for,
    user_agent: draw.user_agent,
    created_at: draw.created_at
  };
}

function serializeVisit(visit) {
  return {
    id: Number(visit.id),
    visitor_token: visit.visitor_token,
    code: visit.code || "",
    ip: visit.ip || "",
    forwarded_for: visit.forwarded_for || "",
    ip_address: visit.forwarded_for || visit.ip || "",
    user_agent: visit.user_agent || "",
    device_model: visit.device_model || "",
    device_type: visit.device_type || "",
    system: visit.system || "",
    language: visit.language || "",
    created_at: visit.created_at,
    updated_at: visit.updated_at
  };
}

function sanitizeVisitorToken(value) {
  return limitText(value, 160).replace(/[^\w.-]/g, "");
}

function limitText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function emptyToNull(value) {
  return value ? value : null;
}
