import express from "express";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import { exec as _exec } from "child_process";
import { promisify } from "util";

dotenv.config();
const exec = promisify(_exec);

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("tiny"));

const REQ_KEY = process.env.ORCH_API_KEY;
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || "/opt/synq/infra/workspaces";
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || "/opt/synq/infra/templates/rocketchat.compose.yml";
const VERCEL_WEBHOOK_URL = process.env.VERCEL_WEBHOOK_URL;
const JITSI_DOMAIN = process.env.JITSI_DOMAIN || "meet.jit.si";

function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!REQ_KEY || token !== REQ_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

function slugifyDomain(domain) {
  return (domain || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9.-]/g, "")
    .split(".")[0]; // leftmost label as slug
}

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.post("/api/workspaces", auth, async (req, res) => {
  try {
    const { plan, domain, adminEmail } = req.body || {};
    if (!domain || !adminEmail) return res.status(400).json({ error: "domain and adminEmail required" });
    const slug = slugifyDomain(domain);
    const dir = `${WORKSPACES_ROOT}/${slug}`;
    await fs.mkdir(dir, { recursive: true });

    const tpl = await fs.readFile(TEMPLATE_PATH, "utf8");
    const compose = tpl
      .replaceAll("${SLUG}", slug)
      .replaceAll("${FQDN}", domain)
      .replaceAll("${JITSI_DOMAIN}", JITSI_DOMAIN);

    await fs.writeFile(`${dir}/docker-compose.yml`, compose, "utf8");

    // Up the stack
    await exec(`docker compose -f ${dir}/docker-compose.yml up -d`);

    // Respond immediately
    res.status(201).json({ id: slug, status: "queued" });

    // Poll health then webhook
    await waitForHealth(domain);
    await postWebhook({
      id: slug,
      status: "ready",
      fqdn: domain,
      adminUrl: `https://${domain}/admin`,
      plan,
      adminEmail
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "provision_failed" });
  }
});

app.get("/api/workspaces/:id", auth, async (req, res) => {
  const id = req.params.id;
  try {
    // naive check: try to curl /api/info
    const domainGuess = `${id}.synq.team`;
    const ok = await checkInfo(domainGuess);
    res.json({ id, status: ok ? "ready" : "unknown" });
  } catch {
    res.json({ id, status: "unknown" });
  }
});

const port = process.env.PORT || 8081;
app.listen(port, () => console.log(`Orchestrator listening on :${port}`));

// Helpers
async function checkInfo(domain) {
  try {
    const { stdout } = await exec(
      `curl -sS --max-time 3 https://${domain}/api/info || true`
    );
    return stdout.includes('"success":true') || stdout.length > 0;
  } catch {
    return false;
  }
}

async function waitForHealth(domain, retries = 40, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    if (await checkInfo(domain)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function postWebhook(payload) {
  if (!VERCEL_WEBHOOK_URL) return;
  try {
    await exec(
      `curl -sS -X POST -H 'Content-Type: application/json' -d '${JSON.stringify(payload)}' '${VERCEL_WEBHOOK_URL}'`
    );
  } catch (e) {
    console.error("webhook failed", e?.message);
  }
}
