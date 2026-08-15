import { q, q1 } from './db.js';
import { agentRequest, serverNode } from './agent-client.js';
import { config, agentInternalUrl } from './config.js';

// Background sampler: every SAMPLE_MS, record each server's resource usage
// into server_metrics (for the live graphs) and raise alerts when a server
// crosses its resource thresholds.
const SAMPLE_MS = 30000; // 30s
const RETENTION_MS = 24 * 60 * 60 * 1000; // keep 24h of history
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // don't re-alert the same thing for 10 min

let timer = null;

export function startMetricsSampler() {
  if (timer) return;
  timer = setInterval(sampleAll, SAMPLE_MS);
  // First sample shortly after boot
  setTimeout(sampleAll, 5000);
  console.log('[metrics] sampler started');
}

export function stopMetricsSampler() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function sampleAll() {
  try {
    const servers = await q(`SELECT id, uuid, name, memory_mb, cpu FROM servers`);
    for (const s of servers) {
      try {
        const node = await serverNode(s.uuid);
        const r = await agentRequest(`/servers/${s.uuid}/resources`, 'GET', null, { node });
        await q(
          `INSERT INTO server_metrics (server_id, cpu, memory_mb, disk_mb, network_rx_mb, network_tx_mb, running)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [s.id, r.cpu || 0, r.memory_mb || 0, r.disk_mb || 0, r.network_rx_mb || 0, r.network_tx_mb || 0, !!r.running]
        );
        await checkAlerts(s, r);
      } catch (e) {
        // Node offline or server gone — skip quietly
      }
    }
    // Prune old samples
    await q(`DELETE FROM server_metrics WHERE sampled_at < now() - interval '1 day'`);
  } catch (e) {
    console.error('[metrics] sample error:', e.message);
  }
}

async function checkAlerts(server, r) {
  if (!r.running) return;
  const checks = [];
  const memLimit = r.memory_limit_mb || server.memory_mb || 1;
  if (memLimit > 0 && r.memory_mb / memLimit > 0.9) {
    checks.push({
      type: 'memory',
      severity: 'warning',
      message: `${server.name} is using ${Math.round((r.memory_mb / memLimit) * 100)}% of its memory (${r.memory_mb} / ${memLimit} MB)`,
    });
  }
  if (r.cpu > 90) {
    checks.push({
      type: 'cpu',
      severity: 'warning',
      message: `${server.name} is at ${r.cpu}% CPU`,
    });
  }
  for (const c of checks) {
    // Dedupe: skip if an unread alert of this type exists for this server
    const recent = await q1(
      `SELECT id FROM alerts WHERE server_id = $1 AND type = $2 AND read = false
       AND created_at > now() - interval '10 minutes' LIMIT 1`,
      [server.id, c.type]
    );
    if (recent) continue;
    await q(
      `INSERT INTO alerts (server_id, type, message, severity) VALUES ($1,$2,$3,$4)`,
      [server.id, c.type, c.message, c.severity]
    );
  }
}

// Time-series for the frontend charts.
export async function getServerMetrics(serverId, hours = 24) {
  const rows = await q(
    `SELECT cpu, memory_mb, disk_mb, network_rx_mb, network_tx_mb, running, sampled_at
     FROM server_metrics WHERE server_id = $1 AND sampled_at > now() - ($2 || ' hours')::interval
     ORDER BY sampled_at ASC`,
    [serverId, Math.min(72, Math.max(1, parseInt(hours) || 24))]
  );
  return rows.map((r) => ({
    t: r.sampled_at,
    cpu: Math.round(r.cpu * 100) / 100,
    memory_mb: Math.round(r.memory_mb * 100) / 100,
    disk_mb: Math.round(r.disk_mb * 100) / 100,
    network_rx_mb: Math.round(r.network_rx_mb * 100) / 100,
    network_tx_mb: Math.round(r.network_tx_mb * 100) / 100,
    running: r.running,
  }));
}

// Live health for every node (used by the admin node dashboard).
export async function getNodeHealth() {
  const nodes = await q(`SELECT * FROM nodes WHERE enabled = true ORDER BY name`);
  const out = [];
  for (const n of nodes) {
    const isLocal = n.name === config.node.name || n.fqdn === config.node.fqdn;
    const base = isLocal ? agentInternalUrl : `${n.scheme || 'http'}://${n.fqdn}:${n.port}`;
    const token = isLocal ? config.security.agent_token : n.daemon_token;
    const entry = {
      id: n.id,
      uuid: n.uuid,
      name: n.name,
      fqdn: n.fqdn,
      port: n.port,
      online: false,
      last_seen_at: n.last_seen_at,
      stats: null,
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${base}/host/stats`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        entry.stats = await res.json();
        entry.online = true;
        await q(`UPDATE nodes SET last_seen_at = now() WHERE id = $1`, [n.id]);
      }
    } catch {
      entry.online = false;
    }
    out.push(entry);
  }
  return out;
}
