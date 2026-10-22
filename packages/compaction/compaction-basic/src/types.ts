/**
 * Configuration vocabulary for the replay-aware basic compaction backend.
 *
 * @module @deepseek-ai/dsh-compaction-basic/types
 */

import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

/** Policy fields shared by the default policy and exact model overrides. */
export interface CompactionPolicyConfig {
  /** Compact at this fraction of the model's context window. Defaults to `0.8`. */
  thresholdRatio?: number
  /** Recent context retained as a fraction of the model's window. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /** Provider generation cap for summarization. Defaults to `8192`. */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`. */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
export interface ModelCompactPolicyConfig extends CompactionPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `provider`. */
  model: string
}

/** Basic compaction configuration with an optional exact-target policy table. */
export interface BasicCompactionConfig extends CompactionPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
  /**
   * Write every summary to a re-readable sidecar file and name its path inside
   * the checkpoint. Defaults to `false`. A sidecar keeps the full summary
   * recoverable after a later compaction folds it into a coarser one.
   */
  sidecar?: boolean
  /**
   * Root directory for sidecar files. Omitted uses a private (0700)
   * per-process directory under the OS temp dir, mirroring the spill backend.
   */
  sidecarRoot?: string
  /**
   * Capacity assumed for a routed model whose adapter declares no context
   * window. Without a value, pressure compaction cannot run at all for that
   * model: the only remaining recovery is a provider-reported overflow, which
   * some gateways never send before closing the connection. Defaults to
   * `100000`; `0` disables the fallback and restores the strict requirement.
   */
  fallbackContextWindow?: number
  /**
   * Age in days past which a sidecar file is removed by the one startup sweep.
   * Defaults to `30`; `0` disables sweeping. Only applies when `sidecar` is on
   * and `sidecarRoot` is configured.
   */
  sidecarRetentionDays?: number
  /**
   * Interval for the periodic sidecar sweep, in milliseconds. Defaults to one
   * hour; `0` runs only the single startup pass.
   */
  sidecarSweepIntervalMs?: number
}

/** Exactly one validated retention form. */
export type ResolvedRetention =
  | { readonly retainRatio: number; readonly retainTokens?: never }
  | { readonly retainRatio?: never; readonly retainTokens: number }

/** Validated policy fields shared before and after exact-target matching. */
interface ResolvedPolicyFields {
  readonly thresholdRatio: number
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
  readonly compactionRetries: number
  readonly maxOverflowRetries: number
}

/** Validated immutable config whose target-specific defaults remain unresolved. */
export type ResolvedConfig = ResolvedPolicyFields & ResolvedRetention & {
  readonly modelPolicies: readonly Readonly<ModelCompactPolicyConfig>[]
  readonly auto: boolean
  readonly sidecar: boolean
  readonly sidecarRoot?: string
  readonly sidecarRetentionDays: number
  readonly sidecarSweepIntervalMs: number
  readonly fallbackContextWindow: number
}

/** Fully merged policy for one routed conversation target, before capacity scaling. */
export type ResolvedTargetPolicy = ResolvedPolicyFields & ResolvedRetention & {
  readonly target: Pick<LlmCallConfig, 'provider' | 'model'>
}

/** One routed model's concrete pressure and retention budget. */
export type ResolvedCompactSpec = Omit<ResolvedTargetPolicy, 'retainRatio' | 'retainTokens'> & {
  readonly contextWindow: number
  readonly thresholdTokens: number
  readonly retainTokens: number
}
