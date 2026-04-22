/**
 * LINEAR STATE NAME → ODOO STAGE NAME MAPPING (Name-Based!)
 * 
 * This maps Linear state NAMES to Odoo stage NAMES.
 * Much easier to configure than IDs!
 * 
 * How to find Linear state names:
 *   1. Go to Linear → Team Settings → States
 *   2. Or use GraphQL:
 *      query {
 *        team(id: "YOUR_TEAM_ID") {
 *          states { nodes { id name } }
 *        }
 *      }
 * 
 * Example:
 *   Linear has state named "Todo"
 *   Odoo has stage ID 1 named "New"
 *   Map: "Todo" → "New"
 * 
 * At runtime, the sync system:
 *   1. Gets Linear state name from API (e.g., "Todo")
 *   2. Maps to Odoo stage name (this config)
 *   3. Looks up Odoo stage ID in cache ("New" → 1)
 *   4. Sends ID to Odoo API
 */
export const STATUS_MAP: Record<string, string> = {
  // Linear state name → Odoo stage name (exact Odoo stage names from linear_odoo_full_mapping.md)
  'Todo': 'New',
  'Backlog': 'BackLog',
  'Triage': 'Triage',
  'In Progress': 'In Progress',
  'QA Review': 'QA',
  'Pending Merge': 'Review',
  'SEO Review': 'Review',
  'Done': 'Done',
  'Canceled': 'Cancelled',
  'Duplicate': 'Cancelled',
  'Blocked': 'Blocked',
};
