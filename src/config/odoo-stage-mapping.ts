/**
 * ODOO STAGE NAME → LINEAR STATE NAME MAPPING (Name-Based!)
 * 
 * This maps Odoo stage NAMES to Linear state NAMES.
 * Much easier to configure than IDs!
 * 
 * How to find Odoo stage names:
 *   1. Go to Odoo → Helpdesk → Configuration → Stages
 *   2. Or run: SELECT id, name FROM helpdesk_stage;
 * 
 * At runtime, the sync system:
 *   1. Gets Odoo stage_id from API (e.g., 2)
 *   2. Looks up stage name in cache (2 → "In Progress")
 *   3. Maps stage name to Linear state name (this config)
 *   4. Sends to Linear API
 * 
 * Example:
 *   Odoo has stage ID 1 named "New"
 *   Linear has state named "Todo"
 *   Map: "New" → "Todo"
 */
export const ODOO_STAGE_MAP: Record<string, string> = {
  // Odoo stage name → Linear state name (exact Odoo stage names from linear_odoo_full_mapping.md)
  'New': 'Todo',
  'BackLog': 'Backlog',
  'Triage': 'Triage',
  'In Progress': 'In Progress',
  'QA': 'QA Review',
  'Review': 'Pending Merge',
  'Done': 'Done',
  'Solved': 'Done',
  'Cancelled': 'Canceled',
  'Canceled': 'Canceled',
  'Blocked': 'Blocked',
};

/**
 * REVERSE MAPPING: LINEAR STATE NAME → ODOO STAGE NAME
 * Auto-generated from ODOO_STAGE_MAP (don't edit this)
 */
export const ODOO_STAGE_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(ODOO_STAGE_MAP).map(([odooName, linearName]) => [linearName, odooName])
);
