/**
 * Long-task acceptance benchmark: three scripted scenarios that prove the
 * evidence gate refuses, the budget stop continues, and a crash-interrupted
 * session resumes. It asserts outcomes only — never a time budget.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runBuiltBenchmarkWorker } from '../support/built-worker.ts'
import { SCENARIOS } from './scenarios.ts'
import type { AcceptanceReport } from './long-task-acceptance.worker.ts'

const WORKER = join(import.meta.dirname, '..', '.dsh-build', 'long-task-acceptance', 'long-task-acceptance.worker.js')
const WORKER_TIMEOUT_MS = 120_000

async function runScenario(name: string): Promise<AcceptanceReport> {
  const root = await mkdtemp(join(tmpdir(), 'long-task-acceptance-bench-'))
  try {
    const outcome = await runBuiltBenchmarkWorker<AcceptanceReport>({
      worker: WORKER,
      args: [name],
      timeoutMs: WORKER_TIMEOUT_MS,
    })
    if (outcome.timedOut || outcome.signal !== null || outcome.exitCode !== 0 || outcome.report === undefined) {
      throw new Error(`acceptance worker failed for ${name}: ${JSON.stringify(outcome)}`)
    }
    return outcome.report
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('long-task acceptance', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name} completes with the expected mechanism trail`, async () => {
      const report = await runScenario(scenario.name)
      // Printed so a run leaves the JSON record the implementation doc asks for.
      console.log(`long-task-acceptance ${JSON.stringify(report)}`)
      expect(report.ok, report.detail ?? '').toBe(true)
      expect(report.resumes).toBe(scenario.resumes)
      expect(report.turns).toBe(scenario.turns)
      expect(report.budgetStops).toBe(scenario.budgetStops)
    })
  }
})
