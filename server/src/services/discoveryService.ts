/**
 * discoveryService.ts
 *
 * Maps the web estate by discovering which certificate is bound to each server.
 *
 * Flow:
 *  1. Build a deduplicated hostname list from two sources:
 *       a. CN + SANs from all active/expiring certificates (template-filtered)
 *       b. FQDNs of all existing Server records
 *     This ensures new servers are caught via cert SANs, and known servers
 *     are always re-probed even if their cert SANs have changed.
 *
 *  2. Probe each hostname exactly once over TLS on each configured port.
 *     Grab the SHA-1 thumbprint of whatever cert is being served.
 *
 *  3. Look up the served thumbprint against the entire Certificate collection.
 *     Since all certs come from internal CAs that are synced, a match will
 *     almost always be found. An unknown thumbprint means something outside
 *     the managed CAs — log it and move on.
 *
 *  4. Upsert a Server record:
 *     - If the resolved IP falls in a configured F5 range → key the server
 *       record on the IP address so all virtual hostnames on the same
 *       appliance group under one record.
 *     - Otherwise → key on FQDN (one record per host).
 *
 *  5. Update relationships (cert is the join table):
 *     - Add deployedTo entry on the matched cert → this server.
 *     - Add cert to server.certificates.
 *     - Clean up stale links: if this server was previously linked to a
 *       different cert, remove that old cert's deployedTo entry for this
 *       server and remove it from server.certificates.
 *
 *  6. Rebound detection: if the matched cert has status 'reissued', the
 *     old cert is still serving — flip it to 'rebound'.
 *
 *  7. Unreachable hosts → mark server offline, leave cert links untouched.
 */

import * as tls from 'tls';
import * as net from 'net';
import * as crypto from 'crypto';
import { Certificate } from '../models/Certificate';
import { Server } from '../models/Server';
import { NotificationSettings } from '../models/NotificationSettings';
import { logger } from '../utils/logger';

export interface DiscoveryStats {
  hostnamesProbed: number;
  matched: number;
  unknownThumbprint: number;
  unreachable: number;
  errors: number;
  reboundFound: number;
  serversCreated: number;
  serversUpdated: number;
  staleLinksRemoved: number;
  durationMs: number;
}

export interface ProbeResult {
  hostname: string;
  port: number;
  reachable: boolean;
  servedThumbprint?: string;
  resolvedIP?: string;
  error?: string;
}

// ─── CIDR helpers ─────────────────────────────────────────────────────────────

function ipToUint32(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function ipInRange(ip: string, range: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const [base, bits] = range.split('/');
  if (!bits) return ip === base;
  const prefixLen = parseInt(bits, 10);
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipToUint32(ip) & mask) === (ipToUint32(base) & mask);
}

function isF5IP(ip: string, f5Ranges: string[]): boolean {
  if (!ip || !f5Ranges.length) return false;
  return f5Ranges.some(range => ipInRange(ip, range.trim()));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runDiscovery(singleCertId?: string): Promise<DiscoveryStats> {
  const start = Date.now();
  const stats: DiscoveryStats = {
    hostnamesProbed: 0, matched: 0, unknownThumbprint: 0,
    unreachable: 0, errors: 0, reboundFound: 0,
    serversCreated: 0, serversUpdated: 0, staleLinksRemoved: 0, durationMs: 0,
  };

  const settings = await NotificationSettings.findOne();
  const config   = settings?.discoveryConfig ?? {
    enabled: true, probePorts: [443], probeTimeoutMs: 5000, concurrency: 10, f5IpRanges: [],
  };

  const ports: number[]     = config.probePorts?.length ? config.probePorts : [443];
  const timeoutMs: number   = config.probeTimeoutMs ?? 5000;
  const concurrency: number = config.concurrency ?? 10;
  const f5Ranges: string[]  = (config as any).f5IpRanges ?? [];
  const excludedTemplates: string[] = settings?.excludedTemplates ?? [];

  // ── Step 1: Build deduplicated hostname set ──────────────────────────────

  const hostnameSet = new Set<string>();

  if (singleCertId) {
    // Single-cert mode: only probe that cert's SANs
    const cert = await Certificate.findById(singleCertId)
      .select('commonName subjectAlternativeNames');
    if (cert) {
      for (const h of getProbeTargets(cert.commonName, cert.subjectAlternativeNames || [])) {
        hostnameSet.add(h);
      }
    }
  } else {
    // Source A: active/expiring cert SANs (template-filtered)
    const certQuery: any = { status: { $in: ['active', 'expiring'] } };
    if (excludedTemplates.length > 0) {
      certQuery.templateName = { $nin: excludedTemplates };
    }
    const certs = await Certificate.find(certQuery)
      .select('commonName subjectAlternativeNames');

    for (const cert of certs) {
      for (const h of getProbeTargets(cert.commonName, cert.subjectAlternativeNames || [])) {
        hostnameSet.add(h);
      }
    }

    // Source B: existing Server FQDNs (catches servers whose cert SANs changed)
    const servers = await Server.find({}).select('fqdn');
    for (const server of servers) {
      if (server.fqdn && !net.isIP(server.fqdn)) {
        hostnameSet.add(server.fqdn.toLowerCase());
      }
    }
  }

  const hostnames = Array.from(hostnameSet);
  logger.info(
    `Discovery: ${hostnames.length} unique hostname(s) to probe on port(s) ${ports.join(', ')}` +
    (f5Ranges.length ? ` | F5 ranges: ${f5Ranges.join(', ')}` : '')
  );

  // ── Step 2: Build and run probe tasks ────────────────────────────────────

  const tasks: Array<{ hostname: string; port: number }> = [];
  for (const hostname of hostnames) {
    for (const port of ports) {
      tasks.push({ hostname, port });
    }
  }

  const probeResults = await runWithConcurrency(
    tasks,
    async (task) => probeHost(task.hostname, task.port, timeoutMs),
    concurrency
  );

  // ── Step 3–7: Process each probe result ──────────────────────────────────

  for (const probe of probeResults) {
    stats.hostnamesProbed++;

    // Unreachable — mark server offline if it exists, leave cert links alone
    if (!probe.reachable || !probe.servedThumbprint) {
      if (!probe.reachable) stats.unreachable++;
      else stats.errors++;

      const existingServer = await Server.findOne({ fqdn: probe.hostname });
      if (existingServer && existingServer.status !== 'offline') {
        existingServer.status = 'offline';
        existingServer.lastSyncedAt = new Date();
        await existingServer.save();
        stats.serversUpdated++;
      }
      continue;
    }

    // Normalise thumbprint
    const servedThumb = probe.servedThumbprint.toUpperCase().replace(/[:\s]/g, '');

    // Look up served thumbprint in full Certificate collection
    const matchedCert = await Certificate.findOne({
      thumbprint: { $regex: new RegExp(`^${servedThumb}$`, 'i') },
    });

    // Unknown thumbprint — not from our CAs, store on server and log
    if (!matchedCert) {
      stats.unknownThumbprint++;
      logger.warn(
        `Discovery: ${probe.hostname}:${probe.port} serving unknown thumbprint ${servedThumb} ` +
        `(not in any synced CA — external cert?)`
      );
      // Still upsert the server so it appears in the list
      await upsertServer(probe.hostname, probe.resolvedIP ?? '', f5Ranges, stats, servedThumb);
      continue;
    }

    stats.matched++;

    // ── Step 4: Upsert server record ────────────────────────────────────
    const server = await upsertServer(
      probe.hostname, probe.resolvedIP ?? '', f5Ranges, stats
    );
    if (!server) continue;

    // ── Step 5: Clean up stale cert links for this server ───────────────
    //
    // Find any cert (other than the matched one) that currently has a
    // deployedTo entry pointing to this server. Remove it — this server
    // is no longer serving that cert.
    const staleCerts = await Certificate.find({
      _id:          { $ne: matchedCert._id },
      'deployedTo.serverId': server._id,
    }).select('commonName deployedTo');

    for (const staleCert of staleCerts) {
      const before = staleCert.deployedTo.length;
      staleCert.deployedTo = staleCert.deployedTo.filter(
        (d: any) => d.serverId?.toString() !== server._id.toString()
      ) as any;
      if (staleCert.deployedTo.length < before) {
        await staleCert.save();
        stats.staleLinksRemoved++;
        logger.info(
          `Discovery: removed stale link — ${staleCert.commonName} no longer on ${server.fqdn}`
        );
      }
    }

    // Remove stale cert IDs from server.certificates
    const matchedIdStr = (matchedCert._id as any).toString();
    server.certificates = (server.certificates || []).filter(
      (cId: any) => {
        const s = cId.toString();
        // Keep the matched cert and any certs we haven't just cleaned up
        return s === matchedIdStr || !staleCerts.find(sc => (sc._id as any).toString() === s);
      }
    ) as any;

    // ── Update matched cert → server (deployedTo) ───────────────────────
    const alreadyLinked = matchedCert.deployedTo?.some(
      (d: any) => d.serverId?.toString() === server._id.toString()
    );
    if (!alreadyLinked) {
      const isF5 = isF5IP(probe.resolvedIP ?? '', f5Ranges);
      matchedCert.deployedTo = matchedCert.deployedTo || [] as any;
      matchedCert.deployedTo.push({
        serverId:   server._id,
        serverName: server.fqdn,
        binding:    { type: isF5 ? 'Other' : 'IIS', port: probe.port },
        deployedAt: new Date(),
      } as any);
    }

    // ── Update server → cert ─────────────────────────────────────────────
    const serverCertIds = (server.certificates || []).map((c: any) => c.toString());
    if (!serverCertIds.includes(matchedIdStr)) {
      server.certificates.push(matchedCert._id as any);
    }

    // ── Update deployedLocations on the matched cert ─────────────────────
    upsertDeployedLocation(matchedCert, {
      hostname:         probe.hostname,
      port:             probe.port,
      resolvedIP:       probe.resolvedIP,
      servedThumbprint: probe.servedThumbprint,
      matchStatus:      'match',
      source:           'discovery',
      lastProbeAt:      new Date(),
    });

    // ── Set serverType based on the server role ──────────────────────────
    // F5 and IIS both terminate TLS for IIS backends → 'iis'
    // Anything else (unknown role, non-Windows host) → 'apache'
    // Always overwrite — discovery is the authoritative source for this field.
    const derivedServerType = (server.roles?.includes('F5') || server.roles?.includes('IIS'))
      ? 'iis'
      : 'apache';
    (matchedCert as any).serverType = derivedServerType;

    // ── Rebound detection ────────────────────────────────────────────────
    // The cert being served is marked reissued — old cert still live
    if (matchedCert.status === 'reissued') {
      logger.warn(
        `Rebound: ${matchedCert.commonName} is marked reissued but still serving on ` +
        `${probe.hostname}:${probe.port}`
      );
      matchedCert.status = 'rebound';
      stats.reboundFound++;
    }

    // Save both cert and server
    await matchedCert.save();
    server.lastSyncedAt = new Date();
    await server.save();
  }

  stats.durationMs = Date.now() - start;
  logger.info(
    `Discovery complete in ${(stats.durationMs / 1000).toFixed(1)}s — ` +
    `probed=${stats.hostnamesProbed} matched=${stats.matched} ` +
    `unknown=${stats.unknownThumbprint} unreachable=${stats.unreachable} ` +
    `rebound=${stats.reboundFound} stale links removed=${stats.staleLinksRemoved} ` +
    `servers created=${stats.serversCreated} updated=${stats.serversUpdated}`
  );

  // Persist stats + lastRunAt
  if (settings) {
    settings.discoveryConfig.lastRunAt = new Date();
    settings.discoveryConfig.lastRunStats = {
      probed:       stats.hostnamesProbed,
      matched:      stats.matched,
      mismatched:   stats.unknownThumbprint,
      errors:       stats.errors + stats.unreachable,
      reboundFound: stats.reboundFound,
    };
    await settings.save();
  }

  return stats;
}

// ─── Server upsert ────────────────────────────────────────────────────────────

/**
 * Find or create a Server record.
 *
 * F5 logic: if the resolved IP falls in an F5 CIDR range, we key the record
 * on the IP address rather than hostname — this groups all virtual hostnames
 * on the same appliance under one server record.
 *
 * For all other servers: keyed on FQDN, one record per host.
 */
async function upsertServer(
  hostname: string,
  resolvedIP: string,
  f5Ranges: string[],
  stats: DiscoveryStats,
  unknownThumbprint?: string
): Promise<any | null> {
  try {
    const isF5    = isF5IP(resolvedIP, f5Ranges);
    const role    = isF5 ? 'F5' : 'IIS';
    // F5: key on IP so all virtual hostnames on the same box share one record
    const lookupFqdn = isF5 && resolvedIP ? resolvedIP : hostname;

    let server = await Server.findOne({ fqdn: lookupFqdn });

    if (server) {
      let dirty = false;
      if (resolvedIP && server.ipAddress !== resolvedIP) {
        server.ipAddress = resolvedIP;
        dirty = true;
      }
      if (!server.roles || server.roles.length === 0) {
        server.roles = [role as any];
        dirty = true;
      }
      if (server.status !== 'online') {
        server.status = 'online';
        dirty = true;
      }
      if (dirty) {
        stats.serversUpdated++;
      }
      return server; // saved by caller
    }

    // Create new
    const shortName = isF5
      ? `f5-${resolvedIP || hostname}`
      : hostname.split('.')[0];

    server = await Server.create({
      hostname:        shortName,
      fqdn:            lookupFqdn,
      ipAddress:       resolvedIP || 'unknown',
      operatingSystem: isF5 ? 'F5 BIG-IP' : 'Windows Server',
      roles:           [role],
      domainJoined:    !isF5,
      status:          'online',
      remoteManagement: { winRMEnabled: false, psRemotingEnabled: false },
      certificates:    [],
      lastSyncedAt:    new Date(),
    });

    stats.serversCreated++;
    logger.info(`Discovery: created server ${lookupFqdn} (${role}, IP: ${resolvedIP})`);
    return server;
  } catch (err: any) {
    if (err.code === 11000) {
      const isF5 = isF5IP(resolvedIP, f5Ranges);
      return await Server.findOne({ fqdn: isF5 && resolvedIP ? resolvedIP : hostname });
    }
    logger.error(`Discovery: failed to upsert server ${hostname}:`, err);
    return null;
  }
}

// ─── TLS probe ────────────────────────────────────────────────────────────────

export async function probeHost(hostname: string, port: number, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let resolved  = false;
    let resolvedIP: string | undefined;

    const done = (result: ProbeResult) => {
      if (!resolved) { resolved = true; resolve(result); }
    };

    const timer = setTimeout(() => {
      socket.destroy();
      done({ hostname, port, reachable: false, resolvedIP, error: 'timeout' });
    }, timeoutMs);

    const socket = tls.connect(
      {
        host:                hostname,
        port,
        rejectUnauthorized:  false,
        servername:          hostname,
        checkServerIdentity: () => undefined,
      },
      () => {
        clearTimeout(timer);
        try {
          resolvedIP = (socket as any).remoteAddress;
          const peerCert = socket.getPeerCertificate(false);
          if (!peerCert || !peerCert.raw) {
            socket.destroy();
            done({ hostname, port, reachable: true, resolvedIP, error: 'no_certificate' });
            return;
          }
          const thumbprint = crypto
            .createHash('sha1')
            .update(peerCert.raw)
            .digest('hex')
            .toUpperCase();
          socket.destroy();
          done({ hostname, port, reachable: true, resolvedIP, servedThumbprint: thumbprint });
        } catch (err: any) {
          socket.destroy();
          done({ hostname, port, reachable: true, resolvedIP, error: err.message });
        }
      }
    );

    socket.on('error', (err) => {
      clearTimeout(timer);
      done({ hostname, port, reachable: false, resolvedIP, error: err.message });
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProbeTargets(commonName: string, sans: string[]): string[] {
  const seen    = new Set<string>();
  const targets: string[] = [];

  const add = (value: string) => {
    const h = value.trim().toLowerCase();
    if (!h || h.startsWith('*.') || net.isIP(h) || h.includes('@')) return;
    if (seen.has(h)) return;
    seen.add(h);
    targets.push(h);
  };

  add(commonName);
  for (const san of sans) {
    add(san.replace(/^DNS:/i, '').replace(/^IP Address:/i, ''));
  }
  return targets;
}

function upsertDeployedLocation(cert: any, entry: {
  hostname: string;
  port: number;
  resolvedIP?: string;
  servedThumbprint?: string;
  matchStatus: 'match' | 'mismatch' | 'unknown' | 'error';
  source: 'manual' | 'discovery';
  lastProbeAt: Date;
}): void {
  const locs: any[] = cert.deployedLocations || [];
  const idx = locs.findIndex((l: any) => l.hostname === entry.hostname && l.port === entry.port);
  if (idx >= 0) {
    locs[idx] = { ...locs[idx], ...entry };
  } else {
    locs.push(entry);
  }
  cert.deployedLocations = locs;
}

async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];
  let active = 0;

  return new Promise((resolve) => {
    const next = () => {
      while (active < concurrency && queue.length > 0) {
        const item = queue.shift()!;
        active++;
        fn(item)
          .then((r) => {
            results.push(r);
            active--;
            if (queue.length === 0 && active === 0) resolve(results);
            else next();
          })
          .catch((err) => {
            active--;
            logger.error('Discovery task error:', err);
            if (queue.length === 0 && active === 0) resolve(results);
            else next();
          });
      }
    };
    if (items.length === 0) { resolve([]); return; }
    next();
  });
}