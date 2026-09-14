import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  buildEmbeddedCodexQuota,
  getAuthFileQuotaErrorMessage,
  preserveCodexPlanType,
  selectEffectiveQuota
} from './AuthFileQuotaSection';

const t = ((key: string) => {
  if (key === 'common.unknown_error') return '未知错误';
  if (key === 'common.quota_update_required') return '请更新 CPA 版本或检查更新';
  if (key === 'common.quota_check_credential') return '请检查凭证状态';
  return key;
}) as TFunction;

describe('getAuthFileQuotaErrorMessage', () => {
  it('保留额度刷新失败返回的错误内容', () => {
    expect(
      getAuthFileQuotaErrorMessage(t, { status: 'error', error: 'upstream failed', errorStatus: 500 })
    ).toBe('upstream failed');
  });

  it('根据状态码使用卡片模式的通用错误文案', () => {
    expect(getAuthFileQuotaErrorMessage(t, { status: 'error', error: 'not found', errorStatus: 404 })).toBe(
      '请更新 CPA 版本或检查更新'
    );
  });

  it('官方上游返回 404 时展示真实错误而不是提示更新 CPA', () => {
    expect(
      getAuthFileQuotaErrorMessage(t, {
        status: 'error',
        error: '404 official endpoint not found',
        errorStatus: 404,
        upstreamError: true,
      })
    ).toBe('404 official endpoint not found');
  });

  it('官方上游返回 403 时展示真实错误而不是提示检查凭证', () => {
    expect(
      getAuthFileQuotaErrorMessage(t, {
        status: 'error',
        error: '403 blocked by provider',
        errorStatus: 403,
        upstreamError: true,
      })
    ).toBe('403 blocked by provider');
  });
});

describe('buildEmbeddedCodexQuota', () => {
  it('将启动预热保存的 Codex 用量转换为可直接展示的额度', () => {
    const quota = buildEmbeddedCodexQuota(
      {
        name: 'codex-user.json',
        type: 'codex',
        codex_quota_updated_at_ms: 123456,
        codex_quota: {
          plan_type: 'plus',
          rate_limit: {
            primary_window: {
              used_percent: 35,
              limit_window_seconds: 18000,
              reset_after_seconds: 900,
            },
          },
          rate_limit_reset_credits: { available_count: 2 },
        },
      },
      t
    );

    expect(quota).toMatchObject({
      status: 'success',
      planType: 'plus',
      fetchedAtMs: 123456,
      rateLimitResetCreditsAvailableCount: 2,
    });
    expect(quota?.windows).toHaveLength(1);
    expect(quota?.windows[0]).toMatchObject({ id: 'five-hour', usedPercent: 35 });
  });

  it('没有 SQLite 快照时不伪造额度状态', () => {
    expect(buildEmbeddedCodexQuota({ name: 'codex-user.json', type: 'codex' }, t)).toBeUndefined();
  });

  it('将 429 响应头保存的已用 100% 额度保留为剩余 0% 的有效窗口', () => {
    const quota = buildEmbeddedCodexQuota(
      {
        name: 'codex-exhausted.json',
        type: 'codex',
        codex_quota_updated_at_ms: 123456,
        codex_quota: {
          plan_type: 'plus',
          rate_limit: {
            primary_window: {
              used_percent: 100,
              limit_window_seconds: 604800,
              reset_after_seconds: 3600,
            },
          },
        },
      },
      t
    );

    expect(quota?.windows).toHaveLength(1);
    expect(quota?.windows[0]).toMatchObject({ id: 'weekly', usedPercent: 100 });
  });
});

describe('selectEffectiveQuota', () => {
  it('使用时间更新的启动预热额度覆盖旧的页面缓存', () => {
    const cached = { status: 'success', fetchedAtMs: 1000 };
    const startup = { status: 'success', fetchedAtMs: 2000 };

    expect(selectEffectiveQuota(cached, startup)).toBe(startup);
  });

  it('保留时间更新的响应头额度', () => {
    const headers = { status: 'success', observedAtMs: 3000 };
    const startup = { status: 'success', fetchedAtMs: 2000 };

    expect(selectEffectiveQuota(headers, startup)).toBe(headers);
  });

  it('不会用旧的持久化快照覆盖刚刚刷新的额度', () => {
    const refreshed = { status: 'success', fetchedAtMs: 3000 };
    const persisted = { status: 'success', fetchedAtMs: 2000 };

    expect(selectEffectiveQuota(refreshed, persisted)).toBe(refreshed);
  });
});

describe('preserveCodexPlanType', () => {
  it('刷新期间保留 Codex 套餐，避免依赖套餐的卡片排序跳动', () => {
    expect(
      preserveCodexPlanType(
        'codex',
        { status: 'success', planType: 'team' },
        { status: 'loading', windows: [] }
      )
    ).toEqual({ status: 'loading', windows: [], planType: 'team' });
  });

  it('刷新失败后继续保留 Codex 套餐', () => {
    expect(
      preserveCodexPlanType(
        'codex',
        { status: 'loading', planType: 'team' },
        { status: 'error', error: 'upstream failed' }
      )
    ).toEqual({ status: 'error', error: 'upstream failed', planType: 'team' });
  });
});
