// Durable Object: stores scans in SQLite and runs them in the background using alarms,
// so a scan keeps going even if the browser tab is closed.

import { DurableObject } from 'cloudflare:workers';
import { getEngine } from './engines/index.js';
import { buildScan, runPoint, finaliseScan } from './scan.js';
import { REPORT_VERSION } from './analysis.js';
import { mapLimit } from './dataforseo.js';
import { lookupArea } from './area.js';

const BATCH = 60; // points per alarm run, keeps each run well inside the 15 minute alarm limit

export class ScanStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        meta TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS points (
        scan_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        PRIMARY KEY (scan_id, idx)
      );
    `);
  }

  async createScan(input, { demo, defaults }) {
    const engine = getEngine(input.engine || 'google_maps');
    const { scan, points } = buildScan(input, { demo, engine, defaults });
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO scans (id, created_at, status, meta) VALUES (?, ?, ?, ?)', scan.id, scan.createdAt, scan.status, JSON.stringify(scan));
      points.forEach((p, i) => this.sql.exec('INSERT INTO points (scan_id, idx, done, data) VALUES (?, ?, 0, ?)', scan.id, i, JSON.stringify(p)));
    });
    await this.ctx.storage.setAlarm(Date.now());
    return { id: scan.id, demo: scan.demo, estCost: scan.estCost };
  }

  getScan(id) {
    const row = this.sql.exec('SELECT meta FROM scans WHERE id = ?', id).toArray()[0];
    if (!row) return null;
    const scan = JSON.parse(row.meta);
    // Rebuild reports saved by an older version of the analysis
    if (scan.status === 'done' && (!scan.report || scan.report.version !== REPORT_VERSION)) this.upgrade(scan);
    if (scan.status === 'failed' && /No Search Results/i.test(scan.error || '')) this.upgrade(scan, { clearNoResults: true });
    const rows = this.sql.exec('SELECT done, data FROM points WHERE scan_id = ? ORDER BY idx', id).toArray();
    scan.results = rows.map((r) => ({ ...JSON.parse(r.data), pending: r.done === 0 }));
    scan.progress = { done: rows.filter((r) => r.done === 1).length, total: rows.length };
    return scan;
  }

  upgrade(scan, { clearNoResults = false } = {}) {
    const rows = this.sql.exec('SELECT idx, data FROM points WHERE scan_id = ? ORDER BY idx', scan.id).toArray();
    const points = rows.map((r) => JSON.parse(r.data));
    if (clearNoResults) {
      // "No Search Results" used to be stored as an error; it means not found
      for (const p of points) {
        if (/No Search Results/i.test(p.error || '')) {
          p.error = null;
          p.rank = null;
          p.listings = [];
        }
      }
      scan.error = null;
    }
    finaliseScan(scan, points, getEngine(scan.engine));
    this.ctx.storage.transactionSync(() => {
      rows.forEach((r, i) => this.sql.exec('UPDATE points SET data = ? WHERE scan_id = ? AND idx = ?', JSON.stringify(points[i]), scan.id, r.idx));
      this.sql.exec('UPDATE scans SET meta = ? WHERE id = ?', JSON.stringify(scan), scan.id);
    });
  }

  listScans() {
    return this.sql
      .exec('SELECT meta FROM scans ORDER BY created_at DESC LIMIT 200')
      .toArray()
      .map((r) => {
        const s = JSON.parse(r.meta);
        return {
          id: s.id,
          createdAt: s.createdAt,
          status: s.status,
          demo: s.demo,
          engine: s.engine,
          device: s.device,
          keyword: s.keyword,
          business: s.target && s.target.title,
          gridSize: s.grid.size,
          summary: s.summary,
        };
      });
  }

  async alarm() {
    const running = this.sql.exec("SELECT meta FROM scans WHERE status = 'running' ORDER BY created_at LIMIT 1").toArray();
    if (running.length) await this.process(JSON.parse(running[0].meta));
    const left = this.sql.exec("SELECT COUNT(*) AS n FROM scans WHERE status = 'running'").one().n;
    if (left > 0) await this.ctx.storage.setAlarm(Date.now() + 250);
  }

  async process(scan) {
    const engine = getEngine(scan.engine);
    const pending = this.sql
      .exec('SELECT idx, data FROM points WHERE scan_id = ? AND done = 0 ORDER BY idx LIMIT ?', scan.id, BATCH)
      .toArray()
      .map((r) => ({ idx: r.idx, point: JSON.parse(r.data) }));

    let fatal = null;
    if (pending.length) {
      await mapLimit(pending, Number(this.env.SCAN_CONCURRENCY || 8), async ({ idx, point }) => {
        if (fatal) return;
        await runPoint(scan, point, engine, this.env, { areaLookup: (lat, lng) => lookupArea(lat, lng) });
        if (point.fatal) {
          fatal = point.error;
          return;
        }
        delete point.fatal;
        this.sql.exec('UPDATE points SET done = 1, data = ? WHERE scan_id = ? AND idx = ?', JSON.stringify(point), scan.id, idx);
      });
    }

    if (fatal) {
      scan.status = 'failed';
      scan.error = fatal;
      scan.finishedAt = new Date().toISOString();
      this.sql.exec('UPDATE scans SET status = ?, meta = ? WHERE id = ?', scan.status, JSON.stringify(scan), scan.id);
      return;
    }

    const remaining = this.sql.exec('SELECT COUNT(*) AS n FROM points WHERE scan_id = ? AND done = 0', scan.id).one().n;
    if (remaining > 0) return; // next alarm picks up the rest

    const rows = this.sql.exec('SELECT idx, data FROM points WHERE scan_id = ? ORDER BY idx', scan.id).toArray();
    const points = rows.map((r) => JSON.parse(r.data));
    finaliseScan(scan, points, engine);
    this.ctx.storage.transactionSync(() => {
      rows.forEach((r, i) => this.sql.exec('UPDATE points SET data = ? WHERE scan_id = ? AND idx = ?', JSON.stringify(points[i]), scan.id, r.idx));
      this.sql.exec('UPDATE scans SET status = ?, meta = ? WHERE id = ?', scan.status, JSON.stringify(scan), scan.id);
    });
  }
}
