/**
 * TAG/LABEL MAPPING (Name-Based!)
 * 
 * Maps Linear label NAMES to Odoo tag NAMES.
 * At runtime, the sync system translates:
 *   - Linear label name "bug" → Odoo tag name "bug" → Odoo tag ID (via cache)
 *   - Odoo tag ID → Odoo tag name (via cache) → Linear label name
 * 
 * How to find Odoo tag names:
 *   1. Go to Odoo → Helpdesk → Configuration → Tags
 *   2. Or run: SELECT id, name FROM helpdesk_tag;
 * 
 * How to find Linear label names:
 *   1. Go to Linear → Team → Labels
 *   2. Or check issues (labels shown in sidebar)
 * 
 * Example:
 *   Linear label "bug" → Odoo tag "bug"
 *   Linear label "feature-request" → Odoo tag "feature"
 */
export const TAG_MAP: Record<string, string> = {
  // Linear label name → Odoo tag name (exact Odoo tag names from linear_odoo_full_mapping.md)
  // Ordered so that the most representative label wins in the reverse map
  'Bug': 'Urgent',
  'Security': 'IT Issue',
  'CI/CD': 'Automation',
  'UX': 'WEB DEVELOPMENT',
  'Internal App': 'Internal',
  'Tech Debt': 'Odoo Development',
  'Performance': 'Tech Team',
  'Web': 'Website Issue',
  'Mobile': 'Development',
  'Improvement': 'Development',
  'Feature': 'Development',      // wins reverse: Development → Feature
  'Integration': 'API Issue',
  'API': 'API Issue',            // wins reverse: API Issue → API
  'QA': 'QA',
  'Shopify': 'Shopify',
  'WordPress': 'Wordpress',
  'AI-Logic': 'AI Improvements',
};

/**
 * REVERSE MAPPING: ODOO TAG NAME → LINEAR LABEL NAME
 * Auto-generated from TAG_MAP (don't edit this)
 */
export const TAG_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TAG_MAP).map(([linearLabel, odooTag]) => [odooTag, linearLabel])
);
