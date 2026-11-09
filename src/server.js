require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getAdmin } = require("./services/firebase");
const authRoutes = require("./routes/auth");
const serverRoutes = require("./routes/servers");
const agentRoutes = require("./routes/agent");
const path = require("path");
const app = express();
const port = Number(process.env.PORT || 5000);
const webhookRoutes = require("./routes/webhook");
const billingRoutes = require("./routes/billing");

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Permit non-browser clients (Go agent, curl) with no Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: true,
}));

app.use("/api/webhooks", webhookRoutes);


app.use(express.json({ limit: "1mb", strict: true }));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.AGENT_RATE_LIMIT_PER_MINUTE || 600),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many agent requests. Retry shortly." },
});


app.use("/api/billing", generalLimiter, billingRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "vps-autopilot-api", timestamp: Date.now() });
});



app.use(
  "/downloads/agent",
  express.static(path.join(__dirname, "../static/agent"))
);

app.use("/api/auth", generalLimiter, authRoutes);
app.use("/api/servers", generalLimiter, serverRoutes);
app.use("/api/agent", agentLimiter, agentRoutes);

app.use((req, res) => res.status(404).json({ error: "Route not found." }));

app.use((error, _req, res, _next) => {
  // Avoid leaking Firebase credentials, tokens, or internal stack traces.
  console.error("API error:", error && error.message ? error.message : "Unknown error");
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ error: "Origin is not allowed." });
  }
  res.status(500).json({ error: "Internal server error." });
});

async function start() {
  try {
    // Fail fast if Firebase credentials/config are invalid.
    getAdmin();
    app.listen(port, () => {
      console.log(`VPS Autopilot API listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error.message);
    process.exit(1);
  }
}

if (require.main === module) start();

module.exports = { app, start };
