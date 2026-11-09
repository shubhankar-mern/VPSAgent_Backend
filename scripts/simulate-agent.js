#!/usr/bin/env node
/**
 * Dev-only metrics simulator. Posts a realistic payload to /api/agent/metrics so
 * the dashboard can be built and tested before the Go agent exists.
 *
 *   npm run simulate -- --token <AGENT_TOKEN>
 */
const os = require("os");

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const API_URL = (arg("url", process.env.PUBLIC_API_URL || "http://localhost:5000")).replace(/\/+$/, "");
const TOKEN = arg("token", process.env.AGENT_TOKEN || "");
const INTERVAL_MS = Number(arg("interval", 15)) * 1000;
const SERVER_NAME = arg("name", os.hostname());

if (!TOKEN) {
  console.error("Missing agent token. Usage: npm run simulate -- --token <AGENT_TOKEN>");
  process.exit(1);
}

const GiB = 1024 ** 3;
let lastCpu = null;
let lastTickAt = Date.now();
const diskUsedBase = 32 * GiB;
const io = { readBytes: 40 * GiB, writeBytes: 20 * GiB, reads: 1_200_000, writes: 900_000 };
const net = { rxBytes: 12 * GiB, txBytes: 9 * GiB, rxPackets: 900_000, txPackets: 700_000, rxErrors: 0, txErrors: 0, rxDropped: 3, txDropped: 0 };

function cpuSnapshot() {
  const totals = os.cpus().reduce(
    (acc, cpu) => {
      const t = cpu.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
  const cores = os.cpus().map((cpu) => {
    const t = cpu.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
  return { totals, cores };
}

function percent(part, whole) {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

function buildMetrics(seconds) {
  const snapshot = cpuSnapshot();
  let usagePercent = 0;
  let perCorePercent = snapshot.cores.map(() => 0);

  if (lastCpu) {
    const idleDelta = snapshot.totals.idle - lastCpu.totals.idle;
    const totalDelta = snapshot.totals.total - lastCpu.totals.total;
    usagePercent = Number((100 - percent(idleDelta, totalDelta)).toFixed(1));
    perCorePercent = snapshot.cores.map((core, index) => {
      const previous = lastCpu.cores[index] || { idle: 0, total: 0 };
      return Number((100 - percent(core.idle - previous.idle, core.total - previous.total)).toFixed(1));
    });
  }
  lastCpu = snapshot;

  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const swapTotal = 2 * GiB;

  net.rxBytes += Math.round((2_400_000 + Math.random() * 1_800_000) * seconds);
  net.txBytes += Math.round((1_100_000 + Math.random() * 900_000) * seconds);
  net.rxPackets += Math.round((2_000 + Math.random() * 1_500) * seconds);
  net.txPackets += Math.round((1_400 + Math.random() * 900) * seconds);

  io.readBytes += Math.round((300_000 + Math.random() * 700_000) * seconds);
  io.writeBytes += Math.round((150_000 + Math.random() * 500_000) * seconds);
  io.reads += Math.round((20 + Math.random() * 40) * seconds);
  io.writes += Math.round((10 + Math.random() * 30) * seconds);

  const load = os.loadavg();
  const syntheticLoad = load[0] || Number((((usagePercent || 20) / 100) * os.cpus().length).toFixed(2));

  const processes = [
    { name: "nginx", user: "www-data", base: 3 },
    { name: "node", user: "app", base: 8 },
    { name: "postgres", user: "postgres", base: 6 },
    { name: "redis-server", user: "redis", base: 1.5 },
    { name: "systemd", user: "root", base: 0.4 },
    { name: "sshd", user: "root", base: 0.2 },
    { name: "cron", user: "root", base: 0.1 },
    { name: "containerd", user: "root", base: 1.2 },
  ].map((entry, index) => {
    const cpuPercent = Number((entry.base + Math.random() * 4).toFixed(1));
    const memoryBytes = Math.round((80 + Math.random() * 400) * 1024 * 1024);
    return {
      pid: 900 + index * 137,
      name: entry.name,
      user: entry.user,
      state: "S",
      cpuPercent,
      memoryBytes,
      memoryPercent: Number(percent(memoryBytes, totalMemory).toFixed(2)),
    };
  });

  return {
    agentVersion: "simulator-1.0.0",
    serverName: SERVER_NAME,
    collectedAt: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
      kernel: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model || "unknown",
      cpuCores: os.cpus().length,
      totalMemoryBytes: totalMemory,
      bootTimeSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
      uptimeSeconds: Math.floor(os.uptime()),
    },
    cpu: {
      usagePercent,
      idlePercent: Number((100 - usagePercent).toFixed(1)),
      perCorePercent,
    },
    memory: {
      totalBytes: totalMemory,
      usedBytes: usedMemory,
      availableBytes: freeMemory,
      cachedBytes: Math.round(usedMemory * 0.3),
      usagePercent: Number(percent(usedMemory, totalMemory).toFixed(1)),
    },
    swap: {
      totalBytes: swapTotal,
      usedBytes: 0,
      freeBytes: swapTotal,
      usagePercent: 0,
    },
    load: {
      one: Number((syntheticLoad * (0.9 + Math.random() * 0.2)).toFixed(2)),
      five: Number((syntheticLoad * 0.85).toFixed(2)),
      fifteen: Number((syntheticLoad * 0.8).toFixed(2)),
      runQueue: 1,
      totalThreads: 412,
    },
    disks: [
      {
        device: "/dev/vda1",
        mount: "/",
        filesystem: "ext4",
        totalBytes: 100 * GiB,
        usedBytes: diskUsedBase + Math.round(io.writeBytes * 0.02),
        freeBytes: 100 * GiB - (diskUsedBase + Math.round(io.writeBytes * 0.02)),
        usagePercent: 32,
        inodesTotal: 6_553_600,
        inodesUsed: 412_000,
        inodesUsagePercent: 6.3,
      },
    ],
    diskIO: [
      {
        device: "vda",
        readsCompleted: io.reads,
        writesCompleted: io.writes,
        readBytes: io.readBytes,
        writeBytes: io.writeBytes,
        ioSeconds: Math.round(io.reads / 200),
      },
    ],
    networks: [
      {
        interface: os.platform() === "win32" ? "Ethernet" : "eth0",
        rxBytes: net.rxBytes,
        txBytes: net.txBytes,
        rxPackets: net.rxPackets,
        txPackets: net.txPackets,
        rxErrors: net.rxErrors,
        txErrors: net.txErrors,
        rxDropped: net.rxDropped,
        txDropped: net.txDropped,
      },
    ],
    network: { activeConnections: 96 + Math.round(Math.random() * 60) },
    processSummary: { total: 182, running: 2, sleeping: 180, zombie: 0, threads: 412 },
    processes,
  };
}

async function send() {
  const seconds = Math.max(1, (Date.now() - lastTickAt) / 1000);
  lastTickAt = Date.now();

  const response = await fetch(`${API_URL}/api/agent/metrics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(buildMetrics(seconds)),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`[simulate] ${response.status} ${body}`);
    if (response.status === 401) process.exit(1);
    return;
  }
  console.log(`[simulate] ${response.status} ${body}`);
}

send().catch((error) => console.error("[simulate] request failed:", error.message));
setInterval(() => {
  send().catch((error) => console.error("[simulate] request failed:", error.message));
}, INTERVAL_MS).unref?.();

console.log(`[simulate] posting to ${API_URL}/api/agent/metrics every ${INTERVAL_MS / 1000}s as "${SERVER_NAME}"`);