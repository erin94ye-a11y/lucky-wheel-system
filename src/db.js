import Database from "better-sqlite3";
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
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

export function generateCampaignCode(db) {
  return ensureUniqueCode(db, null);
}

export function listGlobalPrizes(db) {
  return db
    .prepare("SELECT * FROM global_prizes ORDER BY sort_order ASC, id ASC")
    .all()
    .map(serializeGlobalPrize);
}

export function replaceGlobalPrizes(db, input) {
  const transaction = db.transaction(() => {
    const prizes = normalizePrizeInput(input.prizes ?? []);
    db.prepare("DELETE FROM global_prizes").run();

    const insertPrize = db.prepare(`
      INSERT INTO global_prizes (name, image_url, probability, stock, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const prize of prizes) {
      insertPrize.run(
        prize.name,
        prize.image_url,
        prize.probability,
        prize.stock,
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
      created.push(getCampaignById(db, Number(result.lastInsertRowid)));
    }

    return created;
  });

  return transaction();
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
    const active = input.active === false || input.active === 0 || input.active === "0" ? 0 : 1;
    const expiresAt = input.expires_at ? String(input.expires_at) : null;
    const prizes = normalizePrizeInput(input.prizes ?? existing?.prizes ?? []);

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
      db.prepare("DELETE FROM prizes WHERE campaign_id = ?").run(id);
    } else {
      const result = db.prepare(`
        INSERT INTO campaigns (code, title, max_uses, active, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(code, title, maxUses, active, expiresAt);
      campaignId = Number(result.lastInsertRowid);
    }

    const insertPrize = db.prepare(`
      INSERT INTO prizes (campaign_id, name, image_url, probability, stock, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const prize of prizes) {
      insertPrize.run(
        campaignId,
        prize.name,
        prize.image_url,
        prize.probability,
        prize.stock,
        prize.sort_order
      );
    }

    return getCampaignById(db, campaignId);
  });

  return transaction();
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

    if (selectedPrize.pool === "global") {
      db.prepare("UPDATE global_prizes SET won_count = won_count + 1 WHERE id = ?").run(selectedPrize.id);
    } else {
      db.prepare("UPDATE prizes SET won_count = won_count + 1 WHERE id = ?").run(selectedPrize.id);
    }
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
    .prepare("SELECT * FROM prizes WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC")
    .all(campaignId)
    .map(serializePrize);
}

function listDrawablePrizesForCampaign(db, campaignId) {
  const globalPrizes = listGlobalPrizes(db);
  if (globalPrizes.length > 0) {
    return globalPrizes;
  }

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
  return {
    id: Number(prize.id),
    campaign_id: Number(prize.campaign_id),
    pool: "campaign",
    name: prize.name,
    image_url: prize.image_url,
    probability: Number(prize.probability),
    stock: prize.stock === null ? null : Number(prize.stock),
    won_count: Number(prize.won_count),
    sort_order: Number(prize.sort_order)
  };
}

function serializeGlobalPrize(prize) {
  return {
    id: Number(prize.id),
    campaign_id: null,
    pool: "global",
    name: prize.name,
    image_url: prize.image_url,
    probability: Number(prize.probability),
    stock: prize.stock === null ? null : Number(prize.stock),
    won_count: Number(prize.won_count),
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
