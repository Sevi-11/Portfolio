import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ALLOWED_ORIGINS = new Set([
  "https://sevi-11.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function sanitizeHeaderValue(str: string) {
  return str.replace(/[\r\n"<>]/g, "").trim();
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(name: string, email: string, message: string) {
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#F4F1EA; font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:520px; margin:0 auto; padding:32px 20px;">
      <div style="background:#fffdf8; border:1px solid rgba(10,17,40,0.12); border-radius:16px; overflow:hidden;">
        <div style="background:#0A1128; padding:20px 28px;">
          <p style="margin:0; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#aeb5c2;">Portfolio inquiry</p>
          <h1 style="margin:6px 0 0; font-size:20px; line-height:1.3; font-weight:700; color:#fffdf8;">${escapeHtml(name)}</h1>
        </div>
        <div style="padding:24px 28px;">
          <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
            <tr>
              <td style="padding:4px 0; color:#4A5568; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; width:70px; vertical-align:top;">Email</td>
              <td style="padding:4px 0; font-size:14px;"><a href="mailto:${escapeHtml(email)}" style="color:#0A1128; text-decoration:none;">${escapeHtml(email)}</a></td>
            </tr>
          </table>
          <div style="border-top:1px solid rgba(10,17,40,0.12); padding-top:20px; font-size:14px; line-height:1.7; color:#0A1128; white-space:pre-wrap;">${escapeHtml(message)}</div>
        </div>
      </div>
      <p style="text-align:center; margin-top:16px; font-size:11px; color:#4A5568;">Sent from the contact form on your portfolio site.</p>
    </div>
  </body>
</html>`;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400, headers);
  }

  const name = String(payload.name ?? "").trim().slice(0, 200);
  const email = String(payload.email ?? "").trim().slice(0, 200);
  const message = String(payload.message ?? "").trim().slice(0, 5000);

  if (!name || !email || !message) {
    return json({ error: "Name, email, and message are required." }, 400, headers);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: "A valid email address is required." }, 400, headers);
  }

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) {
    console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD secret.");
    return json({ error: "Server email is not configured." }, 500, headers);
  }

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  });

  const displayName = sanitizeHeaderValue(name) || "Portfolio inquiry";

  try {
    await client.send({
      from: `"${displayName}" <${gmailUser}>`,
      to: gmailUser,
      replyTo: email,
      subject: `Portfolio inquiry from ${displayName}`,
      content: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: buildEmailHtml(name, email, message),
    });
  } catch (err) {
    console.error("SMTP send failed:", err);
    return json({ error: "Failed to send message." }, 502, headers);
  } finally {
    await client.close();
  }

  return json({ ok: true }, 200, headers);
});
