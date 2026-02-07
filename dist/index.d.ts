export { expect } from 'vitest';

/**
 * bdd-vitest — Enforced Given/When/Then for Vitest
 *
 * Usage:
 *   import { feature, scenario } from "bdd-vitest";
 *
 *   feature("Queue", () => {
 *     scenario("rejects when full", {
 *       given: () => createQueue({ maxSize: 50, filled: 50 }),
 *       when:  (queue) => queue.enqueue(mockRequest()).catch(e => e),
 *       then:  (error) => expect(error.message).toContain("Queue full"),
 *     });
 *   });
 */

/** Phase: [description, function] tuple — description is enforced */
type Phase<TFn> = [desc: string, fn: TFn];
interface Scenario<TContext, TResult> {
    /** Setup — tuple, description-only string, or omitted */
    given?: Phase<() => TContext | Promise<TContext>> | string;
    /** Action — tuple or omitted */
    when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
    /** Assertion — required */
    then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
}
declare function scenario<TContext, TResult>(name: string, phases: Scenario<TContext, TResult>): void;
declare namespace scenario {
    var only: <TContext, TResult>(name: string, phases: Scenario<TContext, TResult>) => void;
    var skip: <TContext, TResult>(name: string, phases: Scenario<TContext, TResult>) => void;
}
/**
 * Groups related scenarios. Alias for describe with intent.
 */
declare function feature(name: string, fn: () => void): void;
/**
 * Sub-groups within a feature for related business rules.
 */
declare function rule(name: string, fn: () => void): void;
interface ScenarioWithLifecycle<TContext, TResult> {
    given?: Phase<() => TContext | Promise<TContext>> | string;
    when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
    then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
    cleanup?: (context: TContext) => void | Promise<void>;
}
/**
 * Scenario with automatic cleanup after assertion.
 */
declare function scenarioWithCleanup<TContext, TResult>(name: string, phases: ScenarioWithLifecycle<TContext, TResult>): void;
interface TableRow {
    name: string;
    [key: string]: unknown;
}
/**
 * Run the same scenario with multiple data rows.
 *
 * Usage:
 *   scenarioOutline("adds numbers", [
 *     { name: "positive", a: 2, b: 3, expected: 5 },
 *     { name: "negative", a: -1, b: 1, expected: 0 },
 *   ], {
 *     given: (row) => ({ a: row.a as number, b: row.b as number }),
 *     when:  (ctx) => ctx.a + ctx.b,
 *     then:  (result, _ctx, row) => expect(result).toBe(row.expected),
 *   });
 */
declare function scenarioOutline<TRow extends TableRow, TContext, TResult>(name: string, table: TRow[], phases: {
    given: (row: TRow) => TContext | Promise<TContext>;
    when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
    then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
}): void;

export { type Phase, type Scenario, type ScenarioWithLifecycle, type TableRow, feature, rule, scenario, scenarioOutline, scenarioWithCleanup };
