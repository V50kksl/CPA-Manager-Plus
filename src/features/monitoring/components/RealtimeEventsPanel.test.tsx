import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { AccountDisplayMode } from '@/features/monitoring/accountOverviewState';
import type { MonitoringEventRow } from '@/features/monitoring/hooks/useMonitoringData';
import {
  DEFAULT_REALTIME_COLUMNS,
  type RealtimeColumnWidths,
} from '@/features/monitoring/monitoringCenterUiState';
import { RealtimeEventsPanel } from './RealtimeEventsPanel';

const t = ((key: string, options?: Record<string, unknown>) => {
  const messages: Record<string, string> = {
    'common.loading': 'Loading',
    'common.copy': 'Copy',
    'common.reset': 'Reset',
    'monitoring.account_overview_account_display_masked': 'Masked',
    'monitoring.account_overview_account_display_full': 'Full',
    'monitoring.account_overview_show_full_accounts_hint': 'Show full accounts',
    'monitoring.account_overview_show_masked_accounts_hint': 'Show masked accounts',
    'monitoring.auth_index': 'Auth Index',
    'monitoring.auth_index_short': 'Index',
    'monitoring.cache_creation_tokens': 'Cache Creation Tokens',
    'monitoring.cache_creation_tokens_short': 'Create',
    'monitoring.cache_hit_rate': 'Cache Hit Rate',
    'monitoring.cache_read_tokens': 'Cache Read Tokens',
    'monitoring.cache_read_tokens_short': 'Cache Read',
    'monitoring.cache_total_tokens': 'Cache Tokens',
    'monitoring.cache_write_tokens_short': 'Cache Write',
    'monitoring.column_endpoint': 'Endpoint',
    'monitoring.column_client_ip': 'Client IP',
    'monitoring.column_error': 'Error',
    'monitoring.column_latency': 'Latency',
    'monitoring.column_model': 'Model',
    'monitoring.column_output_tps': 'TPS',
    'monitoring.column_provider_channel': 'Provider / Channel',
    'monitoring.column_source_api_key': 'Source / API Key',
    'monitoring.column_success_rate': 'Success',
    'monitoring.column_time': 'Time',
    'monitoring.column_type': 'Type',
    'monitoring.elapsed_short': 'Elapsed',
    'monitoring.executor_type_short': 'Executor',
    'monitoring.fail_status_code_short': 'HTTP',
    'monitoring.filter_account': 'Account',
    'monitoring.filter_status_failed': 'Failed only',
    'monitoring.filter_provider': 'Provider',
    'monitoring.input_tokens': 'Input Tokens',
    'monitoring.input_tokens_short': 'Input',
    'monitoring.log_rows': 'Rows',
    'monitoring.reasoning_effort': 'Effort',
    'monitoring.reasoning_effort_short': 'Effort',
    'monitoring.reasoning_tokens': 'Reasoning Tokens',
    'monitoring.reasoning_tokens_short': 'Reasoning',
    'monitoring.recent_failures': 'Failures',
    'monitoring.recent_status': 'Recent',
    'monitoring.realtime_columns_config': 'Field Settings',
    'monitoring.realtime_columns_config_short': 'Fields',
    'monitoring.realtime_api_key_hash': 'API Key hash',
    'monitoring.realtime_api_key_label': 'API Key',
    'monitoring.realtime_api_key_masked': 'Masked key',
    'monitoring.request_status': 'Status',
    'monitoring.result_failed': 'Failed',
    'monitoring.result_success': 'Success',
    'monitoring.security_policy': 'Security Policy',
    'monitoring.security_audit_error': 'Security Audit Error',
    'monitoring.output_tokens': 'Output Tokens',
    'monitoring.output_tokens_short': 'Output',
    'monitoring.page_size_label': 'Per page',
    'monitoring.page_size_label_short': 'Rows',
    'monitoring.page_size_option': '{{count}} / page',
    'monitoring.pagination_info':
      'Page {{current}} / {{total}} · Showing {{start}}-{{end}} / {{count}}',
    'monitoring.pagination_jump_label': 'Jump to page',
    'monitoring.pagination_jump_prefix': 'Go to',
    'monitoring.pagination_jump_suffix': 'page',
    'monitoring.pagination_next': 'Next',
    'monitoring.pagination_prev': 'Previous',
    'monitoring.service_tier': 'Speed',
    'monitoring.service_tier_short': 'Speed',
    'monitoring.service_tier_fast': 'Fast',
    'monitoring.service_tier_ultrafast': 'Ultrafast',
    'monitoring.service_tier_default': 'Default',
    'monitoring.service_tier_standard': 'Standard',
    'monitoring.this_call_cost': 'Cost',
    'monitoring.this_call_usage': 'Usage',
    'monitoring.total_tokens': 'Total Tokens',
    'monitoring.ttft_short': 'TTFT',
  };
  let message = messages[key] ?? key;
  if (options) {
    message = message.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String((options as Record<string, unknown>)[name] ?? '')
    );
  }
  return message;
}) as unknown as TFunction;

const noop = vi.fn();

type PanelRow = MonitoringEventRow & {
  requestCount: number;
  successRate: number;
  streamKey: string;
  recentPattern: boolean[];
};

type PanelOverrides = {
  accountDisplayMode?: AccountDisplayMode;
  columnWidths?: RealtimeColumnWidths;
  eventsTotalCount?: number;
};

const baseRow = (overrides: Partial<PanelRow> = {}): PanelRow => ({
  id: 'row-1',
  timestamp: '2026-04-25T00:00:00Z',
  timestampMs: Date.UTC(2026, 3, 25, 12, 34, 56),
  dayKey: '2026-04-25',
  hourLabel: '00:00',
  model: 'client-gpt',
  resolvedModel: 'gpt-5.6-terra',
  endpoint: 'POST /v1/chat/completions',
  endpointMethod: 'POST',
  endpointPath: '/v1/chat/completions',
  sourceKey: 'source:user@example.com',
  source: 'user@example.com',
  sourceMasked: 'user@example.com',
  account: 'user@example.com',
  accountMasked: 'user@example.com',
  authIndex: '0',
  authIndexMasked: '0',
  authLabel: '0',
  projectId: '',
  apiKeyHash: '',
  apiKeyLabel: '-',
  apiKeyMasked: '-',
  provider: 'openai',
  planType: '-',
  channel: 'openai',
  channelHost: '-',
  channelDisabled: false,
  failed: false,
  statsIncluded: true,
  latencyMs: 1500,
  ttftMs: 500,
  tokensPerSecond: 20,
  inputTokens: 15,
  outputTokens: 23,
  reasoningTokens: 3,
  cachedTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 38,
  totalCost: 0,
  taskKey: 'task-1',
  searchText: '',
  requestCount: 1,
  successRate: 1,
  streamKey: 'stream-1',
  recentPattern: [true],
  ...overrides,
});

const renderPanel = (row: PanelRow, overrides: PanelOverrides = {}) =>
  renderToStaticMarkup(
    <RealtimeEventsPanel
      embedded
      rows={[row]}
      pagination={{
        currentPage: 1,
        totalPages: 1,
        pageItems: [row],
        startItem: 1,
        endItem: 1,
      }}
      pageSize={10}
      scopedFailureCount={row.failed ? 1 : 0}
      failedOnlyActive={false}
      eventsTotalCount={overrides.eventsTotalCount ?? 1}
      hasPrices={false}
      accountDisplayMode={overrides.accountDisplayMode ?? 'masked'}
      visibleColumns={[...DEFAULT_REALTIME_COLUMNS]}
      columnWidths={overrides.columnWidths ?? {}}
      locale="en-US"
      emptyState={<span>empty</span>}
      t={t}
      onToggleFailedOnly={noop}
      onAccountDisplayModeChange={noop}
      onColumnVisibilityChange={noop}
      onColumnWidthChange={noop}
      onResetColumns={noop}
      onPageChange={noop}
      onPageSizeChange={noop}
    />
  );

describe('RealtimeEventsPanel', () => {
  const expectedDate = new Date(baseRow().timestampMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const expectedTime = new Date(baseRow().timestampMs).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  it('renders CPA v7.1.18 usage details for failed rows', () => {
    const markup = renderPanel(
      baseRow({
        failed: true,
        successRate: 0,
        executorType: 'codex',
        reasoningEffort: 'medium',
        serviceTier: 'priority',
        cachedTokens: 0,
        cacheReadTokens: 4,
        cacheCreationTokens: 1,
        failStatusCode: 429,
        failSummary: 'rate limit exceeded',
      })
    );

    expect(markup).toContain('>Effort</span>');
    expect(markup).toContain('>TPS</span>');
    expect(markup).toContain('aria-label="Effort monitoring.realtime_column_width"');
    expect(markup).toContain('Source / API Key');
    expect(markup).not.toContain('>Executor: codex<');
    expect(markup).not.toContain('Executor: codex');
    expect(markup).toContain('medium');
    expect(markup).toContain('Speed: Fast');
    expect(markup).not.toContain('priority');
    expect(markup).toContain('client-gpt');
    expect(markup).toContain('gpt-5.6-terra');
    expect(markup).not.toContain('Resolved');
    expect(markup).toContain('POST /v1/chat/completions');
    expect(markup).toContain('Failed');
    expect(markup).toMatch(/TTFT<\/span><span class="[^"]+">｜<\/span><span class="[^"]+">Elapsed/);
    expect(markup).toContain('500 ms');
    expect(markup).toContain('Elapsed');
    expect(markup).toContain('1.5 s');
    expect(markup).toContain('20');
    expect(markup).not.toContain('Input 10 · Output 23 · Reasoning 3');
    expect(markup).toContain('>10</span>');
    expect(markup).toContain('>23</span>');
    expect(markup).toContain('>4</span>');
    expect(markup).toContain('>1</span>');
    expect(markup).toContain('M21.2 6.8');
    expect(markup).toContain('realtimeTokenInfo');
    expect(markup).toContain('26.7%');
    expect(markup).toContain('aria-label="Usage"');
    expect(markup).not.toContain('Input Tokens');
    expect(markup).not.toContain('Cache Tokens');
    expect(markup).toContain('aria-label="HTTP 429 · rate limit exceeded"');
    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain('HTTP 429');
    expect(markup).toContain('rate limit exceeded');
  });

  it('renders a compaction stage next to the endpoint', () => {
    const markup = renderPanel(
      baseRow({
        endpoint: 'POST /v1/responses (官方-->摘要)',
        endpointMethod: 'POST',
        endpointPath: '/v1/responses',
      })
    );

    expect(markup).toContain('POST /v1/responses (官方--&gt;摘要)');
  });

  it('shows the requested-to-effective speed transition when tiers differ', () => {
    const markup = renderPanel(
      baseRow({
        executorType: 'codex',
        serviceTier: 'priority',
        responseServiceTier: 'default',
        effectiveServiceTier: 'default',
      })
    );

    expect(markup).toContain('Speed: Fast -&gt; Default');
  });

  it('renders ultrafast as a distinct speed label', () => {
    const markup = renderPanel(
      baseRow({
        executorType: 'codex',
        serviceTier: 'ultrafast',
      })
    );

    expect(markup).toContain('Speed: Ultrafast');
  });

  it('renders security audit rejections as security policy records', () => {
    const markup = renderPanel(
      baseRow({
        failed: true,
        successRate: 0,
        executorType: 'security_policy',
        inputTokens: 0,
        outputTokens: 3,
        totalTokens: 3,
        totalCost: 0,
        latencyMs: 18,
        ttftMs: null,
        failStatusCode: 403,
        failSummary: 'security_audit_blocked: Qwen3Guard rejected the request',
      })
    );

    expect(markup).toContain('Security Policy');
    expect(markup).not.toContain('>Failed</span>');
    expect(markup).toContain('HTTP 403');
    expect(markup).toContain('security_audit_blocked: Qwen3Guard rejected the request');
    expect(markup).not.toContain('Input 0 · Output 3 · Reasoning 3');
    expect(markup).toContain('>0</span>');
    expect(markup).toContain('>3</span>');
  });

  it('renders safe defaults when optional usage fields are missing', () => {
    const markup = renderPanel(baseRow());

    expect(markup).toContain('<colgroup>');
    expect(markup.match(/<col\b/g)).toHaveLength(DEFAULT_REALTIME_COLUMNS.length);
    expect(markup).not.toContain('Effort -');
    expect(markup).toContain('>Effort</span>');
    expect(markup).toContain('>TPS</span>');
    expect(markup).toContain('Success');
    expect(markup).toMatch(/TTFT<\/span><span class="[^"]+">｜<\/span><span class="[^"]+">Elapsed/);
    expect(markup).toContain(expectedDate);
    expect(markup).toContain(expectedTime);
    expect(markup).not.toContain('Input 15 · Output 23 · Reasoning 3');
    expect(markup).toContain('>15</span>');
    expect(markup).toContain('>23</span>');
    expect(markup).toContain('>5</span>');
    expect(markup).toContain('realtimeTokenInfo');
    expect(markup).toContain('aria-label="Usage"');
    expect(markup).not.toContain('HTTP');
  });

  it('renders API key alias inside the source cell without adding another column', () => {
    const markup = renderPanel(
      baseRow({
        apiKeyHash: '1234567890abcdef',
        apiKeyLabel: 'Team A',
        apiKeyMasked: 'sk-...cdef',
        executorType: 'codex',
      }),
      { accountDisplayMode: 'full' }
    );

    expect(markup).toContain('Source / API Key');
    expect(markup).toContain('API Key: Team A');
    expect(markup).not.toContain('#12345678');
    expect(markup).toContain('API Key hash: 1234567890abcdef');
    expect(markup).toContain('Masked key: sk-...cdef');
    expect(markup).toContain('Executor: codex');
    expect(markup).not.toContain('>Executor: codex<');
  });

  it('renders the client IP in the realtime table', () => {
    const markup = renderPanel(baseRow({ clientIp: '203.0.113.12' }));

    expect(markup).toContain('>Client IP</span>');
    expect(markup).toContain('>203.0.113.12</span>');
  });

  it('switches API keys between masked and full display with the account privacy control', () => {
    const row = baseRow({
      apiKeyHash: '1234567890abcdef',
      apiKeyLabel: 'sk********ef',
      apiKeyMasked: 'sk********ef',
      apiKeyFull: 'sk-very-secret-key',
    });

    const maskedMarkup = renderPanel(row);
    const fullMarkup = renderPanel(row, { accountDisplayMode: 'full' });

    expect(maskedMarkup).toContain('API Key: sk********ef');
    expect(maskedMarkup).not.toContain('sk-very-secret-key');
    expect(fullMarkup).toContain('API Key: sk-very-secret-key');
  });

  it('switches realtime source labels between masked and full display', () => {
    const row = baseRow({
      source: 'very-long-user@example.com',
      sourceMasked: 'ver***@example.com',
      account: 'very-long-user@example.com',
      accountMasked: 'ver***@example.com',
      authLabel: '',
      channel: 'openai',
      channelHost: '-',
      provider: 'openai',
    });
    const maskedMarkup = renderPanel(row);
    const fullMarkup = renderPanel(row, { accountDisplayMode: 'full' });

    expect(maskedMarkup).toContain('>ver***@example.com</span>');
    expect(maskedMarkup).toContain(
      'title="ver***@example.com · Provider: openai · very-long-user@example.com'
    );
    expect(fullMarkup).toContain('>very-long-user@example.com</span>');
    expect(fullMarkup).toContain('title="very-long-user@example.com · Provider: openai');
  });

  it('switches the primary source text instead of adding an account metadata line', () => {
    const row = baseRow({
      source: 'visible-user@example.com',
      sourceMasked: 'vis***@example.com',
      account: 'visible-user@example.com',
      accountMasked: 'vis***@example.com',
      authLabel: '',
      channel: 'openai',
      channelHost: '-',
      provider: 'openai',
    });
    const maskedMarkup = renderPanel(row);
    const fullMarkup = renderPanel(row, { accountDisplayMode: 'full' });

    expect(maskedMarkup).toContain('>vis***@example.com</span>');
    expect(maskedMarkup).not.toContain('<small>Account: vis***@example.com</small>');
    expect(fullMarkup).toContain('>visible-user@example.com</span>');
    expect(fullMarkup).not.toContain('<small>Account: visible-user@example.com</small>');
  });

  it('renders a ttft placeholder when ttft is missing', () => {
    const markup = renderPanel(baseRow({ ttftMs: null }));

    expect(markup).toContain('>TPS</span>');
    expect(markup).toMatch(/TTFT<\/span><span class="[^"]+">｜<\/span><span class="[^"]+">Elapsed/);
    expect(markup).not.toContain('500 ms');
    expect(markup).toContain('1.5 s');
    expect(markup).toMatch(
      /--<\/span><span class="[^"]+">｜<\/span><span class="[^"]*realtimeMetricText[^"]*realtimeMetricRight[^"]*">1\.5 s<\/span>/
    );
  });

  it('keeps latency warning and error tone classes on plain text metrics', () => {
    const warningMarkup = renderPanel(baseRow({ latencyMs: 20_000, ttftMs: 1_000 }));
    const errorMarkup = renderPanel(baseRow({ latencyMs: 35_000, ttftMs: 1_000 }));

    expect(warningMarkup).toMatch(/class="[^"]*realtimeMetricText[^"]*warnText[^"]*"/);
    expect(errorMarkup).toMatch(/class="[^"]*realtimeMetricText[^"]*badText[^"]*"/);
  });

  it('colors normal millisecond and second metrics green for both ttft and elapsed time', () => {
    const markup = renderPanel(baseRow({ latencyMs: 470, ttftMs: 120 }));

    expect(markup).toMatch(
      /class="[^"]*realtimeMetricText[^"]*realtimeMetricLeft[^"]*goodText[^"]*">120 ms/
    );
    expect(markup).toMatch(
      /class="[^"]*realtimeMetricText[^"]*realtimeMetricRight[^"]*goodText[^"]*">470 ms/
    );
  });

  it('renders cache creation tokens separately from cache read tokens', () => {
    const markup = renderPanel(
      baseRow({
        cachedTokens: 4,
        cacheReadTokens: 4,
        cacheCreationTokens: 1,
      })
    );

    expect(markup).toContain('>4</span>');
    expect(markup).toContain('>1</span>');
    expect(markup).toContain('realtimeTokenInfo');
  });

  it('uses a compact k suffix only for cache totals above one thousand', () => {
    const markup = renderPanel(
      baseRow({
        inputTokens: 2_000,
        cachedTokens: 1_200,
        cacheReadTokens: 1_200,
        cacheCreationTokens: 0,
      })
    );

    expect(markup).toContain('>800</span>');
    expect(markup).toContain('>1.2k</span>');
    expect(markup).toContain('>23</span>');
  });

  it('keeps the usage content and info trigger together when the usage column is resized', () => {
    const markup = renderPanel(baseRow(), {
      columnWidths: { usage: 72 },
    });

    expect(markup).toContain('style="width:180px"');
    expect(markup).toContain('realtimeTokenInfo');
  });

  it('does not show Codex speed for non-Codex rows', () => {
    const markup = renderPanel(
      baseRow({
        provider: 'openai',
        channel: 'openai',
        executorType: '',
        serviceTier: 'priority',
      })
    );

    expect(markup).not.toContain('Speed: Fast');
    expect(markup).not.toContain('Speed: Standard');
  });

  it('uses backend total count in pagination without rendering load-more controls', () => {
    const markup = renderPanel(baseRow(), {
      eventsTotalCount: 8000,
    });

    expect(markup).toContain('Showing 1-1 / 8000');
    expect(markup).not.toContain('Load more');
    expect(markup).not.toContain('Loaded 500 of 8000 events');
  });
});
