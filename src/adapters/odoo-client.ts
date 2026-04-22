import { env } from '../config/env';
import { logger } from '../utils/logger';

interface OdooRpcRequest {
  jsonrpc: string;
  method: string;
  params: any;
  id: number;
}

export class OdooClient {
  private uid: number | null = null;

  private async authenticate(): Promise<void> {
    logger.info({
      db: env.ODOO_DB,
      username: env.ODOO_USERNAME,
    }, '[Auth] Authenticating with Odoo via common.authenticate...');

    const result = await this.rpcCall('common', 'authenticate', [
      env.ODOO_DB,
      env.ODOO_USERNAME,
      env.ODOO_API_KEY,
      {},
    ]);

    if (!result || typeof result !== 'number') {
      throw new Error(
        `Odoo authentication failed: expected numeric uid, got ${JSON.stringify(result)}`
      );
    }

    this.uid = result;
    logger.info({ uid: this.uid }, '[Auth] Odoo authentication successful, uid stored');
  }

  private async getUid(): Promise<number> {
    if (!this.uid) {
      await this.authenticate();
    }
    return this.uid!;
  }

  /**
   * Private async rpcCall() method
   * Uses JSON-RPC 2.0 endpoint /jsonrpc with execute_kw service
   * API key is passed in the args array (not HTTP headers)
   *
   * Format:
   *   POST /jsonrpc
   *   {
   *     "jsonrpc": "2.0",
   *     "method": "call",
   *     "params": {
   *       "service": "object",
   *       "method": "execute_kw",
   *       "args": [db, uid, api_key, model, method, args_list, kwargs_dict]
   *     },
   *     "id": requestId
   *   }
   */
  private async rpcCall(
    service: string,
    method: string,
    args: any[]
  ): Promise<any> {
    const endpoint = '/jsonrpc';
    const url = new URL(endpoint, env.ODOO_BASE_URL).toString();
    const requestId = Math.floor(Math.random() * 1000000000);
    
    const payload: OdooRpcRequest = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service,
        method,
        args,
      },
      id: requestId,
    };

    // Verify payload structure
    if (payload.jsonrpc !== '2.0') {
      logger.error({ payload }, 'Invalid JSON-RPC version in payload');
      throw new Error('Invalid JSON-RPC payload: jsonrpc must be "2.0"');
    }

    if (payload.method !== 'call') {
      logger.error({ payload }, 'Invalid method in payload');
      throw new Error('Invalid JSON-RPC payload: method must be "call"');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const bodyString = JSON.stringify(payload);

    logger.debug({
      url,
      endpoint,
      requestId,
      service,
      method,
      argsLength: args.length,
    }, '[JSON-RPC] Sending execute_kw request to /jsonrpc endpoint');

    logger.debug({
      requestId,
      payloadStructure: {
        jsonrpc: payload.jsonrpc,
        method: payload.method,
        service: payload.params.service,
        serviceMethod: payload.params.method,
        argsLength: payload.params.args.length,
        id: payload.id
      }
    }, '[JSON-RPC] Payload structure validation passed');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyString,
      });
    } catch (fetchError: any) {
      logger.error({
        requestId,
        endpoint,
        url,
        error: fetchError.message,
        stack: fetchError.stack
      }, '[JSON-RPC] Fetch request failed');
      throw new Error(`Failed to reach Odoo at ${url}: ${fetchError.message}`);
    }

    logger.debug({
      requestId,
      statusCode: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type')
    }, '[JSON-RPC] Received HTTP response');

    // Check for non-200 HTTP status
    if (!response.ok) {
      logger.warn({
        requestId,
        statusCode: response.status,
        statusText: response.statusText,
        endpoint,
        url
      }, '[JSON-RPC] Non-2xx HTTP status code - may be HTML error page');
    }

    let rawResponseText: string;
    try {
      rawResponseText = await response.text();
    } catch (readError: any) {
      logger.error({
        requestId,
        error: readError.message
      }, '[JSON-RPC] Failed to read response body');
      throw new Error(`Failed to read Odoo response: ${readError.message}`);
    }

    logger.debug({
      requestId,
      statusCode: response.status,
      bodyLength: rawResponseText.length,
      bodyPreview: rawResponseText.substring(0, 300)
    }, '[JSON-RPC] Raw response body (first 300 chars)');

    if (rawResponseText.length > 300) {
      logger.debug({
        requestId,
        bodyTail: rawResponseText.substring(Math.max(0, rawResponseText.length - 200))
      }, '[JSON-RPC] Raw response body (last 200 chars)');
    }

    // Validate response is JSON before attempting to parse
    if (!rawResponseText.trim().startsWith('{') && !rawResponseText.trim().startsWith('[')) {
      logger.error({
        requestId,
        statusCode: response.status,
        contentType: response.headers.get('content-type'),
        bodyPreview: rawResponseText.substring(0, 500),
        isHtmlError: rawResponseText.toLowerCase().includes('<!doctype') || 
                     rawResponseText.toLowerCase().includes('<html') ||
                     rawResponseText.toLowerCase().includes('404')
      }, '[JSON-RPC] Response is not JSON (likely HTML error page or 404)');
      throw new Error(
        `Odoo returned non-JSON response (HTTP ${response.status}). ` +
        `Endpoint may not exist or be accessible. Response: ${rawResponseText.substring(0, 200)}`
      );
    }

    let data: any;
    try {
      data = JSON.parse(rawResponseText);
    } catch (parseError: any) {
      logger.error({
        requestId,
        parseError: parseError.message,
        statusCode: response.status,
        bodyLength: rawResponseText.length,
        body: rawResponseText
      }, '[JSON-RPC] Failed to parse response as JSON');
      throw new Error(`Odoo response is not valid JSON: ${parseError.message}`);
    }

    logger.debug({
      requestId,
      hasResult: !!data.result,
      hasError: !!data.error,
      keys: Object.keys(data)
    }, '[JSON-RPC] Parsed response structure');

    // Check for JSON-RPC error response
    if (data.error) {
      logger.error({
        requestId,
        statusCode: response.status,
        endpoint,
        url,
        rpcError: data.error,
        errorName: data.error.data?.name,
        errorMessage: data.error.data?.message,
        errorDetails: data.error.data?.arguments
      }, '[JSON-RPC] Odoo returned error response');
      
      throw new Error(
        `Odoo RPC Error: ${data.error.data?.message || data.error.message || JSON.stringify(data.error)}`
      );
    }

    // Check for successful result
    if (!('result' in data)) {
      logger.warn({
        requestId,
        statusCode: response.status,
        endpoint,
        dataKeys: Object.keys(data)
      }, '[JSON-RPC] Response is missing both "result" and "error" fields');
      
      logger.debug({
        requestId,
        fullResponse: data
      }, '[JSON-RPC] Full unexpected response');
      
      throw new Error('Odoo RPC response is invalid: missing both result and error fields');
    }

    logger.debug({
      requestId,
      resultType: typeof data.result,
      resultIsArray: Array.isArray(data.result),
      resultLength: Array.isArray(data.result) ? data.result.length : 'n/a'
    }, '[JSON-RPC] Successfully received RPC result');

    return data.result;
  }

  /**
   * Test connection to Odoo using API key authentication
   * Performs a lightweight search_read call on res.users to verify access
   * This replaces the old session-based authenticate() method
   * 
   * API key is passed in the /jsonrpc execute_kw payload args array
   * (not HTTP headers)
   */
  public async testConnection(): Promise<void> {
    logger.info({
      baseUrl: env.ODOO_BASE_URL,
      db: env.ODOO_DB,
      username: env.ODOO_USERNAME,
      hasApiKey: !!env.ODOO_API_KEY,
    }, 'Testing Odoo JSON-RPC connection...');

    try {
      await this.authenticate();

      const users = await this.searchRead('res.users', [['id', '=', this.uid]], ['id', 'name']);

      if (!users || users.length === 0) {
        throw new Error('Could not verify access to res.users after authentication');
      }

      logger.info({
        user: users[0].name,
        uid: this.uid,
      }, '✓ Odoo JSON-RPC connection verified');
    } catch (error: any) {
      logger.error({
        error: error.message,
        db: env.ODOO_DB,
        username: env.ODOO_USERNAME,
        url: env.ODOO_BASE_URL,
      }, '✗ Odoo JSON-RPC connection test failed');

      throw error;
    }
  }

  public async callKw(model: string, method: string, args: any[] = [], kwargs: any = {}) {
    const uid = await this.getUid();

    return this.rpcCall('object', 'execute_kw', [
      env.ODOO_DB,
      uid,
      env.ODOO_API_KEY,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  // --- Higher Level Abstractions ---

  public async searchRead(model: string, domain: any[], fields: string[] = [], kwargs: any = {}) {
    return this.callKw(model, 'search_read', [domain], { fields, ...kwargs });
  }

  public async createTicket(data: any) {
    // data should contain { name, description, stage_id } etc.
    const result = await this.callKw('helpdesk.ticket', 'create', [data]);
    return result; // Usually returns the ID of the created record
  }

  public async updateTicket(ticketId: number, data: any) {
    return this.callKw('helpdesk.ticket', 'write', [[ticketId], data]);
  }

  public async searchTickets(domain: any[], fields: string[] = [], limit: number = 10) {
    return this.searchRead('helpdesk.ticket', domain, fields, { limit });
  }

  // --- Comment/Message Methods ---

  /**
   * Post a message (comment) to a helpdesk ticket
   * @param ticketId Odoo ticket ID
   * @param body Message text (can be plain text or HTML)
   * @param subtype 'mt_note' for internal notes, 'mt_comment' for customer comments
   * @returns Message ID
   */
  public async postMessage(ticketId: number, body: string, subtype: string = 'mt_comment') {
    const result = await this.callKw('helpdesk.ticket', 'message_post', [[ticketId]], {
      body,
      subtype_xmlid: `mail.${subtype}`,
    });
    return result;
  }

  /**
   * Fetch messages (chatter) for a ticket
   * Filters out system messages (only returns actual comments)
   */
  public async getTicketMessages(ticketId: number): Promise<any[]> {
    const ticket = await this.searchRead('helpdesk.ticket', [['id', '=', ticketId]], [
      'message_ids',
    ]);
    if (!ticket || ticket.length === 0) return [];

    const messageIds = ticket[0].message_ids || [];
    if (messageIds.length === 0) return [];

    // Fetch message details with filtering for comments only
    const messages = await this.searchRead('mail.message', [['id', 'in', messageIds]], [
      'id',
      'body',
      'author_id',
      'create_date',
      'message_type',
      'subtype_id',
    ]);

    // Filter: only return actual comments (message_type = 'comment'), not system messages
    return messages.filter(
      (msg: any) =>
        msg.message_type === 'comment' &&
        msg.subtype_id &&
        msg.subtype_id[1] &&
        (msg.subtype_id[1].includes('comment') || msg.subtype_id[1].includes('note'))
    );
  }

  // --- User/Assignee Methods ---

  /**
   * Search for users in Odoo by email or name
   */
  public async searchUsers(domain: any[], fields: string[] = []): Promise<any[]> {
    return this.searchRead('res.users', domain, [
      'id',
      'name',
      'email',
      ...fields,
    ]);
  }

  /**
   * Get a user by ID
   */
  public async getUser(userId: number): Promise<any> {
    const users = await this.searchRead('res.users', [['id', '=', userId]], [
      'id',
      'name',
      'email',
    ]);
    return users?.[0] || null;
  }

  /**
   * Update ticket assignee
   */
  public async setTicketAssignee(ticketId: number, userId: number | null) {
    return this.updateTicket(ticketId, {
      user_id: userId,
    });
  }

  // --- Tag/Label Methods ---

  /**
   * Set tags on a ticket (replaces all existing tags)
   * Abstracts the Odoo tuple syntax: tag_ids: [(6, 0, [tag_id_1, tag_id_2])]
   */
  public async setTicketTags(ticketId: number, tagIds: number[]) {
    return this.updateTicket(ticketId, {
      tag_ids: [[6, 0, tagIds]], // Replace all: (6, 0, [IDs])
    });
  }

  /**
   * Add a single tag to a ticket
   */
  public async addTicketTag(ticketId: number, tagId: number) {
    return this.callKw('helpdesk.ticket', 'write', [[ticketId]], {
      tag_ids: [[4, tagId]], // Add: (4, tag_id)
    });
  }

  /**
   * Remove a single tag from a ticket
   */
  public async removeTicketTag(ticketId: number, tagId: number) {
    return this.callKw('helpdesk.ticket', 'write', [[ticketId]], {
      tag_ids: [[3, tagId]], // Remove: (3, tag_id)
    });
  }

  /**
   * Get all tags for a ticket
   */
  public async getTicketTags(ticketId: number): Promise<any[]> {
    const ticket = await this.searchRead('helpdesk.ticket', [['id', '=', ticketId]], [
      'tag_ids',
    ]);
    if (!ticket || ticket.length === 0) return [];
    return ticket[0].tag_ids || [];
  }

  public get isAuthenticated(): boolean {
    return this.uid !== null;
  }
}

export const odooClient = new OdooClient();
