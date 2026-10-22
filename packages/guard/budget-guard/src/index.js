/**
 * Runtime budgets for one agent session: per-turn step, token, and wall-clock
 * ceilings plus a whole-session turn cap. The guard stops a turn at a step
 * boundary with a durable `budget/stop` record instead of letting a runaway loop
 * spend without bound, and a soft threshold asks the model to leave a handoff
 * first.
 * @module @deepseek-ai/dsh-budget-guard
 */
import z from '@deepseek-ai/schemastery';
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';
/** Plugin name. */
export const name = 'budget-guard';
/** Services the guard reads: prompt sections and the agent registry for usage attribution. */
export const inject = ['systemPrompt', 'agents'];
/** Schemastery configuration schema. */
export const Config = z.object({
    maxStepsPerTurn: z.number().step(1).min(1),
    maxTurns: z.number().step(1).min(1),
    maxTokensPerTurn: z.number().step(1).min(1),
    maxWallClockMsPerTurn: z.number().step(1).min(1),
    warnAtRatio: z.number().min(0.1).max(1).default(0.8),
});
function positive(value, field) {
    if (value === undefined)
        return undefined;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`budget-guard: ${field} must be a positive safe integer`);
    }
    return value;
}
function resolveConfig(config) {
    const warnAtRatio = config.warnAtRatio ?? 0.8;
    if (!Number.isFinite(warnAtRatio) || warnAtRatio < 0.1 || warnAtRatio > 1) {
        throw new TypeError('budget-guard: warnAtRatio must be between 0.1 and 1');
    }
    return {
        maxStepsPerTurn: config.maxStepsPerTurn === undefined
            ? undefined : positive(config.maxStepsPerTurn, 'maxStepsPerTurn'),
        maxTurns: config.maxTurns === undefined
            ? undefined : positive(config.maxTurns, 'maxTurns'),
        maxTokensPerTurn: config.maxTokensPerTurn === undefined
            ? undefined : positive(config.maxTokensPerTurn, 'maxTokensPerTurn'),
        maxWallClockMsPerTurn: config.maxWallClockMsPerTurn === undefined
            ? undefined : positive(config.maxWallClockMsPerTurn, 'maxWallClockMsPerTurn'),
        warnAtRatio,
    };
}
/** Input plus output tokens of one settlement, when the provider reported usage. */
function usageTokens(usage) {
    if (usage === undefined)
        return 0;
    return usage.inputTokens + usage.outputTokens;
}
/**
 * Install the budget guard.
 * @param ctx - plugin context; listeners and the prompt section are disposed with it.
 * @param config - validated deployment budget policy.
 */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const counters = new WeakMap();
    ctx.systemPrompt.section({
        name: 'guard:budget',
        order: 550,
        text: 'Runtime budgets may stop this turn at a step boundary. If a budget warning arrives, '
            + 'record what remains and how to resume it before the turn ends, so the next turn can '
            + 'continue from a durable handoff rather than from memory of this conversation.',
    });
    const observeUsage = (session, event) => {
        if (event.type !== 'assistant/message' || event.data.usage === undefined)
            return;
        const agent = ctx.agents.get(session.id);
        if (agent === undefined)
            return;
        const live = counters.get(agent);
        if (live === undefined || live.turn !== event.data.turn)
            return;
        live.tokens += usageTokens(event.data.usage);
    };
    ctx.on('session/event', observeUsage);
    /** Evaluate every configured limit; the first exceeded reason wins. */
    function evaluate(live, turn, step) {
        const reasons = [];
        if (resolved.maxStepsPerTurn !== undefined && step > resolved.maxStepsPerTurn) {
            reasons.push({ turn, reason: 'steps', limit: resolved.maxStepsPerTurn, observed: step });
        }
        if (resolved.maxTokensPerTurn !== undefined && live.tokens > resolved.maxTokensPerTurn) {
            reasons.push({
                turn,
                reason: 'tokens',
                limit: resolved.maxTokensPerTurn,
                observed: live.tokens,
            });
        }
        const elapsed = Date.now() - live.startedAt;
        if (resolved.maxWallClockMsPerTurn !== undefined && elapsed > resolved.maxWallClockMsPerTurn) {
            reasons.push({
                turn,
                reason: 'wall-clock',
                limit: resolved.maxWallClockMsPerTurn,
                observed: elapsed,
            });
        }
        const first = reasons[0];
        if (first !== undefined)
            return { kind: 'stop', stop: first };
        if (live.warned || resolved.warnAtRatio >= 1)
            return undefined;
        const near = [
            resolved.maxStepsPerTurn !== undefined && step >= resolved.maxStepsPerTurn * resolved.warnAtRatio
                ? `steps ${String(step)}/${String(resolved.maxStepsPerTurn)}` : undefined,
            resolved.maxTokensPerTurn !== undefined
                && live.tokens >= resolved.maxTokensPerTurn * resolved.warnAtRatio
                ? `tokens ~${String(live.tokens)}/${String(resolved.maxTokensPerTurn)}` : undefined,
            resolved.maxWallClockMsPerTurn !== undefined
                && elapsed >= resolved.maxWallClockMsPerTurn * resolved.warnAtRatio
                ? `wall-clock ${String(Math.round(elapsed / 1000))}s/${String(Math.round(resolved.maxWallClockMsPerTurn / 1000))}s`
                : undefined,
        ].filter((item) => item !== undefined);
        if (near.length === 0)
            return undefined;
        live.warned = true;
        return {
            kind: 'warn',
            text: '<budget_warning>\n'
                + `Approaching the turn budget (${near.join(', ')}). If the objective is not yet complete, `
                + 'record the remaining work and how to resume it — a task handoff, a file, or a decision '
                + 'note — because the turn may stop at the next step boundary.\n'
                + '</budget_warning>',
        };
    }
    ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
        // A session-wide turn cap is checked even on the first step of a turn.
        if (resolved.maxTurns !== undefined && turn > resolved.maxTurns && step === 1) {
            const stop = { turn, reason: 'steps', limit: resolved.maxTurns, observed: turn };
            agent.session.append('budget/stop', stop, { ignorable: true });
            return { kind: 'reject' };
        }
        let live = counters.get(agent);
        if (live === undefined || live.turn !== turn) {
            live = { turn, startedAt: Date.now(), tokens: 0, warned: false };
            counters.set(agent, live);
        }
        const verdict = evaluate(live, turn, step);
        if (verdict?.kind === 'stop') {
            agent.session.append('budget/stop', verdict.stop, { ignorable: true });
            return { kind: 'reject' };
        }
        const decision = await next();
        if (verdict?.kind === 'warn' && decision.kind !== 'reject') {
            return {
                ...decision,
                messages: [...decision.messages, createUserMessage({
                        content: [{ type: 'text', text: verdict.text }],
                        source: {
                            kind: 'plugin',
                            plugin: 'budget-guard',
                            form: 'notice',
                            summary: boundContextSummary('approaching the turn budget'),
                        },
                    })],
            };
        }
        return decision;
    });
}
//# sourceMappingURL=index.js.map