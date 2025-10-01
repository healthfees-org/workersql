/**
 * WebSocket Transaction Client for WorkerSQL
 * Provides sticky sessions for transactions using WebSocket connections
 */

import { ValidationError } from '../../schema/validator.js';
import { QueryResponse } from '../../schema/types.js';

interface WebSocketMessage {
  type: 'query' | 'begin' | 'commit' | 'rollback' | 'response' | 'error';
  id: string;
  sql?: string;
  params?: any[];
  transactionId?: string;
  data?: any;
  error?: any;
}

export class WebSocketTransactionClient {
  private ws?: WebSocket;
  private url: string;
  private apiKey?: string;
  private messageHandlers = new Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>();
  private connected = false;
  private connecting = false;
  public transactionId?: string;

  constructor(apiEndpoint: string, apiKey?: string) {
    // Convert HTTP(S) URL to WS(S)
    this.url = apiEndpoint.replace(/^http/, 'ws') + '/ws';
    this.apiKey = apiKey;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.connected) {
            clearInterval(checkInterval);
            resolve();
          } else if (!this.connecting) {
            clearInterval(checkInterval);
            reject(new ValidationError('CONNECTION_ERROR', 'WebSocket connection failed'));
          }
        }, 100);
      });
    }

    this.connecting = true;

    try {
      // Note: In Node.js, you'll need to install 'ws' package
      // For browser, WebSocket is built-in
      const WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : (await import('ws')).default;
      
      const wsUrl = this.apiKey ? `${this.url}?token=${this.apiKey}` : this.url;
      this.ws = new WebSocketImpl(wsUrl) as any;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new ValidationError('TIMEOUT_ERROR', 'WebSocket connection timeout'));
        }, 10000);

        this.ws!.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.connecting = false;
          resolve();
        };

        this.ws!.onerror = (error) => {
          clearTimeout(timeout);
          this.connecting = false;
          reject(new ValidationError('CONNECTION_ERROR', 'WebSocket connection error', { error }));
        };

        this.ws!.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws!.onclose = () => {
          this.connected = false;
          this.connecting = false;
          // Clean up pending handlers
          for (const [id, handler] of this.messageHandlers.entries()) {
            clearTimeout(handler.timeout);
            handler.reject(new ValidationError('CONNECTION_ERROR', 'WebSocket connection closed'));
          }
          this.messageHandlers.clear();
        };
      });
    } catch (error) {
      this.connecting = false;
      throw new ValidationError('CONNECTION_ERROR', 'Failed to create WebSocket connection', { error });
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      const handler = this.messageHandlers.get(message.id);

      if (handler) {
        clearTimeout(handler.timeout);
        this.messageHandlers.delete(message.id);

        if (message.type === 'error') {
          handler.reject(new ValidationError(
            message.error?.code || 'INTERNAL_ERROR',
            message.error?.message || 'Unknown error',
            message.error?.details
          ));
        } else {
          handler.resolve(message.data);
        }
      }
    } catch (error) {
      console.error('[WorkerSQL WS] Failed to parse message:', error);
    }
  }

  /**
   * Send a message and wait for response
   */
  private async sendMessage(message: Omit<WebSocketMessage, 'id'>): Promise<any> {
    if (!this.connected || !this.ws) {
      throw new ValidationError('CONNECTION_ERROR', 'WebSocket not connected');
    }

    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fullMessage: WebSocketMessage = { ...message, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new ValidationError('TIMEOUT_ERROR', 'WebSocket message timeout'));
      }, 30000);

      this.messageHandlers.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(fullMessage));
    });
  }

  /**
   * Begin a transaction
   */
  async begin(): Promise<void> {
    await this.connect();
    const response = await this.sendMessage({ type: 'begin' });
    this.transactionId = response.transactionId;
  }

  /**
   * Execute a query within the transaction
   */
  async query(sql: string, params?: any[]): Promise<QueryResponse> {
    if (!this.transactionId) {
      throw new ValidationError('INVALID_QUERY', 'Transaction not started');
    }

    return this.sendMessage({
      type: 'query',
      sql,
      params,
      transactionId: this.transactionId,
    });
  }

  /**
   * Commit the transaction
   */
  async commit(): Promise<void> {
    if (!this.transactionId) {
      throw new ValidationError('INVALID_QUERY', 'Transaction not started');
    }

    await this.sendMessage({
      type: 'commit',
      transactionId: this.transactionId,
    });

    this.transactionId = undefined;
  }

  /**
   * Rollback the transaction
   */
  async rollback(): Promise<void> {
    if (!this.transactionId) {
      return; // Nothing to rollback
    }

    try {
      await this.sendMessage({
        type: 'rollback',
        transactionId: this.transactionId,
      });
    } finally {
      this.transactionId = undefined;
    }
  }

  /**
   * Close the WebSocket connection
   */
  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
      this.connected = false;
    }
  }
}
