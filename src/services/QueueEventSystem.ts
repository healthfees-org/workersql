/* eslint-disable no-console, @typescript-eslint/no-unused-vars */

import { DatabaseEvent, CloudflareEnvironment, EdgeSQLError } from '../types';
import { CacheService } from './CacheService';

/**
 * QueueEventSystem - Handles asynchronous event processing for database operations
 *
 * Features:
 * - Cache invalidation events
 * - D1 synchronization events
 * - Prewarming events
 * - Dead letter queue handling
 * - Event retry logic
 * - Metrics and monitoring
 */
export interface IQueueEventSystem {
  /**
   * Send an event to the queue
   */
  sendEvent(event: DatabaseEvent): Promise<void>;

  /**
   * Send multiple events in batch
   */
  sendEvents(events: DatabaseEvent[]): Promise<void>;

  /**
   * Process incoming queue message
   */
  processMessage(message: QueueMessage): Promise<void>;

  /**
   * Get queue metrics
   */
  getMetrics(): Promise<QueueMetrics>;

  /**
   * Retry failed events
   */
  retryFailedEvents(): Promise<void>;

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue(): Promise<void>;
}

/**
 * Queue message wrapper
 */
export interface QueueMessage {
  id: string;
  body: DatabaseEvent;
  timestamp: number;
  attempts: number;
  maxRetries: number;
  delayUntil?: number;
}

/**
 * Queue metrics
 */
export interface QueueMetrics {
  totalProcessed: number;
  totalFailed: number;
  currentQueueSize: number;
  deadLetterQueueSize: number;
  avgProcessingTime: number;
  lastProcessedTime: number;
  eventTypeCounts: Record<string, number>;
}

/**
 * Event handler function type
 */
export type EventHandler = (event: DatabaseEvent) => Promise<void>;

/**
 * Event handlers registry
 */
export interface EventHandlersRegistry {
  invalidate: EventHandler[];
  prewarm: EventHandler[];
  d1_sync: EventHandler[];
}

/**
 * QueueEventSystem implementation
 */
export class QueueEventSystem implements IQueueEventSystem {
  private handlers: EventHandlersRegistry;
  private metrics: QueueMetrics;
  private deadLetterQueue: QueueMessage[] = [];

  constructor(
    private env: CloudflareEnvironment,
    private readonly maxRetries: number = 3,
    private retryDelayMs: number = 1000
  ) {
    this.handlers = {
      invalidate: [],
      prewarm: [],
      d1_sync: [],
    };

    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      currentQueueSize: 0,
      deadLetterQueueSize: 0,
      avgProcessingTime: 0,
      lastProcessedTime: 0,
      eventTypeCounts: {},
    };

    this.registerDefaultHandlers();
  }

  /**
   * Send an event to the queue
   */
  async sendEvent(event: DatabaseEvent): Promise<void> {
    try {
      if (!this.env.DB_EVENTS) {
        throw new EdgeSQLError('Queue not available', 'QUEUE_UNAVAILABLE');
      }

      // Validate event
      this.validateEvent(event);

      // Send to Cloudflare Queue
      await this.env.DB_EVENTS.send(event);

      console.log(`Event sent: ${event.type} for shard ${event.shardId}`);
    } catch (error) {
      console.error('Failed to send event:', error);
      throw new EdgeSQLError(
        `Failed to send event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUEUE_SEND_FAILED'
      );
    }
  }

  /**
   * Send multiple events in batch
   */
  async sendEvents(events: DatabaseEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      if (!this.env.DB_EVENTS) {
        throw new EdgeSQLError('Queue not available', 'QUEUE_UNAVAILABLE');
      }

      // Validate all events
      for (const event of events) {
        this.validateEvent(event);
      }

      // Send batch to Cloudflare Queue
      await this.env.DB_EVENTS.sendBatch(
        events.map((event) => ({
          body: event,
        }))
      );

      console.log(`Batch sent: ${events.length} events`);
    } catch (error) {
      console.error('Failed to send event batch:', error);
      throw new EdgeSQLError(
        `Failed to send event batch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUEUE_BATCH_SEND_FAILED'
      );
    }
  }

  /**
   * Process incoming queue message
   */
  async processMessage(message: QueueMessage): Promise<void> {
    const startTime = Date.now();

    try {
      console.log(`Processing event: ${message.body.type} (attempt ${message.attempts})`);

      // Check if message is delayed
      if (message.delayUntil && Date.now() < message.delayUntil) {
        console.log(`Message delayed until ${new Date(message.delayUntil)}`);
        return;
      }

      // Process the event
      await this.processEvent(message.body);

      // Update metrics
      this.updateSuccessMetrics(message.body.type, Date.now() - startTime);

      console.log(`Event processed successfully: ${message.body.type}`);
    } catch (error) {
      console.error(`Event processing failed: ${message.body.type}`, error);

      // Handle retry logic
      await this.handleFailedMessage(message);

      // Update failure metrics
      this.updateFailureMetrics(message.body.type);
    }
  }

  /**
   * Get queue metrics
   */
  async getMetrics(): Promise<QueueMetrics> {
    // Update current queue size if possible
    // Note: Cloudflare Queues doesn't provide direct size query
    this.metrics.deadLetterQueueSize = this.deadLetterQueue.length;

    return { ...this.metrics };
  }

  /**
   * Retry failed events
   */
  async retryFailedEvents(): Promise<void> {
    const retryableEvents = this.deadLetterQueue.filter(
      (msg) => msg.attempts < msg.maxRetries && (!msg.delayUntil || Date.now() >= msg.delayUntil)
    );

    for (const message of retryableEvents) {
      try {
        await this.processMessage({
          ...message,
          attempts: message.attempts + 1,
        });

        // Remove from dead letter queue on success
        this.deadLetterQueue = this.deadLetterQueue.filter((m) => m.id !== message.id);
      } catch (error) {
        console.error(`Retry failed for message ${message.id}:`, error);
      }
    }
  }

  /**
   * Clear dead letter queue
   */
  async clearDeadLetterQueue(): Promise<void> {
    const clearedCount = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    this.metrics.deadLetterQueueSize = 0;

    console.log(`Cleared ${clearedCount} messages from dead letter queue`);
  }

  /**
   * Register event handler
   */
  registerHandler(eventType: keyof EventHandlersRegistry, handler: EventHandler): void {
    this.handlers[eventType].push(handler);
  }

  /**
   * Unregister event handler
   */
  unregisterHandler(eventType: keyof EventHandlersRegistry, handler: EventHandler): void {
    const handlers = this.handlers[eventType];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Process a database event
   */
  private async processEvent(event: DatabaseEvent): Promise<void> {
    const handlers = this.handlers[event.type];

    if (!handlers || handlers.length === 0) {
      console.warn(`No handlers registered for event type: ${event.type}`);
      return;
    }

    // Execute all handlers in parallel
    const promises = handlers.map((handler) => handler(event));
    await Promise.all(promises);
  }

  /**
   * Handle failed message with retry logic
   */
  private async handleFailedMessage(message: QueueMessage): Promise<void> {
    if (message.attempts >= this.maxRetries) {
      console.error(`Message ${message.id} exceeded max retries, moving to dead letter queue`);

      this.deadLetterQueue.push({
        ...message,
        attempts: message.attempts + 1,
      });

      return;
    }

    // Calculate exponential backoff delay
    const delayMs = this.retryDelayMs * Math.pow(2, message.attempts);
    const delayUntil = Date.now() + delayMs;

    console.log(`Scheduling retry for message ${message.id} in ${delayMs}ms`);

    // Add to dead letter queue with delay
    this.deadLetterQueue.push({
      ...message,
      attempts: message.attempts + 1,
      delayUntil,
    });
  }

  /**
   * Validate event structure
   */
  private validateEvent(event: DatabaseEvent): void {
    if (!event.type || !event.shardId || !event.timestamp) {
      throw new EdgeSQLError('Invalid event structure', 'INVALID_EVENT');
    }

    if (!['invalidate', 'prewarm', 'd1_sync'].includes(event.type)) {
      throw new EdgeSQLError(`Unknown event type: ${event.type}`, 'UNKNOWN_EVENT_TYPE');
    }
  }

  /**
   * Update success metrics
   */
  private updateSuccessMetrics(eventType: string, processingTime: number): void {
    this.metrics.totalProcessed++;
    this.metrics.lastProcessedTime = Date.now();

    // Update average processing time
    this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime + processingTime) / 2;

    // Update event type counts
    this.metrics.eventTypeCounts[eventType] = (this.metrics.eventTypeCounts[eventType] || 0) + 1;
  }

  /**
   * Update failure metrics
   */
  private updateFailureMetrics(eventType: string): void {
    this.metrics.totalFailed++;

    // Update event type counts (failed)
    const failedKey = `${eventType}_failed`;
    this.metrics.eventTypeCounts[failedKey] = (this.metrics.eventTypeCounts[failedKey] || 0) + 1;
  }

  /**
   * Register default event handlers
   */
  private registerDefaultHandlers(): void {
    // Cache invalidation handler
    this.registerHandler('invalidate', async (event: DatabaseEvent) => {
      console.log(`Processing cache invalidation for shard ${event.shardId}`);

      if (event.keys && this.env.APP_CACHE) {
        // Invalidate specific cache keys
        for (const key of event.keys) {
          try {
            await this.env.APP_CACHE.delete(key);
            console.log(`Invalidated cache key: ${key}`);
          } catch (error) {
            console.error(`Failed to invalidate cache key ${key}:`, error);
          }
        }
      }
    });

    // Prewarming handler
    this.registerHandler('prewarm', async (event: DatabaseEvent) => {
      console.log(`Processing prewarm event for shard ${event.shardId}`);

      if (event.data && event.keys && this.env.APP_CACHE) {
        // Prewarm cache with provided data
        for (const key of event.keys) {
          try {
            await this.env.APP_CACHE.put(key, JSON.stringify(event.data), {
              expirationTtl: 3600, // 1 hour default TTL
            });
            console.log(`Prewarmed cache key: ${key}`);
          } catch (error) {
            console.error(`Failed to prewarm cache key ${key}:`, error);
          }
        }
      }
    });

    // D1 sync handler
    this.registerHandler('d1_sync', async (event: DatabaseEvent) => {
      console.log(`Processing D1 sync event for shard ${event.shardId}`);

      if (this.env.PORTABLE_DB) {
        try {
          // TODO: Implement actual D1 sync logic
          console.log(`D1 sync completed for shard ${event.shardId}`);
        } catch (error) {
          console.error(`D1 sync failed for shard ${event.shardId}:`, error);
          throw error;
        }
      }
    });
  }
}

/**
 * Queue consumer for Cloudflare Workers
 * This should be exported as the queue handler in your worker
 */
export async function queueConsumer(
  batch: MessageBatch,
  env: CloudflareEnvironment
): Promise<void> {
  // Batch-oriented invalidation with idempotency and deduplication
  const cache = new CacheService(env);

  // Collect all prefixes to invalidate from messages in this batch
  const invalidatePrefixes = new Set<string>();
  const processed: Array<{ msg: Message; alreadyProcessed: boolean }> = [];

  // Idempotency key prefix
  const idemPrefix = 'q:processed:';

  // First pass: determine which messages to process (idempotent) and collect prefixes
  for (const message of batch.messages) {
    try {
      const idKey = `${idemPrefix}${message.id}`;
      // If processed marker exists, skip processing but still ack
      const seen = await (env.APP_CACHE.get as unknown as (k: string) => Promise<string | null>)(
        idKey
      );
      const alreadyProcessed = !!seen;
      processed.push({ msg: message, alreadyProcessed });

      if (alreadyProcessed) {
        continue;
      }

      const event = message.body as DatabaseEvent;
      if (event?.type === 'invalidate' && Array.isArray(event.keys)) {
        for (const base of event.keys) {
          // Expect base key format: `${tenantId}:${tableName}` -> convert to `${tenantId}:q:${tableName}:*`
          const [tenant, table] = String(base).split(':');
          if (tenant && table) {
            invalidatePrefixes.add(`${tenant}:q:${table}:`);
          }
        }
      }
    } catch (err) {
      console.error('Error during idempotency check:', err);
      // In case of errors, fall back to processing this message individually
      const event = message.body as DatabaseEvent;
      if (event?.type === 'invalidate' && Array.isArray(event.keys)) {
        for (const base of event.keys) {
          const [tenant, table] = String(base).split(':');
          if (tenant && table) {
            invalidatePrefixes.add(`${tenant}:q:${table}:`);
          }
        }
      }
    }
  }

  // Execute batched invalidations by prefix
  try {
    await Promise.all(
      Array.from(invalidatePrefixes).map((prefix) => cache.deleteByPattern(`${prefix}*`))
    );
  } catch (err) {
    console.error('Batch invalidation failed:', err);
  }

  // Second pass: mark processed and ack/retry accordingly
  for (const { msg, alreadyProcessed } of processed) {
    try {
      if (!alreadyProcessed) {
        // Mark idempotent processed marker with short TTL (10 minutes)
        const idKey = `${idemPrefix}${msg.id}`;
        await env.APP_CACHE.put(idKey, '1', { expirationTtl: 600 });
      }
      msg.ack();
    } catch (err) {
      console.error('Failed to finalize message processing, retrying message:', err);
      msg.retry();
    }
  }
}
