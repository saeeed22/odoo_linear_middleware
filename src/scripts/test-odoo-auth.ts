/**
 * Diagnostic script to test Odoo JSON-RPC authentication
 * Tests the API key-based JSON-RPC authentication (not session-based)
 * Run with: npx tsx src/scripts/test-odoo-auth.ts
 */

import { env } from '../config/env';
import { logger } from '../utils/logger';

async function testOdooAuth() {
  console.log('🔍 Odoo JSON-RPC Authentication Diagnostic Tool');
  console.log('================================================\n');

  console.log('📋 Configuration Check:');
  console.log(`  Base URL: ${env.ODOO_BASE_URL}`);
  console.log(`  Database: ${env.ODOO_DB}`);
  console.log(`  Username: ${env.ODOO_USERNAME}`);
  console.log(`  Has API Key: ${env.ODOO_API_KEY ? '✓ Yes' : '✗ No'}`);
  console.log('');

  if (!env.ODOO_API_KEY) {
    console.log('⚠️  WARNING: ODOO_API_KEY is not set!');
    console.log('   The system requires an API key for JSON-RPC authentication.');
    console.log('   Please set ODOO_API_KEY in your .env file.');
    console.log('');
  }

  // Test 1: Network connectivity
  console.log('🌐 Test 1: Network Connectivity');
  try {
    const response = await fetch(env.ODOO_BASE_URL);
    console.log(`  ✓ Connected to ${env.ODOO_BASE_URL} (HTTP ${response.status})`);
  } catch (error: any) {
    console.log(`  ✗ Failed to connect: ${error.message}`);
    console.log('  → Check if Odoo instance is running and URL is correct');
    return;
  }
  console.log('');

  // Test 2: API Key JSON-RPC Authentication
  if (env.ODOO_API_KEY) {
    console.log('🔐 Test 2: API Key JSON-RPC Authentication');
    try {
      const credentials = Buffer.from(`${env.ODOO_USERNAME}:${env.ODOO_API_KEY}`).toString('base64');
      
      const response = await fetch(new URL('/web/dataset/call_kw', env.ODOO_BASE_URL).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'res.users',
            method: 'search_read',
            args: [[['id', '=', 1]]],
            kwargs: { fields: ['id', 'name'] }
          },
          id: 1,
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        console.log(`  ✗ JSON-RPC API Key authentication failed`);
        console.log(`    Error: ${data.error.data?.message || JSON.stringify(data.error)}`);
        console.log('');
        console.log('  Troubleshooting:');
        
        if (data.error.data?.message?.includes('Bad Request')) {
          console.log('    • This looks like a transport error');
          console.log('    • Ensure you\'re using /web/dataset/call_kw endpoint (JSON-RPC)');
          console.log('    • Do NOT use /web/session/authenticate (session endpoint)');
        }
        
        if (data.error.data?.name === 'odoo.exceptions.AccessDenied') {
          console.log('    • AccessDenied: API key may be invalid');
          console.log('    • Ensure API key belongs to the configured user');
          console.log('    • Verify database name and user permissions');
        }
      } else if (data.result && Array.isArray(data.result) && data.result.length > 0) {
        const user = data.result[0];
        console.log(`  ✓ JSON-RPC API Key authentication successful!`);
        console.log(`    User ID: ${user.id}`);
        console.log(`    User Name: ${user.name}`);
      } else {
        console.log(`  ? Unexpected response: ${JSON.stringify(data.result)}`);
      }
    } catch (error: any) {
      console.log(`  ✗ Request failed: ${error.message}`);
    }
    console.log('');
  } else {
    console.log('⚠️  Test 2: API Key JSON-RPC Authentication - SKIPPED (no API key)');
    console.log('');
  }

  // Test 3: Try to list databases
  console.log('📚 Test 3: List Available Databases');
  try {
    const response = await fetch(new URL('/web/database/selector', env.ODOO_BASE_URL).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {},
        id: 1,
      }),
    });

    const data = await response.json();
    
    if (data.result && Array.isArray(data.result)) {
      console.log(`  ✓ Available databases:`);
      data.result.forEach((db: any) => {
        const isCurrent = db === env.ODOO_DB ? ' ← YOUR CONFIG' : '';
        console.log(`    - ${db}${isCurrent}`);
      });
    } else {
      console.log(`  ✗ Could not fetch database list`);
      if (data.error) {
        console.log(`    Error: ${data.error.data?.message || JSON.stringify(data.error)}`);
      }
    }
  } catch (error: any) {
    console.log(`  ✗ Request failed: ${error.message}`);
  }
  console.log('');

  // Test 4: Summary and recommendations
  console.log('💡 Summary:');
  console.log('');
  console.log('The middleware uses API key-based JSON-RPC authentication:');
  console.log('  ✓ All requests use /web/dataset/call_kw endpoint');
  console.log('  ✓ Authentication: HTTP Basic Auth with API key as password');
  console.log('  ✓ No session management needed');
  console.log('');
  console.log('Required setup:');
  console.log('  1. Set ODOO_API_KEY in .env (get from Odoo user preferences)');
  console.log('  2. Ensure ODOO_USERNAME matches the API key owner');
  console.log('  3. Verify ODOO_BASE_URL and ODOO_DB are correct');
  console.log('');
  console.log('If Test 2 failed:');
  console.log('  • Verify API key exists and is valid');
  console.log('  • Check that the user account is active in Odoo');
  console.log('  • Ensure the user has permissions for helpdesk_ticket and related models');
  console.log('  • Try generating a new API key in Odoo user settings');
  console.log('');
}

testOdooAuth().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
