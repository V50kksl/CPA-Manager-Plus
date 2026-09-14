import { describe, expect, it } from 'vitest';
import {
  buildFallbackMonitoringAnalytics,
  type MonitoringAnalyticsRequest,
} from './usageService';

const buildRequest = (
  overrides: Partial<MonitoringAnalyticsRequest> = {}
): MonitoringAnalyticsRequest => ({
  from_ms: Date.parse('2026-06-09T00:00:00+08:00'),
  to_ms: Date.parse('2026-06-10T00:00:00+08:00'),
  now_ms: Date.parse('2026-06-09T12:00:00+08:00'),
  include: {
    summary: true,
    timeline: true,
    hourly_distribution: true,
    model_share: true,
    channel_share: true,
    model_stats: true,
    failure_sources: true,
    account_stats: true,
    api_key_stats: true,
    filter_options: true,
    task_buckets: true,
    recent_failures: 5,
    events_page: { limit: 10 },
    granularity: 'hour',
  },
  ...overrides,
});

const nativeUsagePayload = {
  usage: {
    total_requests: 2,
    success_count: 1,
    failure_count: 1,
    total_tokens: 300,
    apis: {
      'andyhome-sk': {
        models: {
          'claude-opus-4-6-thinking': {
            details: [
              {
                timestamp: '2026-06-09T07:05:32.668008928+08:00',
                latency_ms: 12750,
                source: 'benignitian542@gmail.com',
                auth_index: 'f9aef2b717996e7c',
                tokens: {
                  input_tokens: 100,
                  output_tokens: 40,
                  reasoning_tokens: 0,
                  cached_tokens: 0,
                  total_tokens: 140,
                },
                failed: false,
              },
              {
                timestamp: '2026-06-09T08:05:32.668008928+08:00',
                latency_ms: 2000,
                source: 'benignitian542@gmail.com',
                auth_index: 'f9aef2b717996e7c',
                tokens: {
                  input_tokens: 50,
                  output_tokens: 10,
                  total_tokens: 60,
                },
                failed: true,
                error_status: 429,
                error_message: 'quota exceeded',
              },
            ],
          },
        },
      },
    },
  },
};

describe('native usage monitoring analytics fallback', () => {
  it('builds monitoring analytics from native CPA usage payloads', () => {
    const analytics = buildFallbackMonitoringAnalytics(nativeUsagePayload, buildRequest());

    expect(analytics.summary?.total_calls).toBe(2);
    expect(analytics.summary?.success_calls).toBe(1);
    expect(analytics.summary?.failure_calls).toBe(1);
    expect(analytics.summary?.total_tokens).toBe(200);
    expect(analytics.events?.items).toHaveLength(2);
    expect(analytics.events?.items[0]?.api_key_hash).toBe('andyhome-sk');
    expect(analytics.model_stats?.[0]?.model).toBe('claude-opus-4-6-thinking');
    expect(analytics.channel_share?.[0]?.auth_index).toBe('f9aef2b717996e7c');
    expect(analytics.recent_failures).toHaveLength(1);
  });

  it('applies status and model filters before building analytics rows', () => {
    const analytics = buildFallbackMonitoringAnalytics(
      nativeUsagePayload,
      buildRequest({
        filters: {
          failed_only: true,
          models: ['claude-opus-4-6-thinking'],
        },
      })
    );

    expect(analytics.summary?.total_calls).toBe(1);
    expect(analytics.summary?.failure_calls).toBe(1);
    expect(analytics.events?.items).toHaveLength(1);
    expect(analytics.events?.items[0]?.failed).toBe(true);
  });

  it('keeps event hashes stable when loading a later page', () => {
    const timestamp = '2026-06-09T08:05:32.668008928+08:00';
    const usagePayload = {
      usage: {
        apis: {
          'andyhome-sk': {
            models: {
              'gpt-5.6-terra': {
                details: [
                  {
                    timestamp,
                    latency_ms: 100,
                    source: 'alice@example.com',
                    auth_index: 'auth-1',
                    tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                    failed: false,
                  },
                  {
                    timestamp,
                    latency_ms: 200,
                    source: 'alice@example.com',
                    auth_index: 'auth-1',
                    tokens: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
                    failed: false,
                  },
                  {
                    timestamp,
                    latency_ms: 300,
                    source: 'alice@example.com',
                    auth_index: 'auth-1',
                    tokens: { input_tokens: 3, output_tokens: 3, total_tokens: 6 },
                    failed: false,
                  },
                ],
              },
            },
          },
        },
      },
    };

    const rootWithTwo = buildFallbackMonitoringAnalytics(
      usagePayload,
      buildRequest({ include: { events_page: { limit: 2 } } })
    );
    const firstPage = buildFallbackMonitoringAnalytics(
      usagePayload,
      buildRequest({ include: { events_page: { limit: 1 } } })
    );
    const secondPage = buildFallbackMonitoringAnalytics(
      usagePayload,
      buildRequest({
        include: {
          events_page: {
            limit: 1,
            offset: 1,
            page: 2,
          },
        },
      })
    );

    expect(secondPage.events?.items[0]?.latency_ms).toBe(200);
    expect(secondPage.events?.items[0]?.event_hash).toBe(
      rootWithTwo.events?.items[1]?.event_hash
    );
    expect(secondPage.events?.items[0]?.event_hash).not.toBe(
      firstPage.events?.items[0]?.event_hash
    );
  });
});
