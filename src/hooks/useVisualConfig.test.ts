import { act, createElement, createRef, useImperativeHandle, type Ref } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useVisualConfig } from './useVisualConfig';

type UseVisualConfigResult = ReturnType<typeof useVisualConfig>;

type UseVisualConfigHarness = {
  getCurrent: () => UseVisualConfigResult;
  unmount: () => void;
};

function HookHarness({ hookRef }: { hookRef: Ref<UseVisualConfigResult> }) {
  const hook = useVisualConfig();
  useImperativeHandle(hookRef, () => hook, [hook]);
  return null;
}

const mountUseVisualConfig = (): UseVisualConfigHarness => {
  const hookRef = createRef<UseVisualConfigResult>();
  let renderer: ReactTestRenderer | null = null;

  act(() => {
    renderer = create(createElement(HookHarness, { hookRef }));
  });

  return {
    getCurrent: () => {
      if (!hookRef.current) {
        throw new Error('Failed to mount useVisualConfig test harness');
      }
      return hookRef.current;
    },
    unmount: () => {
      if (!renderer) return;
      act(() => {
        renderer?.unmount();
      });
    },
  };
};

describe('useVisualConfig', () => {
  it('loads API key access rules from the same configuration document', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'api-keys:',
      '  - client-a',
      'api-key-access:',
      '  - api-key: client-a',
      '    models:',
      '      - gpt-5.5',
      '    auth-ids:',
      '      - auth-1',
      '    providers:',
      '      - codex:0',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.apiKeyAccessRules).toEqual([
      { apiKey: 'client-a', models: ['gpt-5.5'], authIds: ['auth-1'], providers: ['codex:0'] },
    ]);
    harness.unmount();
  });

  it('removes access rules for API keys deleted in the visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'api-keys:',
      '  - client-a',
      '  - client-b',
      'api-key-access:',
      '  - api-key: client-a',
      '    models:',
      '      - gpt-5.5',
      '  - api-key: client-b',
      '    providers:',
      '      - codex:0',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
      harness.getCurrent().setVisualValues({ apiKeysText: 'client-b' });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).not.toContain('api-key: client-a');
    expect(savedYaml).toContain('api-key: client-b');

    harness.unmount();
  });

  it('reads and writes the Codex global compact model key', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['codex:', '  responses-compact-model: claude-sonnet-4-6', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.responsesCompactModel).toBe(
      'claude-sonnet-4-6'
    );

    act(() => {
      harness.getCurrent().setVisualValues({ responsesCompactModel: 'claude-opus-4-6' });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('codex:');
    expect(savedYaml).toContain('responses-compact-model: claude-opus-4-6');
    expect(savedYaml).not.toContain('responses-compact-fallback-model');

    harness.unmount();
  });

  it('removes the retired Codex global compact model mapping on save', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'codex:',
      '  responses-compact-model-mapping:',
      '    gpt-5.6-*: gpt-5.6-terra',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).not.toContain('responses-compact-model-mapping:');

    harness.unmount();
  });

  it('round-trips Codex model context window overrides and rejects invalid entries', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'codex:',
      '  model-context-window-overrides:',
      '    claude-opus-4-8: 272000',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexModelContextWindowOverrides).toHaveLength(1);
    expect(harness.getCurrent().visualValues.codexModelContextWindowOverrides[0]).toMatchObject({
      model: 'claude-opus-4-8',
      contextWindow: '272000',
    });

    act(() => {
      harness.getCurrent().setVisualValues({
        codexModelContextWindowOverrides: [
          { id: 'gpt', model: 'gpt-5.5', contextWindow: '200000' },
        ],
      });
    });
    expect(
      harness.getCurrent().visualValidationErrors.codexModelContextWindowOverrides
    ).toBeUndefined();
    expect(harness.getCurrent().visualDirty).toBe(true);
    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('model-context-window-overrides:');
    expect(savedYaml).toContain('gpt-5.5: 200000');

    act(() => {
      harness.getCurrent().setVisualValues({
        codexModelContextWindowOverrides: [
          { id: 'invalid-1', model: 'gpt-5.5', contextWindow: '0' },
          { id: 'invalid-2', model: 'gpt-5.5', contextWindow: '200000' },
        ],
      });
    });
    expect(harness.getCurrent().visualValidationErrors.codexModelContextWindowOverrides).toBe(
      'invalid_context_window_overrides'
    );

    harness.unmount();
  });

  it('round-trips the global image fallback model', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['image-fallback-model: gpt-5.6-luna', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.imageFallbackModel).toBe('gpt-5.6-luna');

    act(() => {
      harness.getCurrent().setVisualValues({
        imageFallbackModel: 'vision-gpt',
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('image-fallback-model: vision-gpt');

    harness.unmount();
  });

  it('defaults configured completion models to disabled', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'augment:',
      '  code-completion-model: gpt-5.6-luna',
      '  chat-input-completion-model: claude-haiku-4-5',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.augmentUseConfiguredCompletionModels).toBe(false);
    expect(harness.getCurrent().visualValues.augmentCodeCompletionModel).toBe('gpt-5.6-luna');
    expect(harness.getCurrent().visualValues.augmentChatInputCompletionModel).toBe(
      'claude-haiku-4-5'
    );

    harness.unmount();
  });

  it('round-trips plugin system toggle', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['plugins:', '  enabled: false', '  dir: plugins', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.pluginsEnabled).toBe(false);

    act(() => {
      harness.getCurrent().setVisualValues({ pluginsEnabled: true });
    });
    expect(harness.getCurrent().visualDirty).toBe(true);

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('plugins:');
    expect(savedYaml).toContain('enabled: true');
    expect(savedYaml).toContain('dir: plugins');

    harness.unmount();
  });

  it('migrates legacy codex identityConfuse to identity-mode from visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'host: 127.0.0.1',
      'codex:',
      '  identityConfuse: true',
      '  other-setting: kept',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexIdentityMode).toBe('confuse');

    act(() => {
      harness.getCurrent().setVisualValues({ codexIdentityMode: 'off' });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).not.toContain('identityConfuse: true');
    expect(savedYaml).not.toContain('identityConfuse:');
    expect(savedYaml).not.toContain('identity-confuse:');
    expect(savedYaml).toContain('identity-mode: off');
    expect(savedYaml).toContain('other-setting: kept');

    harness.unmount();
  });

  it('reads codex identity-mode and writes the selected tier', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', 'codex:', '  identity-mode: device', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexIdentityMode).toBe('device');

    act(() => {
      harness.getCurrent().setVisualValues({ codexIdentityMode: 'full' });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('identity-mode: full');

    harness.unmount();
  });

  it('drops the legacy identity-confuse key when writing identity-mode', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'host: 127.0.0.1',
      'codex:',
      '  identity-confuse: true',
      '  other-setting: kept',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexIdentityMode).toBe('confuse');

    act(() => {
      harness.getCurrent().setVisualValues({ codexIdentityMode: 'full' });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).not.toContain('identity-confuse:');
    expect(savedYaml).toContain('identity-mode: full');
    expect(savedYaml).toContain('other-setting: kept');

    harness.unmount();
  });

  it('round-trips codex bug mode from visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', 'codex:', '  force-super-category: true', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexBugMode).toBe(false);
    expect(harness.getCurrent().visualValues.codexForceSuperCategory).toBe(true);

    act(() => {
      harness.getCurrent().setVisualValues({ codexBugMode: true });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('codex:');
    expect(savedYaml).toContain('force-super-category: true');
    expect(savedYaml).toContain('bug-mode: true');

    harness.unmount();
  });

  it('round-trips global Claude cache-related toggles', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'host: 127.0.0.1',
      'disable-claude-cloak-mode: false',
      'experimental-cch-signing: false',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.disableClaudeCloakMode).toBe(false);
    expect(harness.getCurrent().visualValues.experimentalCCHSigning).toBe(false);

    act(() => {
      harness.getCurrent().setVisualValues({
        disableClaudeCloakMode: true,
        experimentalCCHSigning: true,
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('disable-claude-cloak-mode: true');
    expect(savedYaml).toContain('experimental-cch-signing: true');

    harness.unmount();
  });

  it('round-trips augment and kiro request policy fields', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'augment:',
      '  silent-mode-model: gpt-5.5',
      '  image-fallback-model: qwen3.5-plus',
      '  codebase-retrieval-model: claude-sonnet-4-5',
      '  use-configured-completion-models: true',
      '  code-completion-model: gpt-5.6-luna',
      '  chat-input-completion-model: claude-haiku-4-5',
      'kiro-request-policy:',
      '  per-account-rpm-limit: 20',
      '  rpm-limits:',
      '    free: 12',
      '    pro: 60',
      '  cooldown-strategy: linear',
      '  base-cooldown-seconds: 300',
      '  max-cooldown-seconds: 1800',
      '  consecutive-error-cooldown-threshold: 5',
      '  consecutive-error-disable-threshold: 20',
      '  invalid-auth-auto-disable: true',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.augmentSilentModeModel).toBe('gpt-5.5');
    expect(harness.getCurrent().visualValues.augmentCodebaseRetrievalModel).toBe(
      'claude-sonnet-4-5'
    );
    expect(harness.getCurrent().visualValues.augmentUseConfiguredCompletionModels).toBe(true);
    expect(harness.getCurrent().visualValues.augmentCodeCompletionModel).toBe('gpt-5.6-luna');
    expect(harness.getCurrent().visualValues.augmentChatInputCompletionModel).toBe(
      'claude-haiku-4-5'
    );
    expect(harness.getCurrent().visualValues.kiroProRpmLimit).toBe('60');

    act(() => {
      harness.getCurrent().setVisualValues({
        augmentCodebaseRetrievalModel: 'gpt-5.5',
        augmentUseConfiguredCompletionModels: false,
        augmentCodeCompletionModel: 'gpt-5.6-luna',
        augmentChatInputCompletionModel: 'gpt-5.6-luna',
        augmentShowThinkingProgress: true,
        kiroCooldownStrategy: 'exponential',
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('codebase-retrieval-model: gpt-5.5');
    expect(savedYaml).toContain('use-configured-completion-models: false');
    expect(savedYaml).toContain('code-completion-model: gpt-5.6-luna');
    expect(savedYaml).toContain('chat-input-completion-model: gpt-5.6-luna');
    expect(savedYaml).toContain('show-thinking-progress: true');
    expect(savedYaml).not.toContain('image-fallback-model: qwen3.5-plus');
    expect(savedYaml).toContain('cooldown-strategy: exponential');

    harness.unmount();
  });

  it('round-trips usage models with ordering metadata', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'usage-models:',
      '  gpt-5.5:',
      '    displayName: GPT-5.5',
      '    shortName: gpt5.5',
      '    description: 修复 Bug 的主力',
      '    disabled: false',
      '    isNew: true',
      '    isDefault: true',
      '    modelGroupPriority: 0',
      '    priority: 1',
      '  old-model:',
      '    displayName: Old Model',
      '    disabled: false',
      '    isLegacyModel: true',
      '    modelGroupPriority: 1',
      '    priority: 1',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.usageModels).toHaveLength(2);
    expect(harness.getCurrent().visualValues.usageModels[0].name).toBe('gpt-5.5');

    act(() => {
      harness.getCurrent().setVisualValues({
        usageModels: harness
          .getCurrent()
          .visualValues.usageModels.map((model) =>
            model.name === 'old-model'
              ? { ...model, modelGroupPriority: 0, priority: 2, isDefault: false }
              : model
          ),
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('usage-models:');
    expect(savedYaml).toContain('displayName: GPT-5.5');
    expect(savedYaml).toContain('modelGroupPriority: 0');
    expect(savedYaml).toContain('priority: 2');

    harness.unmount();
  });
});
