import { describe, expect, it } from 'vitest';
import type { UsageDetailWithEndpoint } from '@/utils/usage';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import { buildEventRows } from './eventRows';

const buildRows = (overrides: Partial<UsageDetailWithEndpoint> = {}) =>
  buildEventRows(
    [
      {
        timestamp: '2026-05-19T10:00:00Z',
        source: 'alice@example.com',
        auth_index: 'auth-1',
        latency_ms: 1500,
        ttft_ms: 500,
        tokens: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
        },
        failed: false,
        __modelName: 'gpt-5.6-terra',
        __endpoint: 'POST /v1/chat/completions',
        __endpointMethod: 'POST',
        __endpointPath: '/v1/chat/completions',
        __timestampMs: Date.parse('2026-05-19T10:00:00Z'),
        ...overrides,
      },
    ],
    new Map(),
    new Map(),
    { byAuthIndex: new Map(), bySource: new Map(), bySourceType: new Map() },
    new Map(),
    {},
    new Map()
  );

describe('buildEventRows', () => {
  it('calculates output tokens per second from total latency', () => {
    const [row] = buildRows();

    expect(row.latencyMs).toBe(1500);
    expect(row.ttftMs).toBe(500);
    expect(row.tokensPerSecond).toBeCloseTo(20 / 1.5);
  });

  it('keeps the client IP for the realtime table', () => {
    const [row] = buildRows({ client_ip: '203.0.113.12' });

    expect(row.clientIp).toBe('203.0.113.12');
  });

  it('does not let TTFT change output tokens per second', () => {
    const [withoutTTFT] = buildRows({ ttft_ms: undefined });
    const [smallTTFT] = buildRows({ ttft_ms: 100 });
    const [invalidTTFT] = buildRows({ ttft_ms: 2000 });

    expect(withoutTTFT.tokensPerSecond).toBeCloseTo(20 / 1.5);
    expect(smallTTFT.tokensPerSecond).toBeCloseTo(20 / 1.5);
    expect(invalidTTFT.tokensPerSecond).toBeCloseTo(20 / 1.5);
  });

  it('does not calculate tokens per second without output tokens or total latency', () => {
    const [noOutput] = buildRows({ tokens: { output_tokens: 0 } });
    const [noLatency] = buildRows({ latency_ms: undefined });
    const [zeroLatency] = buildRows({ latency_ms: 0 });

    expect(noOutput.tokensPerSecond).toBeNull();
    expect(noLatency.tokensPerSecond).toBeNull();
    expect(zeroLatency.tokensPerSecond).toBeNull();
  });

  it('keeps CPA executor and service tier metadata searchable', () => {
    const [row] = buildRows({
      executor_type: 'codex',
      service_tier: 'priority',
      reasoning_effort: 'medium',
    });

    expect(row.executorType).toBe('codex');
    expect(row.serviceTier).toBe('priority');
    expect(row.searchText).toContain('codex');
    expect(row.searchText).toContain('priority');
    expect(row.searchText).toContain('medium');
  });

	it('keeps response-model audit metadata for realtime display', () => {
		const [row] = buildRows({
			response_model: 'gpt-5.6-sol',
			response_model_mismatch: true,
			billing_model: 'gpt-5.6-sol',
		});

		expect(row.responseModel).toBe('gpt-5.6-sol');
		expect(row.responseModelMismatch).toBe(true);
		expect(row.billingModel).toBe('gpt-5.6-sol');
	});

  it('prefers configured provider names over auth file labels', () => {
    const [row] = buildEventRows(
      [
        {
          timestamp: '2026-05-19T10:00:00Z',
          source: 'm:sk-c...7890',
          auth_index: 'auth-1',
          tokens: { total_tokens: 0 },
          failed: false,
          __modelName: 'gpt-5.6-terra',
          __endpoint: 'POST /v1/chat/completions',
          __timestampMs: Date.parse('2026-05-19T10:00:00Z'),
        },
      ],
      new Map([
        [
          'auth-1',
          {
            authIndex: 'auth-1',
            label: 'alice@example.com',
            account: 'alice@example.com',
            provider: 'codex',
            status: 'available',
            disabled: false,
            unavailable: false,
            runtimeOnly: false,
            planType: '-',
            updatedAt: '',
          },
        ],
      ]),
      new Map(),
      buildSourceInfoMap({
        codexApiKeys: [
          {
            name: 'Codex Team A',
            apiKey: 'sk-codex1234567890',
            baseUrl: 'https://api.codex.example/v1',
            authIndex: 'auth-1',
          },
        ],
      }),
      new Map(),
      {},
      new Map()
    );

    expect(row.source).toBe('Codex Team A');
    expect(row.sourceMasked).toBe('Codex Team A');
  });

  it('keeps the complete failure body separate from the display summary', () => {
    const [row] = buildRows({
      failed: true,
      fail_summary: 'HTTP 502',
      fail_body: '{"error":"' + 'x'.repeat(240) + '"}',
    });

    expect(row.failSummary).toBe('HTTP 502');
    expect(row.failBody).toBe('{"error":"' + 'x'.repeat(240) + '"}');
  });

  it('prefers API key auth labels over masked key account snapshots', () => {
    const [row] = buildRows({
      source: 'm:sk******D1',
      auth_index: '8ab16cb30d5b41f3',
      account_snapshot: 'sk-6...xwD1',
      auth_label_snapshot: 'codex-测试',
      auth_provider_snapshot: 'codex',
    });

    expect(row.source).toBe('codex-测试');
    expect(row.sourceMasked).toBe('codex-测试');
    expect(row.account).toBe('sk-6...xwD1');
  });
});
