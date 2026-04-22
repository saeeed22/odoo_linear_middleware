#!/usr/bin/env node
/**
 * Direct test of Odoo RPC authentication
 * Run with: node test-odoo-rpc.js
 */

const ODOO_BASE_URL = 'https://staging.zuma.odolution.com';
const ODOO_DB = '09-FEB-2026';
const ODOO_USERNAME = 'asfand@zumasales.com';
const ODOO_PASSWORD = 'Zuma2025$$';
const ODOO_API_KEY = '635833c1b4757f0d524f259c51585e645c514618';

async function testRpcCall(endpoint, params, authMethod) {
  const url = new URL(endpoint, ODOO_BASE_URL).toString();
  const payload = {
    jsonrpc: '2.0',
    method: 'call',
    params,
    id: Math.floor(Math.random() * 1000000000),
  };

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Odoo-Linear-Middleware/1.0',
  };

  // Add HTTP Basic Auth if using API key
  if (authMethod === 'api_key') {
    const credentials = Buffer.from(`${ODOO_USERNAME}:${ODOO_API_KEY}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  console.log(`\n=== Testing ${authMethod} authentication ===`);
  console.log(`URL: ${url}`);
  console.log(`Payload:`, JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    const data = await response.json();

    if (data.error) {
      console.log(`❌ ERROR: ${data.error.data?.message || data.error.message}`);
      if (data.error.data?.debug) {
        console.log(`Debug info (last 500 chars):`);
        console.log(data.error.data.debug.slice(-500));
      }
    } else if (data.result) {
      console.log(`✅ SUCCESS! UID: ${data.result.uid}`);
    }
  } catch (error) {
    console.error(`❌ Network Error: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Odoo RPC Authentication Tester');
  console.log(`Base URL: ${ODOO_BASE_URL}`);
  console.log(`Database: ${ODOO_DB}`);
  console.log(`Username: ${ODOO_USERNAME}`);
  console.log(`Password: ${ODOO_PASSWORD}`);

  // Test 1: Password authentication with full email
  await testRpcCall('/web/session/authenticate', {
    db: ODOO_DB,
    login: ODOO_USERNAME,
    password: ODOO_PASSWORD,
  }, 'password_email');

  // Test 2: Password authentication with username only
  await testRpcCall('/web/session/authenticate', {
    db: ODOO_DB,
    login: 'asfand',
    password: ODOO_PASSWORD,
  }, 'password_username_only');

  // Test 3: API key authentication
  await testRpcCall('/web/session/authenticate', {
    db: ODOO_DB,
    login: ODOO_USERNAME,
    password: ODOO_API_KEY,
  }, 'api_key');

  // Test 4: Try /jsonrpc endpoint instead
  await testRpcCall('/jsonrpc', {
    db: ODOO_DB,
    login: ODOO_USERNAME,
    password: ODOO_PASSWORD,
  }, 'jsonrpc_endpoint');

  console.log('\n✅ Test complete');
}

main().catch(console.error);
