import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from 'i18next';
import {
  IconArrowDownToLine,
  IconArrowUpFromLine,
  IconChartLine,
  IconCopy,
  IconDatabaseZap,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconInfo,
  IconPencil,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import {
  PaginationControls,
  RecentPattern,
} from '@/features/monitoring/components/MonitoringShared';
import { MonitoringPanel } from '@/features/monitoring/components/MonitoringPanel';
import { formatPercent } from '@/features/monitoring/components/accountOverviewPresentation';
import { buildRealtimeSourceDisplay } from '@/features/monitoring/realtimeSourceDisplay';
import type { MonitoringEventRow } from '@/features/monitoring/hooks/useMonitoringData';
import type { AccountDisplayMode } from '@/features/monitoring/accountOverviewState';
import {
  DEFAULT_REALTIME_COLUMNS,
  MAX_REALTIME_COLUMN_WIDTH,
  MIN_REALTIME_COLUMN_WIDTH,
  REALTIME_COLUMN_KEYS,
  type RealtimeColumnWidths,
  type RealtimeColumnKey,
} from '@/features/monitoring/monitoringCenterUiState';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { formatNumber, maskSensitiveText, truncateText } from '@/utils/format';
import { formatCompactNumber, formatUsd, getActualInputTokens } from '@/utils/usage';
import { getMonitoringSuccessRateTone } from '../model/successRateTone';
import styles from '../MonitoringCenterPage.module.scss';

type RealtimeLogRow = MonitoringEventRow & {
  requestCount: number;
  successRate: number;
  streamKey: string;
  recentPattern: boolean[];
};

type PaginationState<T> = {
  currentPage: number;
  totalPages: number;
  pageItems: T[];
  startItem: number;
  endItem: number;
};

type ColumnResizeState = {
  key: RealtimeColumnKey;
  startX: number;
  startWidth: number;
};

type RealtimeEventsPanelProps = {
  embedded?: boolean;
  rows: RealtimeLogRow[];
  pagination: PaginationState<RealtimeLogRow>;
  pageSize: number;
  scopedFailureCount: number;
  failedOnlyActive: boolean;
  eventsTotalCount: number;
  hasPrices: boolean;
  accountDisplayMode: AccountDisplayMode;
  visibleColumns: RealtimeColumnKey[];
  columnWidths: RealtimeColumnWidths;
  locale: string;
  emptyState: ReactNode;
  t: TFunction;
  onToggleFailedOnly: () => void;
  onAccountDisplayModeChange: (mode: AccountDisplayMode) => void;
  onColumnVisibilityChange: (columns: RealtimeColumnKey[]) => void;
  onColumnWidthChange: (key: RealtimeColumnKey, width: number) => void;
  onResetColumns: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export type RealtimeEventsPanelActionsProps = {
  rowCount: number;
  scopedFailureCount: number;
  failedOnlyActive: boolean;
  accountDisplayMode: AccountDisplayMode;
  visibleColumns: RealtimeColumnKey[];
  t: TFunction;
  onToggleFailedOnly: () => void;
  onAccountDisplayModeChange: (mode: AccountDisplayMode) => void;
  onColumnVisibilityChange: (columns: RealtimeColumnKey[]) => void;
  onResetColumns: () => void;
};

const REALTIME_PAGE_SIZE_OPTIONS = [10, 50, 100, 150, 300] as const;
const MIN_REALTIME_USAGE_COLUMN_WIDTH = 180;
const DEFAULT_REALTIME_COLUMN_WIDTHS: Record<RealtimeColumnKey, number> = {
  source: 240,
  model: 160,
  endpoint: 220,
  clientIp: 140,
  authIndex: 150,
  provider: 150,
  reasoning: 120,
  recent: 100,
  status: 110,
  successRate: 100,
  totalCalls: 88,
  tps: 88,
  latency: 150,
  time: 130,
  usage: 200,
  cost: 90,
};

const formatOptionalText = (value: string | null | undefined) => {
  const trimmed = String(value || '').trim();
  return trimmed || '-';
};

const formatReadableText = (value: string | null | undefined) => {
  const trimmed = String(value || '').trim();
  return trimmed && trimmed !== '-' ? trimmed : '';
};

const shortLabel = (
  t: TFunction,
  shortKey: string,
  fallbackKey: string,
  fallbackDefault?: string
) => {
  const fallback = t(fallbackKey, fallbackDefault ? { defaultValue: fallbackDefault } : undefined);
  const label = t(shortKey, { defaultValue: fallback });
  return label === shortKey ? (fallbackDefault ?? fallback) : label;
};

const formatShortHash = (value: string | null | undefined) => {
  const trimmed = formatReadableText(value);
  return trimmed ? `#${trimmed.slice(0, 8)}` : '';
};

const resolveServiceSpeedLabel = (serviceTier: string | null | undefined, t: TFunction) => {
  const normalized = String(serviceTier || '')
    .trim()
    .toLowerCase();
  if (normalized === 'priority' || normalized === 'fast') {
    return t('monitoring.service_tier_fast');
  }
  if (normalized === 'ultrafast') {
    return t('monitoring.service_tier_ultrafast');
  }
  if (normalized === 'default') {
    return t('monitoring.service_tier_default');
  }
  return t('monitoring.service_tier_standard');
};

const resolveServiceSpeedTransitionLabel = (row: MonitoringEventRow, t: TFunction) => {
  const requested = resolveServiceSpeedLabel(row.serviceTier, t);
  const effective = resolveServiceSpeedLabel(
    row.responseServiceTier || row.effectiveServiceTier || row.serviceTier,
    t
  );
  return requested === effective ? effective : `${requested} -> ${effective}`;
};

const isCodexRealtimeRow = (row: MonitoringEventRow) =>
  [row.provider, row.channel, row.executorType]
    .map((value) =>
      String(value || '')
        .trim()
        .toLowerCase()
    )
    .some((value) => value === 'codex');

const resolveSecurityAuditStatusLabel = (row: MonitoringEventRow, t: TFunction) => {
  const executorType = String(row.executorType || '')
    .trim()
    .toLowerCase();
  if (executorType === 'security_policy') {
    return t('monitoring.security_policy');
  }
  if (executorType === 'security_audit') {
    return t('monitoring.security_audit_error');
  }
  return '';
};

const buildRealtimeApiKeyDisplay = (
  row: MonitoringEventRow,
  t: TFunction,
  accountDisplayMode: AccountDisplayMode
) => {
  const label = formatReadableText(row.apiKeyLabel);
  const masked = formatReadableText(row.apiKeyMasked);
  const full = formatReadableText(row.apiKeyFull);
  const hash = formatReadableText(row.apiKeyHash);
  const shortHash = formatShortHash(hash);
  const display =
    accountDisplayMode === 'full'
      ? full || label || masked || shortHash
      : masked || label || shortHash;

  if (!display) {
    return null;
  }

  const titleParts = [
    `${t('monitoring.realtime_api_key_label')}: ${display}`,
    accountDisplayMode === 'full' && full && full !== display
      ? `${t('monitoring.realtime_api_key_label')}: ${full}`
      : '',
    masked && masked !== display ? `${t('monitoring.realtime_api_key_masked')}: ${masked}` : '',
    hash ? `${t('monitoring.realtime_api_key_hash')}: ${hash}` : '',
    formatReadableText(row.executorType)
      ? `${shortLabel(t, 'monitoring.executor_type_short', 'monitoring.executor_type')}: ${formatReadableText(row.executorType)}`
      : '',
  ].filter(Boolean);

  return {
    display,
    title: titleParts.join('\n'),
  };
};

const formatTokensPerSecond = (value: number | null | undefined, locale: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '--';

  const absValue = Math.abs(value);
  const maximumFractionDigits = absValue < 1 ? 2 : absValue < 10 ? 1 : 0;
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return value.toFixed(maximumFractionDigits);
  }
};

const formatRealtimeCompactDuration = (value: number | null | undefined, locale: string) => {
  if (value === null || value === undefined) return '--';

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '--';

  const formatNumber = (numberValue: number, maximumFractionDigits: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits,
        minimumFractionDigits: 0,
      }).format(numberValue);
    } catch {
      return numberValue.toFixed(maximumFractionDigits);
    }
  };

  if (parsed < 1000) return `${formatNumber(Math.round(parsed), 0)} ms`;

  const seconds = parsed / 1000;
  return `${formatNumber(seconds, seconds < 10 ? 2 : 1)} s`;
};

const getRealtimeDurationToneClass = (value: number | null | undefined) => {
  if (value === null || value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;

  if (parsed >= 30000) return styles.badText;
  if (parsed >= 15000) return styles.warnText;
  return styles.goodText;
};

const formatRealtimeDateParts = (timestampMs: number, locale: string) => {
  const date = new Date(timestampMs);
  return {
    date: date.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    time: date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
};

const buildFailureMetaText = (row: MonitoringEventRow, t: TFunction) => {
  if (!row.failed) return '';
  const parts: string[] = [];
  if (row.failStatusCode) {
    parts.push(
      `${shortLabel(t, 'monitoring.fail_status_code_short', 'monitoring.fail_status_code')} ${row.failStatusCode}`
    );
  }
  const body = maskSensitiveText(row.failSummary || '');
  if (body) {
    parts.push(truncateText(body, 96));
  }
  return parts.join(' · ');
};

const buildFailureDetails = (row: MonitoringEventRow, t: TFunction) => {
  if (!row.failed) return null;
  const summary = maskSensitiveText(row.failSummary || '');
  const copyBody = row.failBody || row.failSummary || '';
  if (!row.failStatusCode && !summary && !copyBody) return null;
  const statusText = row.failStatusCode
    ? `${shortLabel(t, 'monitoring.fail_status_code_short', 'monitoring.fail_status_code')} ${row.failStatusCode}`
    : '';
  return {
    statusCode: row.failStatusCode,
    statusText,
    summary,
    label: buildFailureMetaText(row, t),
    copyText: [statusText, copyBody].filter(Boolean).join('\n'),
  };
};

const buildRealtimeTokenDetails = (row: MonitoringEventRow) => {
  const cacheReadTokens = Math.max(row.cacheReadTokens, row.cachedTokens);
  const cacheWriteTokens = row.cacheCreationTokens;
  const actualInputTokens = getActualInputTokens({
    inputTokens: row.inputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
  });
  const cacheHitDenominator = row.inputTokens;
  const cacheHitRate = cacheHitDenominator > 0 ? cacheReadTokens / cacheHitDenominator : 0;
  return {
    actualInputTokens,
    cacheHitRate,
    cacheReadTokens,
    cacheWriteTokens,
  };
};

const formatRealtimeTokenNumber = (value: number, locale: string) =>
  formatNumber(Math.max(0, Math.round(value)), locale);

const formatRealtimeCacheTokenNumber = (value: number, locale: string) => {
  const roundedValue = Math.max(0, Math.round(value));
  return roundedValue > 1_000
    ? formatCompactNumber(roundedValue).replace('K', 'k')
    : formatRealtimeTokenNumber(roundedValue, locale);
};

type TooltipPosition = {
  left: number;
  top: number;
};

type RealtimeTokenUsageCellProps = {
  locale: string;
  row: RealtimeLogRow;
  t: TFunction;
};

function RealtimeTokenUsageCell({ locale, row, t }: RealtimeTokenUsageCellProps) {
  const tooltipId = useId();
  const infoRef = useRef<HTMLDivElement | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const tokenDetails = buildRealtimeTokenDetails(row);
  const updateTooltipPosition = useCallback(() => {
    const rect = infoRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({
      left: Math.max(8, Math.min(rect.right, window.innerWidth - 8)),
      top: Math.max(8, rect.top - 8),
    });
  }, []);

  useEffect(() => {
    if (!tooltipOpen) return;
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [tooltipOpen, updateTooltipPosition]);

  const showTooltip = () => {
    updateTooltipPosition();
    setTooltipOpen(true);
  };

  const tooltip =
    tooltipOpen && tooltipPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className={styles.realtimeTokenTooltip}
            style={tooltipPosition}
          >
            <span className={styles.realtimeTokenTooltipTitle}>
              {t('monitoring.this_call_usage')}
            </span>
            <div className={styles.realtimeTokenTooltipGrid}>
              <div className={styles.realtimeTokenTooltipRow}>
                <span>{t('monitoring.input_tokens')}</span>
                <strong>{formatRealtimeTokenNumber(tokenDetails.actualInputTokens, locale)}</strong>
              </div>
              <div className={styles.realtimeTokenTooltipRow}>
                <span>{t('monitoring.output_tokens')}</span>
                <strong>{formatRealtimeTokenNumber(row.outputTokens, locale)}</strong>
              </div>
              <div className={styles.realtimeTokenTooltipRow}>
                <span>{t('monitoring.cache_read_tokens')}</span>
                <strong>{formatRealtimeTokenNumber(tokenDetails.cacheReadTokens, locale)}</strong>
              </div>
              {tokenDetails.cacheWriteTokens > 0 ? (
                <div className={styles.realtimeTokenTooltipRow}>
                  <span>{t('monitoring.cache_creation_tokens')}</span>
                  <strong>{formatRealtimeTokenNumber(tokenDetails.cacheWriteTokens, locale)}</strong>
                </div>
              ) : null}
              {row.reasoningTokens > 0 ? (
                <div className={styles.realtimeTokenTooltipRow}>
                  <span>{t('monitoring.reasoning_tokens')}</span>
                  <strong>{formatRealtimeTokenNumber(row.reasoningTokens, locale)}</strong>
                </div>
              ) : null}
              <div className={styles.realtimeTokenTooltipRow}>
                <span>{t('monitoring.cache_hit_rate')}</span>
                <strong>{formatPercent(tokenDetails.cacheHitRate)}</strong>
              </div>
            </div>
            <div className={styles.realtimeTokenTooltipDivider} />
            <div
              className={`${styles.realtimeTokenTooltipRow} ${styles.realtimeTokenTooltipTotal}`}
            >
              <span>{t('monitoring.total_tokens')}</span>
              <strong>{formatRealtimeTokenNumber(row.totalTokens, locale)}</strong>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`${styles.primaryCell} ${styles.realtimeTokenUsage}`}>
      <div className={styles.realtimeTokenItems}>
        <div className={styles.realtimeTokenPrimaryLine}>
          <span className={`${styles.realtimeTokenItem} ${styles.realtimeTokenInput}`}>
            <IconArrowDownToLine size={14} aria-hidden="true" />
            {formatRealtimeTokenNumber(tokenDetails.actualInputTokens, locale)}
          </span>
          <span className={`${styles.realtimeTokenItem} ${styles.realtimeTokenOutput}`}>
            <IconArrowUpFromLine size={14} aria-hidden="true" />
            {formatRealtimeTokenNumber(row.outputTokens, locale)}
          </span>
        </div>
        <div className={styles.realtimeTokenCacheLine}>
          <span className={`${styles.realtimeTokenItem} ${styles.realtimeTokenCache}`}>
            <IconDatabaseZap size={14} aria-hidden="true" />
            {formatRealtimeCacheTokenNumber(tokenDetails.cacheReadTokens, locale)}
          </span>
          {tokenDetails.cacheWriteTokens > 0 ? (
            <span className={`${styles.realtimeTokenItem} ${styles.realtimeTokenCacheWrite}`}>
              <IconPencil size={14} aria-hidden="true" />
              {formatRealtimeCacheTokenNumber(tokenDetails.cacheWriteTokens, locale)}
            </span>
          ) : null}
          <span className={styles.realtimeTokenCacheHitRate}>
            <IconChartLine size={14} aria-hidden="true" />
            {formatPercent(tokenDetails.cacheHitRate)}
          </span>
        </div>
      </div>
      <div
        ref={infoRef}
        className={styles.realtimeTokenInfo}
        tabIndex={0}
        aria-describedby={tooltipOpen ? tooltipId : undefined}
        aria-label={t('monitoring.this_call_usage')}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltipOpen(false)}
        onFocus={showTooltip}
        onBlur={() => setTooltipOpen(false)}
      >
        <IconInfo size={16} aria-hidden="true" />
      </div>
      {tooltip}
    </div>
  );
}

const getRealtimeColumnLabel = (key: RealtimeColumnKey, t: TFunction) => {
  switch (key) {
    case 'source':
      return shortLabel(
        t,
        'monitoring.column_source_api_key_short',
        'monitoring.column_source_api_key'
      );
    case 'model':
      return t('monitoring.column_model');
    case 'endpoint':
      return t('monitoring.column_endpoint');
    case 'clientIp':
      return t('monitoring.column_client_ip');
    case 'authIndex':
      return shortLabel(t, 'monitoring.auth_index_short', 'monitoring.auth_index');
    case 'provider':
      return t('monitoring.column_provider_channel');
    case 'reasoning':
      return shortLabel(t, 'monitoring.reasoning_effort_short', 'monitoring.reasoning_effort');
    case 'recent':
      return shortLabel(t, 'monitoring.recent_status_short', 'monitoring.recent_status');
    case 'status':
      return shortLabel(t, 'monitoring.request_status_short', 'monitoring.request_status');
    case 'successRate':
      return shortLabel(
        t,
        'monitoring.column_success_rate_short',
        'monitoring.column_success_rate'
      );
    case 'totalCalls':
      return shortLabel(t, 'monitoring.total_calls_short', 'monitoring.total_calls', 'Calls');
    case 'tps':
      return t('monitoring.column_output_tps');
    case 'latency':
      return t('monitoring.column_latency');
    case 'time':
      return t('monitoring.column_time');
    case 'usage':
      return shortLabel(t, 'monitoring.this_call_usage_short', 'monitoring.this_call_usage');
    case 'cost':
      return shortLabel(t, 'monitoring.this_call_cost_short', 'monitoring.this_call_cost');
    default:
      return key;
  }
};

const normalizeVisibleRealtimeColumns = (columns: RealtimeColumnKey[]) => {
  const selected = new Set(columns);
  const normalized = REALTIME_COLUMN_KEYS.filter((key) => selected.has(key));
  return normalized.length > 0 ? normalized : [...DEFAULT_REALTIME_COLUMNS];
};

const getRealtimeColumnMinWidth = (key: RealtimeColumnKey) =>
  key === 'usage' ? MIN_REALTIME_USAGE_COLUMN_WIDTH : MIN_REALTIME_COLUMN_WIDTH;

const clampRealtimeColumnWidth = (key: RealtimeColumnKey, value: number) =>
  Math.min(Math.max(Math.round(value), getRealtimeColumnMinWidth(key)), MAX_REALTIME_COLUMN_WIDTH);

const getRealtimeColumnWidth = (key: RealtimeColumnKey, widths: RealtimeColumnWidths) =>
  Math.max(widths[key] ?? DEFAULT_REALTIME_COLUMN_WIDTHS[key], getRealtimeColumnMinWidth(key));

export function RealtimeEventsPanelActions({
  rowCount,
  scopedFailureCount,
  failedOnlyActive,
  accountDisplayMode,
  visibleColumns,
  t,
  onToggleFailedOnly,
  onAccountDisplayModeChange,
  onColumnVisibilityChange,
  onResetColumns,
}: RealtimeEventsPanelActionsProps) {
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
  const nextAccountDisplayMode: AccountDisplayMode =
    accountDisplayMode === 'masked' ? 'full' : 'masked';
  const AccountDisplayIcon = accountDisplayMode === 'masked' ? IconEyeOff : IconEye;
  const logRowsLabel = shortLabel(t, 'monitoring.log_rows_short', 'monitoring.log_rows');
  const recentFailuresLabel = shortLabel(
    t,
    'monitoring.recent_failures_short',
    'monitoring.recent_failures'
  );
  const failedOnlyLabel = shortLabel(
    t,
    'monitoring.filter_status_failed_short',
    'monitoring.filter_status_failed'
  );
  const accountDisplayHint = t(
    accountDisplayMode === 'masked'
      ? 'monitoring.account_overview_show_full_accounts_hint'
      : 'monitoring.account_overview_show_masked_accounts_hint'
  );
  const normalizedVisibleColumns = normalizeVisibleRealtimeColumns(visibleColumns);
  const visibleColumnSet = new Set(normalizedVisibleColumns);
  const toggleColumn = (key: RealtimeColumnKey) => {
    if (visibleColumnSet.has(key)) {
      const next = normalizedVisibleColumns.filter((item) => item !== key);
      onColumnVisibilityChange(next.length > 0 ? next : normalizedVisibleColumns);
      return;
    }
    onColumnVisibilityChange(
      REALTIME_COLUMN_KEYS.filter((item) => item === key || visibleColumnSet.has(item))
    );
  };

  useEffect(() => {
    if (!columnPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && columnPickerRef.current?.contains(target)) return;
      setColumnPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setColumnPickerOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [columnPickerOpen]);

  return (
    <div className={`${styles.inlineMetrics} ${styles.realtimeHeaderActions}`}>
      <span title={t('monitoring.log_rows')}>{`${logRowsLabel}: ${rowCount}`}</span>
      <span title={t('monitoring.recent_failures')}>
        {`${recentFailuresLabel}: ${scopedFailureCount}`}
      </span>
      <button
        type="button"
        className={[
          styles.accountOverviewToolButton,
          accountDisplayMode === 'full' ? styles.accountDisplayModeButtonActive : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onAccountDisplayModeChange(nextAccountDisplayMode)}
        title={accountDisplayHint}
        aria-label={accountDisplayHint}
      >
        <AccountDisplayIcon size={15} aria-hidden="true" />
        <span>
          {t(
            accountDisplayMode === 'masked'
              ? 'monitoring.account_overview_account_display_masked'
              : 'monitoring.account_overview_account_display_full'
          )}
        </span>
      </button>
      <button
        type="button"
        className={[styles.filterToggleChip, failedOnlyActive ? styles.filterToggleChipActive : '']
          .filter(Boolean)
          .join(' ')}
        onClick={onToggleFailedOnly}
        title={t('monitoring.filter_status_failed')}
        aria-pressed={failedOnlyActive}
      >
        <IconFilter size={14} aria-hidden="true" />
        {failedOnlyLabel}
      </button>
      <div className={styles.realtimeColumnPicker} ref={columnPickerRef}>
        <button
          type="button"
          className={styles.accountOverviewToolButton}
          aria-label={t('monitoring.realtime_columns_config')}
          aria-expanded={columnPickerOpen}
          onClick={() => setColumnPickerOpen((open) => !open)}
          title={t('monitoring.realtime_columns_config')}
        >
          <IconSlidersHorizontal size={15} aria-hidden="true" />
          <span>{t('monitoring.realtime_columns_config_short')}</span>
        </button>
        {columnPickerOpen ? (
          <div className={styles.realtimeColumnPickerPanel}>
            <div className={styles.realtimeColumnPickerHeader}>
              <span>{t('monitoring.realtime_columns_config')}</span>
              <button type="button" onClick={onResetColumns}>
                {t('common.reset')}
              </button>
            </div>
            <div className={styles.realtimeColumnPickerOptions}>
              {REALTIME_COLUMN_KEYS.map((key) => (
                <label key={key} className={styles.realtimeColumnPickerOption}>
                  <input
                    type="checkbox"
                    checked={visibleColumnSet.has(key)}
                    onChange={() => toggleColumn(key)}
                  />
                  <span>{getRealtimeColumnLabel(key, t)}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RealtimeEventsPanel({
  embedded = false,
  rows,
  pagination,
  pageSize,
  scopedFailureCount,
  failedOnlyActive,
  eventsTotalCount,
  hasPrices,
  accountDisplayMode,
  visibleColumns,
  columnWidths,
  locale,
  emptyState,
  t,
  onToggleFailedOnly,
  onAccountDisplayModeChange,
  onColumnVisibilityChange,
  onColumnWidthChange,
  onResetColumns,
  onPageChange,
  onPageSizeChange,
}: RealtimeEventsPanelProps) {
  const tooltipIdPrefix = useId();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const handleCopyFailureDetails = async (text: string) => {
    const copied = await copyToClipboard(text);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };
  const actions = (
    <RealtimeEventsPanelActions
      rowCount={rows.length}
      scopedFailureCount={scopedFailureCount}
      failedOnlyActive={failedOnlyActive}
      accountDisplayMode={accountDisplayMode}
      visibleColumns={visibleColumns}
      t={t}
      onToggleFailedOnly={onToggleFailedOnly}
      onAccountDisplayModeChange={onAccountDisplayModeChange}
      onColumnVisibilityChange={onColumnVisibilityChange}
      onResetColumns={onResetColumns}
    />
  );
  const visibleColumnKeys = useMemo(
    () => normalizeVisibleRealtimeColumns(visibleColumns),
    [visibleColumns]
  );
  const [columnResizeState, setColumnResizeState] = useState<ColumnResizeState | null>(null);
  const realtimeTableMinWidth = `${Math.max(
    1120,
    visibleColumnKeys.reduce((sum, key) => sum + getRealtimeColumnWidth(key, columnWidths), 0)
  )}px`;
  const startColumnResize = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, key: RealtimeColumnKey) => {
      event.preventDefault();
      event.stopPropagation();
      setColumnResizeState({
        key,
        startX: event.clientX,
        startWidth: getRealtimeColumnWidth(key, columnWidths),
      });
    },
    [columnWidths]
  );
  useEffect(() => {
    if (!columnResizeState) return;

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - columnResizeState.startX;
      onColumnWidthChange(
        columnResizeState.key,
        clampRealtimeColumnWidth(columnResizeState.key, columnResizeState.startWidth + delta)
      );
    };
    const handlePointerUp = () => setColumnResizeState(null);

    document.body.classList.add(styles.realtimeColumnResizing);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.body.classList.remove(styles.realtimeColumnResizing);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [columnResizeState, onColumnWidthChange]);
  const renderColumnHeader = (key: RealtimeColumnKey) => {
    const label =
      key === 'latency' ? (
        <span className={styles.realtimeLatencyHeader}>
          <span className={styles.realtimeMetricLeft}>{t('monitoring.ttft_short')}</span>
          <span className={styles.realtimeMetricSeparator}>｜</span>
          <span className={styles.realtimeMetricRight}>{t('monitoring.elapsed_short')}</span>
        </span>
      ) : (
        getRealtimeColumnLabel(key, t)
      );
    return (
      <span className={styles.realtimeResizableHeader}>
        <span className={styles.realtimeResizableHeaderLabel}>{label}</span>
        <span
          className={styles.realtimeColumnResizeHandle}
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startColumnResize(event, key)}
          aria-label={`${getRealtimeColumnLabel(key, t)} ${t('monitoring.realtime_column_width')}`}
        />
      </span>
    );
  };
  const renderColumnCell = (key: RealtimeColumnKey, row: RealtimeLogRow) => {
    const sourceDisplay = buildRealtimeSourceDisplay(row, t, accountDisplayMode);
    const apiKeyDisplay = buildRealtimeApiKeyDisplay(row, t, accountDisplayMode);
    const showResolvedModel =
      row.resolvedModel && row.resolvedModel.trim() && row.resolvedModel.trim() !== row.model;
		const responseModel = formatReadableText(row.responseModel);
		const billingModel = formatReadableText(row.billingModel);
		const showResponseModel = responseModel && responseModel !== row.model;
    const reasoningEffort = formatOptionalText(row.reasoningEffort);
    const serviceSpeedLabel = isCodexRealtimeRow(row)
      ? resolveServiceSpeedTransitionLabel(row, t)
      : '';
    const failureDetails = buildFailureDetails(row, t);
    const securityAuditStatusLabel = resolveSecurityAuditStatusLabel(row, t);
    const failureTooltipId = failureDetails
      ? `${tooltipIdPrefix}-failure-tooltip-${row.id}`
      : undefined;
    const timeParts = formatRealtimeDateParts(row.timestampMs, locale);
    const hasTtftMs = row.ttftMs !== null && row.ttftMs !== undefined;
    const ttftToneClass = getRealtimeDurationToneClass(row.ttftMs);
    const latencyToneClass = getRealtimeDurationToneClass(row.latencyMs);
    const endpoint = [row.endpointMethod, row.endpointPath || row.endpoint]
      .filter(Boolean)
      .join(' ');
    const endpointDisplay = row.endpoint && row.endpoint !== endpoint ? row.endpoint : endpoint;

    switch (key) {
      case 'source':
        return (
          <div className={styles.logTypeCell}>
            <div className={styles.primaryCell} title={sourceDisplay.title}>
              <span>{sourceDisplay.primary}</span>
              {sourceDisplay.meta ? <small>{sourceDisplay.meta}</small> : null}
              {apiKeyDisplay ? (
                <small className={styles.realtimeApiKeyLine} title={apiKeyDisplay.title}>
                  {`${t('monitoring.realtime_api_key_label')}: ${apiKeyDisplay.display}`}
                </small>
              ) : null}
            </div>
          </div>
        );
      case 'model':
        return (
          <div className={styles.primaryCell}>
            <span className={styles.monoCell}>{row.model}</span>
            {showResolvedModel ? (
              <small className={styles.monoCell}>{row.resolvedModel}</small>
            ) : null}
			{showResponseModel ? (
				<small className={styles.monoCell}>
					{`${row.model} -> ${responseModel}${billingModel ? ` (${billingModel})` : ''}`}
				</small>
			) : null}
          </div>
        );
      case 'endpoint':
        return (
          <div className={styles.primaryCell}>
            <span className={styles.monoCell}>{endpointDisplay || '-'}</span>
          </div>
        );
      case 'clientIp':
        return <span className={styles.monoCell}>{formatOptionalText(row.clientIp)}</span>;
      case 'authIndex':
        return (
          <span className={styles.monoCell}>{row.authIndexMasked || row.authIndex || '-'}</span>
        );
      case 'provider':
        return (
          <div className={styles.primaryCell}>
            <span>{row.provider || '-'}</span>
            <small>{row.channel || '-'}</small>
          </div>
        );
      case 'reasoning':
        return (
          <div className={styles.primaryCell}>
            {reasoningEffort !== '-' ? (
              <span className={styles.realtimeReasoningBadge}>{reasoningEffort}</span>
            ) : (
              <span className={styles.mutedCell}>-</span>
            )}
            {serviceSpeedLabel ? (
              <small>{`${shortLabel(t, 'monitoring.service_tier_short', 'monitoring.service_tier')}: ${serviceSpeedLabel}`}</small>
            ) : null}
          </div>
        );
      case 'recent':
        return (
          <div className={styles.recentStatusCell}>
            <RecentPattern pattern={row.recentPattern} variant="plain" />
          </div>
        );
      case 'status':
        return (
          <div className={styles.primaryCell}>
            {failureDetails ? (
              <span
                className={styles.realtimeFailureStatus}
                tabIndex={0}
                aria-describedby={failureTooltipId}
                aria-label={failureDetails.label}
              >
                <span
                  className={`${styles.realtimeRequestStatus} ${styles.realtimeRequestStatusBad}`}
                >
                  {securityAuditStatusLabel || t('monitoring.result_failed')}
                </span>
                <span
                  id={failureTooltipId}
                  role="tooltip"
                  className={styles.realtimeFailureTooltip}
                >
                  <button
                    type="button"
                    className={styles.realtimeFailureCopyButton}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleCopyFailureDetails(failureDetails.copyText);
                    }}
                    title={t('common.copy')}
                    aria-label={t('common.copy')}
                  >
                    <IconCopy size={13} />
                  </button>
                  {failureDetails.statusCode ? (
                    <span className={styles.realtimeFailureTooltipStatus}>
                      {failureDetails.statusText}
                    </span>
                  ) : null}
                  {failureDetails.summary ? (
                    <span className={styles.realtimeFailureTooltipBody}>
                      {failureDetails.summary}
                    </span>
                  ) : null}
                </span>
              </span>
            ) : (
              <span
                className={[
                  styles.realtimeRequestStatus,
                  row.failed ? styles.realtimeRequestStatusBad : styles.realtimeRequestStatusGood,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {row.failed ? t('monitoring.result_failed') : t('monitoring.result_success')}
              </span>
            )}
          </div>
        );
      case 'successRate':
        return <>{formatPercent(row.successRate)}</>;
      case 'totalCalls':
        return <>{formatCompactNumber(row.requestCount)}</>;
      case 'tps':
        return (
          <span className={styles.realtimeTpsCell}>
            {formatTokensPerSecond(row.tokensPerSecond, locale)}
          </span>
        );
      case 'latency':
        return (
          <div className={styles.realtimeMetricCell}>
            <span
              className={[styles.realtimeMetricText, styles.realtimeMetricLeft, ttftToneClass]
                .filter(Boolean)
                .join(' ')}
            >
              {hasTtftMs ? formatRealtimeCompactDuration(row.ttftMs, locale) : '--'}
            </span>
            <span className={styles.realtimeMetricSeparator}>｜</span>
            <span
              className={[styles.realtimeMetricText, styles.realtimeMetricRight, latencyToneClass]
                .filter(Boolean)
                .join(' ')}
            >
              {formatRealtimeCompactDuration(row.latencyMs, locale)}
            </span>
          </div>
        );
      case 'time':
        return (
          <div className={styles.realtimeTimeCell}>
            <span className={styles.realtimeTimeLine}>{timeParts.date}</span>
            <span className={styles.realtimeTimeLine}>{timeParts.time}</span>
          </div>
        );
      case 'usage':
        return <RealtimeTokenUsageCell row={row} locale={locale} t={t} />;
      case 'cost':
        return <>{hasPrices ? formatUsd(row.totalCost, 6) : '--'}</>;
      default:
        return null;
    }
  };
  const content = (
    <>
      <div className={styles.tableWrapper}>
        <table
          className={`${styles.table} ${styles.realtimeTable}`}
          style={{ minWidth: realtimeTableMinWidth }}
        >
          <colgroup>
            {visibleColumnKeys.map((key) => (
              <col key={key} style={{ width: `${getRealtimeColumnWidth(key, columnWidths)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleColumnKeys.map((key) => (
                <th
                  key={key}
                  className={[
                    key === 'tps' ? styles.realtimeTpsColumn : '',
                    key === 'latency' ? styles.realtimeLatencyColumn : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {renderColumnHeader(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((row) => {
              return (
                <tr key={row.id} className={row.failed ? styles.logRowFailed : undefined}>
                  {visibleColumnKeys.map((key) => (
                    <td
                      key={key}
                      className={[
                        key === 'successRate'
                          ? styles[`${getMonitoringSuccessRateTone(row.successRate)}Text`]
                          : '',
                        key === 'tps' ? styles.realtimeTpsColumn : '',
                        key === 'latency' ? styles.realtimeLatencyColumn : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {renderColumnCell(key, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnKeys.length}>{emptyState}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <PaginationControls
        count={Math.max(eventsTotalCount, rows.length)}
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        pageSize={pageSize}
        pageSizeOptions={REALTIME_PAGE_SIZE_OPTIONS}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        t={t}
      />
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <MonitoringPanel
      title={t('monitoring.realtime_table_title')}
      subtitle={t('monitoring.realtime_table_desc')}
      className={styles.realtimePanel}
      extra={actions}
    >
      {content}
    </MonitoringPanel>
  );
}
