/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIRO_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG
} from '@/components/quota';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AntigravityQuotaState, AuthFileItem, CodexQuotaState, KiroQuotaState } from '@/types';
import {
  buildCodexQuotaWindows,
  getStatusFromError,
  isUpstreamStatusError,
  parseCodexUsagePayload,
} from '@/utils/quota';
import { authFilesApi } from '@/services/api/authFiles';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType
} from '@/features/authFiles/constants';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import styles from '@/features/authFiles/AuthFilesPage.module.scss';

export type QuotaState = {
  status?: string;
  error?: string;
  errorStatus?: number;
  upstreamError?: boolean;
} | undefined;
const noopQuotaStateUpdater = (() => undefined) as unknown as (updater: unknown) => void;
const getQuotaConfig = (type: QuotaProviderType) => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG;
  if (type === 'claude') return CLAUDE_CONFIG;
  if (type === 'codex') return CODEX_CONFIG;
  if (type === 'kiro') return KIRO_CONFIG;
  if (type === 'kimi') return KIMI_CONFIG;
  if (type === 'xai') return XAI_CONFIG;
  return GEMINI_CLI_CONFIG;
};

export const getQuotaI18nPrefix = (type: QuotaProviderType): string =>
  getQuotaConfig(type).i18nPrefix;

export const preserveCodexPlanType = (
  quotaType: QuotaProviderType,
  previousState: unknown,
  nextState: unknown
): unknown => {
  if (
    quotaType !== 'codex' ||
    !previousState ||
    typeof previousState !== 'object' ||
    !nextState ||
    typeof nextState !== 'object'
  ) {
    return nextState;
  }

  const planType = (previousState as { planType?: unknown }).planType;
  if (typeof planType !== 'string' || !planType.trim()) return nextState;

  return { ...nextState, planType };
};

export const getAuthFileQuotaErrorMessage = (t: TFunction, quota: QuotaState): string => {
  const quotaErrorStatus =
    quota && typeof quota === 'object' && 'errorStatus' in quota ? quota.errorStatus : undefined;
  const quotaError = quota && typeof quota === 'object' && 'error' in quota ? quota.error : undefined;
  const quotaUpstreamError =
    quota && typeof quota === 'object' && 'upstreamError' in quota
      ? quota.upstreamError
      : undefined;

  return resolveQuotaErrorMessage(
    t,
    quotaErrorStatus,
    quotaError || t('common.unknown_error'),
    quotaUpstreamError
  );
};

export const buildEmbeddedCodexQuota = (
  file: AuthFileItem,
  t: TFunction
): CodexQuotaState | undefined => {
  if (!file.codex_quota || !file.codex_quota_updated_at_ms) return undefined;
  const payload = parseCodexUsagePayload(file.codex_quota);
  if (!payload) return undefined;
  const payloadPlanType =
    typeof payload.plan_type === 'string'
      ? payload.plan_type.trim().toLowerCase()
      : typeof payload.planType === 'string'
        ? payload.planType.trim().toLowerCase()
        : null;
  const resetCredits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits;
  return {
    status: 'success',
    windows: buildCodexQuotaWindows(payload, t),
    planType: payloadPlanType,
    rateLimitResetCreditsAvailableCount: normalizeNumberValue(
      resetCredits?.available_count ?? resetCredits?.availableCount
    ),
    fetchedAtMs: file.codex_quota_updated_at_ms
  };
};

const normalizeNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildEmbeddedAntigravityQuota = (file: AuthFileItem): AntigravityQuotaState | undefined => {
  const creditBalance = normalizeNumberValue(file.credit_balance ?? file.creditBalance);
  if (creditBalance === null) return undefined;
  return {
    status: 'success',
    groups: [],
    creditBalance
  };
};

const isCodexQuotaWithoutWindows = (quota: unknown): quota is CodexQuotaState => {
  return Boolean(
    quota &&
      typeof quota === 'object' &&
      'windows' in quota &&
      Array.isArray((quota as CodexQuotaState).windows) &&
      (quota as CodexQuotaState).windows.length === 0
  );
};

export const getCodexQuotaResetCreditsAvailableCount = (quota: unknown): number | null => {
  if (!quota || typeof quota !== 'object' || !('rateLimitResetCreditsAvailableCount' in quota)) {
    return null;
  }
  const value = (quota as CodexQuotaState).rateLimitResetCreditsAvailableCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const normalizeString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const resolveKiroSubscriptionTitle = (file: AuthFileItem): string | null => {
  const direct = normalizeString(file.subscription_title ?? file.subscriptionTitle);
  if (direct) return direct;

  const info = file.subscriptionInfo;
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    const nested = normalizeString((info as Record<string, unknown>).subscriptionTitle);
    if (nested) return nested;
  }

  const tier = normalizeString(file.subscription_tier ?? file.subscription_type)?.toLowerCase();
  if (tier === 'pro' || tier === 'paid') return 'KIRO PRO';
  if (tier === 'free' || tier === 'free_trial') return 'KIRO FREE';
  return null;
};

const buildEmbeddedKiroQuota = (file: AuthFileItem): KiroQuotaState | undefined => {
  const subscriptionTitle = resolveKiroSubscriptionTitle(file);
  if (!subscriptionTitle) return undefined;
  const overageStatus = normalizeString(file.overage_status ?? file.overageStatus);
  return {
    status: 'success',
    subscriptionTitle,
    baseQuota: null,
    freeTrialQuota: null,
    overageQuota: null,
    overageStatus
  };
};

const isKiroQuotaWithoutDetails = (quota: unknown): quota is KiroQuotaState => {
  return Boolean(
    quota &&
      typeof quota === 'object' &&
      'baseQuota' in quota &&
      'freeTrialQuota' in quota &&
      !(quota as KiroQuotaState).baseQuota &&
      !(quota as KiroQuotaState).freeTrialQuota &&
      !(quota as KiroQuotaState).overageQuota
  );
};

type DefinedQuotaState = Exclude<QuotaState, undefined>;

export const selectEffectiveQuota = <
  T extends DefinedQuotaState,
  U extends DefinedQuotaState
>(quota: T | undefined, embeddedQuota: U | undefined): T | U | undefined => {
  if (!quota) return embeddedQuota;
  if (!embeddedQuota || quota.status !== 'success' || embeddedQuota.status !== 'success') {
    return quota;
  }
  const quotaTime =
    'observedAtMs' in quota && typeof quota.observedAtMs === 'number'
      ? quota.observedAtMs
      : 'fetchedAtMs' in quota && typeof quota.fetchedAtMs === 'number'
        ? quota.fetchedAtMs
        : 0;
  const embeddedTime =
    'fetchedAtMs' in embeddedQuota && typeof embeddedQuota.fetchedAtMs === 'number'
      ? embeddedQuota.fetchedAtMs
      : 0;
  return embeddedTime > quotaTime ? embeddedQuota : quota;
};

const getKiroOverageEnabled = (quota: unknown): boolean | null => {
  if (!quota || typeof quota !== 'object' || !('overageStatus' in quota)) return null;
  const status = normalizeString((quota as KiroQuotaState).overageStatus);
  if (!status) return null;
  return status.toUpperCase() === 'ENABLED';
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
};

export function useAuthFileQuotaRefresh(
  file: AuthFileItem,
  quotaType: QuotaProviderType | null,
  disableControls: boolean
) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const quota = useQuotaStore((state) => {
    if (!quotaType) return undefined;
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kiro') return state.kiroQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    if (quotaType === 'xai') return state.xaiQuota[file.name] as QuotaState;
    return state.geminiCliQuota[file.name] as QuotaState;
  });
  const embeddedQuota =
    quotaType === 'codex'
      ? (buildEmbeddedCodexQuota(file, t) as QuotaState)
      : quotaType === 'antigravity'
        ? (buildEmbeddedAntigravityQuota(file) as QuotaState)
      : quotaType === 'kiro'
        ? (buildEmbeddedKiroQuota(file) as QuotaState)
        : undefined;
  const effectiveQuota = selectEffectiveQuota(quota, embeddedQuota);

  const updateQuotaState = useQuotaStore((state) => {
    if (!quotaType) return noopQuotaStateUpdater;
    if (quotaType === 'antigravity') return state.setAntigravityQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'claude') return state.setClaudeQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kiro') return state.setKiroQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'xai') return state.setXaiQuota as unknown as (updater: unknown) => void;
    return state.setGeminiCliQuota as unknown as (updater: unknown) => void;
  });

  const requestAuthFilesRefresh = useCallback(() => {
    window.dispatchEvent(new Event('auth-files-refresh'));
  }, []);

  const refreshQuotaForFile = useCallback(async () => {
    if (!quotaType) return;
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;

    const config = getQuotaConfig(quotaType) as unknown as {
      i18nPrefix: string;
      fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildLoadingState: () => unknown;
      buildSuccessState: (data: unknown) => unknown;
      buildErrorState: (message: string, status?: number, upstreamError?: boolean) => unknown;
      renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
    };

    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: preserveCodexPlanType(
        quotaType,
        prev[file.name],
        config.buildLoadingState()
      )
    }));

    try {
      const data = await config.fetchQuota(file, t);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildSuccessState(data)
      }));
      requestAuthFilesRefresh();
      showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      const upstreamError = isUpstreamStatusError(err);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: preserveCodexPlanType(
          quotaType,
          prev[file.name],
          config.buildErrorState(message, status, upstreamError)
        )
      }));
      requestAuthFilesRefresh();
      showNotification(t('auth_files.quota_refresh_failed', { name: file.name, message }), 'error');
    }
  }, [
    disableControls,
    file,
    quota?.status,
    quotaType,
    requestAuthFilesRefresh,
    showNotification,
    t,
    updateQuotaState
  ]);

  const quotaStatus = effectiveQuota?.status ?? 'idle';
  const canRefreshQuota = Boolean(quotaType) && !disableControls && !file.disabled;

  return {
    quota: effectiveQuota,
    quotaStatus,
    canRefreshQuota,
    refreshQuotaForFile
  };
}

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [isUpdatingKiroOverage, setIsUpdatingKiroOverage] = useState(false);
  const { quota, quotaStatus, canRefreshQuota, refreshQuotaForFile } = useAuthFileQuotaRefresh(
    file,
    quotaType,
    disableControls
  );

  const config = getQuotaConfig(quotaType) as unknown as {
    i18nPrefix: string;
    renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
  };
  const quotaErrorMessage = getAuthFileQuotaErrorMessage(t, quota);
  const renderQuotaRefreshAction = () => {
    if (!canRefreshQuota) return null;

    return (
      <button
        type="button"
        className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
        onClick={() => void refreshQuotaForFile()}
      >
        {t(`${config.i18nPrefix}.idle`)}
      </button>
    );
  };

  const requestKiroOverageUpdate = useCallback(
    (enabled: boolean) => {
      showConfirmation({
        title: enabled
          ? t('kiro_quota.overage_enable_confirm_title')
          : t('kiro_quota.overage_disable_confirm_title'),
        message: enabled
          ? t('kiro_quota.overage_enable_confirm_message', { name: file.name })
          : t('kiro_quota.overage_disable_confirm_message', { name: file.name }),
        confirmText: enabled
          ? t('kiro_quota.overage_enable_button')
          : t('kiro_quota.overage_disable_button'),
        variant: enabled ? 'danger' : 'primary',
        onConfirm: async () => {
          setIsUpdatingKiroOverage(true);
          try {
            await authFilesApi.setKiroOverage(file.name, enabled);
            showNotification(t('kiro_quota.overage_update_success'), 'success');
            await refreshQuotaForFile();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            showNotification(t('kiro_quota.overage_update_failed', { message }), 'error');
          } finally {
            setIsUpdatingKiroOverage(false);
          }
        }
      });
    },
    [file.name, refreshQuotaForFile, showConfirmation, showNotification, t]
  );

  const renderKiroOverageAction = () => {
    if (quotaType !== 'kiro' || quotaStatus !== 'success') return null;
    const enabled = getKiroOverageEnabled(quota);
    if (enabled === null) return null;

    return (
      <div className={styles.kiroOverageActionRow}>
        <span className={styles.kiroOverageStatus}>
          {enabled ? t('kiro_quota.overage_enabled') : t('kiro_quota.overage_disabled')}
        </span>
        <button
          type="button"
          className={styles.kiroOverageButton}
          disabled={!canRefreshQuota || isUpdatingKiroOverage}
          onClick={() => requestKiroOverageUpdate(!enabled)}
        >
          {enabled ? t('kiro_quota.overage_disable_button') : t('kiro_quota.overage_enable_button')}
        </button>
      </div>
    );
  };

  const renderQuotaSuccessItems = () => {
    if (quotaType === 'codex' && isCodexQuotaWithoutWindows(quota)) {
      return renderQuotaRefreshAction();
    }

    if (quotaType === 'kiro' && isKiroQuotaWithoutDetails(quota)) {
      return (
        <>
          {quota.subscriptionTitle ? (
            <div className={styles.codexPlan}>
              <span className={styles.codexPlanLabel}>{t('kiro_quota.subscription_label')}</span>
              <span className={styles.codexPlanValue}>{quota.subscriptionTitle}</span>
            </div>
          ) : null}
          {renderKiroOverageAction()}
          {renderQuotaRefreshAction()}
        </>
      );
    }

    return (
      <>
        {config.renderQuotaItems(quota, t, { styles, QuotaProgressBar }) as ReactNode}
        {renderKiroOverageAction()}
      </>
    );
  };

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        renderQuotaRefreshAction()
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage
          })}
        </div>
      ) : quota ? (
        renderQuotaSuccessItems()
      ) : (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>
      )}
    </div>
  );
}
