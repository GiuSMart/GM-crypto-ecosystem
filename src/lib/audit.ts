import { newId } from "./crypto";
import { all, run } from "./db";

export type AuditEntry = {
  id: string;
  ts: string;
  user_id: string | null;
  action: string;
  target: string | null;
  meta: string | null;
  ip: string | null;
};

export function audit(userId: string | null, action: string, target: string | null, meta: unknown, ip: string | null) {
  run(
    "INSERT INTO audit_log(id, ts, user_id, action, target, meta, ip) VALUES(?,?,?,?,?,?,?)",
    newId("aud"),
    new Date().toISOString(),
    userId,
    action,
    target,
    meta === undefined || meta === null ? null : JSON.stringify(meta).slice(0, 2000),
    ip,
  );
}

export function listAudit(userId: string | null, limit = 50, admin = false): AuditEntry[] {
  if (admin) {
    return all<AuditEntry>("SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?", limit);
  }
  return all<AuditEntry>(
    "SELECT * FROM audit_log WHERE user_id = ? ORDER BY ts DESC LIMIT ?",
    userId,
    limit,
  );
}
