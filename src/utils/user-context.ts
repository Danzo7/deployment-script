// ─── User Context for Traceability ───────────────────────────────────────────
//
// Provides the current user identity for audit trails and traceability.
// - Remote sessions: uses DM_REMOTE_USER environment variable (set by SSH server)
// - Local sessions: returns "system"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current user identity for traceability purposes.
 * Returns the SSH user's identity for remote sessions or "system" for local operations.
 */
export function getCurrentUser(): string {
  return process.env.DM_REMOTE_USER || 'system';
}

/**
 * Check if the current session is a remote session
 */
export function isRemoteSession(): boolean {
  return !!process.env.DM_REMOTE_USER;
}
