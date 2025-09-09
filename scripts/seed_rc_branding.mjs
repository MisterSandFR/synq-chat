#!/usr/bin/env node
import fetch from "node-fetch";

const base = process.argv[2]; // e.g. https://acme.synq.team
const adminUser = process.argv[3] || "admin";
const adminPass = process.argv[4] || "changeme";
if (!base) {
  console.log("Usage: seed_rc_branding.mjs <BASE_URL> [ADMIN_USER] [ADMIN_PASS]");
  process.exit(1);
}

const j = (p, o={}) => fetch(`${base}${p}`, {
  ...o,
  headers: { "Content-Type":"application/json", ...(o.headers||{}) }
}).then(r=>r.json());

(async () => {
  // login
  const login = await j("/api/v1/login", { method:"POST", body: JSON.stringify({ user: adminUser, password: adminPass }) });
  if (!login?.data?.authToken) {
    console.error("Login failed", login);
    process.exit(2);
  }
  const H = { "X-Auth-Token": login.data.authToken, "X-User-Id": login.data.userId };

  // helper to set setting
  const set = async (k, v) =>
    j(`/api/v1/settings/${encodeURIComponent(k)}`, { method:"POST", headers: H, body: JSON.stringify({ value: v }) });

  await set("Layout_Sidenav_Footer", "© Synq");
  await set("Layout_Login_Header", "Bienvenue sur Synq");
  await set("Layout_Primary_Color", "#0ea5e9");
  await set("Layout_Secondary_Color", "#111827");
  await set("Accounts_Name_Validation", "^[a-z0-9._-]{3,20}$");
  await set("Jitsi_Enabled", true);
  // add more defaults as needed…

  // create sample channels
  const mk = async (name, readOnly=false) =>
    j(`/api/v1/channels.create`, { method:"POST", headers: H, body: JSON.stringify({ name }) })
      .then(()=> readOnly ? j(`/api/v1/channels.setReadOnly`, { method:"POST", headers: H, body: JSON.stringify({ roomName:name, readOnly:true }) }) : null );

  await mk("annonces", true);
  await mk("projets");
  await mk("general");

  console.log("Branding & channels seeded.");
})();
