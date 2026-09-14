/** Shared layout constants used across all TUI components */

export const TERM_W = Math.max(process.stdout.columns ?? 120, 80);
export const TERM_H = Math.max(process.stdout.rows ?? 30, 20);
export const LIST_W = Math.max(20, Math.min(32, Math.floor(TERM_W * 0.28)));
export const DETAIL_W = TERM_W - LIST_W - 3;
export const DETAIL_H = Math.max(5, TERM_H - 8);
export const TOAST_TTL_TICKS = 10;

// Table/editor dimensions
export const TABLE_KEY_COL = 30;
export const TABLE_BOX_WIDTH = Math.min(TERM_W - 2, 80);
export const TABLE_VAL_COL = (boxWidth: number, keyCol: number) =>
  boxWidth - keyCol - 6;
