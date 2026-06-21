import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import express from "express";
import multer from "multer";
import sharp from "sharp";

import {
  bulkGenerateCampaignCodes,
  createCampaign,
  deleteCampaign,
  generateCampaignCode,
  getCampaignByCode,
  listGlobalPrizes,
  listCampaigns,
  listDraws,
  openDatabase,
  performDraw,
  publicCampaign,
  replaceGlobalPrizes,
  updateCampaign
} from "./db.js";
import { sanitizeCode } from "./lottery.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const COOKIE_NAME = "lucky_admin";
const PRIZE_IMAGE_SIZE = 192;

export function createApp(options = {}) {
  const app = express();
  const databasePath =
    options.databasePath || process.env.DATABASE_PATH || join(projectRoot, "data", "app.db");
  const uploadDir =
    options.uploadDir || process.env.UPLOAD_DIR || join(projectRoot, "uploads");
  const publicDir = options.publicDir || join(projectRoot, "public");
  const adminDir = options.adminDir || join(projectRoot, "admin");
  const mode = options.mode || process.env.APP_MODE || "public";
  const publicEnabled = mode === "public" || mode === "all";
  const adminEnabled = mode === "admin" || mode === "all";
  const adminUser = options.adminUser || process.env.ADMIN_USER || "admin";
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || "admin";
  const sessionSecret =
    options.sessionSecret || process.env.SESSION_SECRET || "change-this-secret-in-production";

  mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(databasePath);
  const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (_request, file, callback) => {
      if (!file.mimetype.startsWith("image/")) {
        callback(new Error("Only image files can be uploaded."));
        return;
      }
      callback(null, true);
    },
    limits: {
      fileSize: 5 * 1024 * 1024
    }
  });

  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));
  app.use("/uploads", express.static(uploadDir));
  app.get("/styles.css", (_request, response) => {
    response.sendFile(join(publicDir, "styles.css"));
  });
  for (const iconFile of ["favicon.png", "favicon-32.png", "favicon.ico", "apple-touch-icon.png"]) {
    app.get(`/${iconFile}`, (_request, response) => {
      response.sendFile(join(publicDir, iconFile));
    });
  }

  if (publicEnabled) {
    app.use(express.static(publicDir));
  }

  if (adminEnabled) {
    if (!publicEnabled) {
      app.get("/", (_request, response) => {
        response.sendFile(join(adminDir, "admin.html"));
      });
    }
    app.use(express.static(adminDir));
  }

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  if (adminEnabled) {
    app.post("/api/admin/login", (request, response) => {
      const { username, password } = request.body ?? {};
      if (username !== adminUser || password !== adminPassword) {
        response.status(401).json({ error: "账号或密码错误。" });
        return;
      }

      response.cookie(COOKIE_NAME, createToken({ username }, sessionSecret), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 12
      });
      response.json({ user: { username } });
    });

    app.post("/api/admin/logout", requireAdmin(sessionSecret), (_request, response) => {
      response.clearCookie(COOKIE_NAME);
      response.json({ ok: true });
    });

    app.get("/api/admin/me", requireAdmin(sessionSecret), (request, response) => {
      response.json({ user: request.admin });
    });

    app.get("/api/admin/campaigns", requireAdmin(sessionSecret), (_request, response) => {
      response.json({ campaigns: listCampaigns(db) });
    });

    app.get("/api/admin/codes/generate", requireAdmin(sessionSecret), (_request, response) => {
      response.json({ code: generateCampaignCode(db) });
    });

    app.post("/api/admin/codes/bulk", requireAdmin(sessionSecret), (request, response, next) => {
      try {
        const campaigns = bulkGenerateCampaignCodes(db, request.body ?? {});
        response.status(201).json({ campaigns });
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/admin/prizes", requireAdmin(sessionSecret), (_request, response) => {
      response.json({ prizes: listGlobalPrizes(db) });
    });

    app.put("/api/admin/prizes", requireAdmin(sessionSecret), (request, response, next) => {
      try {
        response.json({ prizes: replaceGlobalPrizes(db, request.body ?? {}) });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/admin/campaigns", requireAdmin(sessionSecret), (request, response, next) => {
      try {
        const campaign = createCampaign(db, request.body ?? {});
        response.status(201).json({ campaign, prizes: campaign.prizes });
      } catch (error) {
        next(error);
      }
    });

    app.put("/api/admin/campaigns/:id", requireAdmin(sessionSecret), (request, response, next) => {
      try {
        const campaign = updateCampaign(db, Number(request.params.id), request.body ?? {});
        response.json({ campaign, prizes: campaign.prizes });
      } catch (error) {
        next(error);
      }
    });

    app.delete("/api/admin/campaigns/:id", requireAdmin(sessionSecret), (request, response, next) => {
      try {
        const deleted = deleteCampaign(db, Number(request.params.id));
        response.json({ deleted });
      } catch (error) {
        next(error);
      }
    });

    app.post(
      "/api/admin/upload",
      requireAdmin(sessionSecret),
      upload.single("image"),
      async (request, response, next) => {
        try {
          response.json({ image_url: await savePrizeImage(request.file, uploadDir) });
        } catch (error) {
          next(error);
        }
      }
    );

    app.get("/api/admin/draws", requireAdmin(sessionSecret), (_request, response) => {
      response.json({ draws: listDraws(db) });
    });
  }

  if (publicEnabled) {
    app.get("/api/public/prizes", (_request, response) => {
      response.json({ prizes: toPublicPrizes(listGlobalPrizes(db)) });
    });

    app.get("/api/public/campaigns/:code", (request, response, next) => {
      try {
        const campaign = toPublicCampaign(getCampaignByCode(db, request.params.code));
        response.json({ campaign, prizes: campaign.prizes });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/public/draw", (request, response, next) => {
      try {
        const result = performDraw(db, sanitizeCode(request.body?.code), {
          ip: request.ip,
          forwardedFor: request.get("x-forwarded-for") ?? "",
          userAgent: request.get("user-agent") ?? ""
        });

        response.json({
          prize: {
            id: result.prize.id,
            name: result.prize.name,
            image_url: publicUploadUrl(result.prize.image_url)
          },
          draw: {
            id: result.draw.id,
            created_at: result.draw.created_at
          },
          campaign: toPublicCampaign(result.campaign, { validate: false })
        });
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error, _request, response, _next) => {
    const statusCode = error.statusCode || (error.message?.includes("image") ? 400 : 500);
    response.status(statusCode).json({
      error: statusCode === 500 ? "Server failed to process the request. Please try again." : error.message
    });
  });

  return app;
}

async function savePrizeImage(file, uploadDir) {
  if (!file?.buffer) {
    const error = new Error("No image file was uploaded.");
    error.statusCode = 400;
    throw error;
  }

  const safeName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.webp`;
  const outputPath = join(uploadDir, safeName);

  try {
    await sharp(file.buffer)
      .rotate()
      .trim({ threshold: 12 })
      .resize(PRIZE_IMAGE_SIZE, PRIZE_IMAGE_SIZE, {
        fit: "cover",
        position: "center"
      })
      .webp({ quality: 86 })
      .toFile(outputPath);
  } catch {
    const error = new Error("The uploaded file could not be processed as an image.");
    error.statusCode = 400;
    throw error;
  }

  return `/uploads/${safeName}`;
}

function toPublicCampaign(campaign, options = {}) {
  const view = publicCampaign(campaign, options);
  return {
    ...view,
    prizes: toPublicPrizes(view.prizes ?? [])
  };
}

function toPublicPrizes(prizes) {
  return prizes.map(toPublicPrize);
}

function toPublicPrize(prize) {
  return {
    id: prize.id,
    name: prize.name,
    image_url: publicUploadUrl(prize.image_url),
    available:
      "available" in prize
        ? prize.available
        : prize.stock === null
          ? null
          : Math.max(0, prize.stock - prize.won_count)
  };
}

function publicUploadUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith("/uploads/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return raw;
  }

  return raw;
}

function requireAdmin(secret) {
  return (request, response, next) => {
    const token = readCookie(request.headers.cookie ?? "", COOKIE_NAME);
    const payload = token ? verifyToken(token, secret) : null;

    if (!payload) {
      response.status(401).json({ error: "请先登录后台。" });
      return;
    }

    request.admin = { username: payload.username };
    next();
  };
}

function createToken(payload, secret) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12
    })
  ).toString("base64url");
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

function verifyToken(token, secret) {
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(signature, sign(body, secret))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.username || payload.expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(cookieHeader, name) {
  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.env.APP_MODE || "public";
  const port = Number(process.env.PORT || (mode === "admin" ? 3001 : 3000));
  createApp({ mode }).listen(port, () => {
    console.log(`Lucky wheel ${mode} server is running on port ${port}`);
  });
}
