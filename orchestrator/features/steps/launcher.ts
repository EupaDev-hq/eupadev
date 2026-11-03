// Launcher steps, step 0 (the launcher feature): model, effort, digest of the instructions, branch, tokens, and
// verdict_source and CI result (ci_green) of a task. The refusals are the database's own (trigger replaced by
// migrations/0006, constraint tasks_ci_green_if_ci), under the engine's account.
import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MODELS_BY_ROLE } from '../../src/config.ts';
import type { Role } from '../../src/external/contracts.ts';
import { overlapReport } from '../../src/external/fakes.ts';
import { DEFAULT_THRESHOLDS } from '../../src/machine/states.ts';
import { loadInstructions } from '../../src/agent-engine/instructions.ts';
import { World } from '../support/world.ts';

interface Measure { model: string | null; effort: string | null; instructions_sha256: string | null; branch: string | null; verdict_source: string | null; ci_green: boolean | null; input_tokens: string; output_tokens: string; cost_usd: string }

async function measure(m: World, id: string): Promise<Measure> {
  const r = await m.base.pool.query<Measure>(`SELECT model, effort, instructions_sha256, branch, verdict_source, ci_green, input_tokens, output_tokens, cost_usd FROM tasks WHERE id = $1`, [id]);
  assert.ok(r.rows[0] !== undefined, `task ${id} missing`);
  return r.rows[0];
}
/** First input received by the engine for the task (waited for: the task has started). */
async function input(m: World, id: string) {
  return m.wait(`engine call for ${id}`, async () => m.bench.engine.calls(id)[0]);
}

When('the fake engine returns verdict {string} for {string} with {int} input tokens and {int} output tokens', function (this: World, verdict: string, r: string, input_: number, output: number) {
  this.bench.engine.answer(r as Role, { type: 'report', report: (e: { task_id: string }) => overlapReport(e.task_id, verdict as 'plausible' | 'not_plausible'), tokens: { input: input_, output: output } });
});

Then('task {string} of iteration {int} records its role\'s model and effort and the digest of the instructions the engine received', async function (this: World, r: string, iteration: number) {
  const id = await this.taskId(r, iteration);
  const e = await input(this, id);
  const t = await measure(this, id);
  assert.equal(t.model, MODELS_BY_ROLE[r as Role].model);
  assert.equal(t.effort, MODELS_BY_ROLE[r as Role].effort);
  assert.equal(t.instructions_sha256, createHash('sha256').update(e.instructions, 'utf8').digest('hex'), `instructions received: ${e.instructions}`);
});

/** ADR-018: the instructions come from the template copied into the engine image (charter + role prompt + rules), never from the repository. */
Then('the instructions the engine received for task {string} of iteration {int} are the role\'s instructions in the template', async function (this: World, r: string, iteration: number) {
  const e = await input(this, await this.taskId(r, iteration));
  const expected = loadInstructions(this.bench.orch.config.instructionsPath)[r as Role];
  assert.equal(e.instructions, expected);
  assert.ok(e.instructions.includes('# Agent charter') && e.instructions.includes(`# Role: ${r}`), 'charter, then the role prompt');
});

Then('the engine received for task {string} of iteration {int} this model, this effort and branch {string}', async function (this: World, r: string, iteration: number, branchPattern: string) {
  const id = await this.taskId(r, iteration);
  const e = await input(this, id);
  const c = await this.cycle();
  const t = await measure(this, id);
  const branch = branchPattern.replace('<tool>', c.slug).replace('<cycle>', String(c.id));
  assert.deepEqual({ model: e.model, effort: e.effort, branch: e.branch }, { model: t.model, effort: t.effort, branch: branch });
  assert.equal(t.branch, branch);
});

/** A-R5: caps PER ROLE (states.ts, `DEFAULT_THRESHOLDS.task`), passed as they are to the engine. */
Then('the engine received for task {string} of iteration {int} its role\'s caps \\(duration, turns, budget)', async function (this: World, r: string, iteration: number) {
  const e = await input(this, await this.taskId(r, iteration));
  assert.deepEqual(e.cap, DEFAULT_THRESHOLDS.task[r as Role]);
});

Then('the database refuses to change the model, the effort or the digest of task {string} of iteration {int}', async function (this: World, r: string, iteration: number) {
  const id = await this.taskId(r, iteration);
  await input(this, id); // started: the values are written
  for (const column of ['model', 'effort', 'instructions_sha256']) {
    const value = column === 'effort' ? 'max' : column === 'model' ? 'other-model' : 'f'.repeat(64);
    await assert.rejects(this.base.pool.query(`UPDATE tasks SET ${column} = $2 WHERE id = $1`, [id, value]), /fixed once written/, column);
  }
});

Then('task {string} of iteration {int} records {int} input tokens and {int} output tokens', async function (this: World, r: string, iteration: number, input_: number, output: number) {
  const id = await this.taskId(r, iteration);
  const t = await measure(this, id);
  assert.deepEqual([Number(t.input_tokens), Number(t.output_tokens)], [input_, output]);
});

/** CI result as written in the scenario. */
const CI: Record<string, boolean> = { green: true, red: false };
const ci = (result: string) => {
  assert.ok(result in CI, `CI result "${result}": green or red`);
  return CI[result]!;
};

const verdict = async (m: World, r: string, iteration: number) => measure(m, await m.taskId(r, iteration));
Then('task {string} of iteration {int} has verdict {string}', async function (this: World, r: string, iteration: number, expected: string) {
  const t = await verdict(this, r, iteration);
  assert.deepEqual([t.verdict_source, t.ci_green], [expected, null], 'the agent\'s verdict, CI not answered yet');
});
Then('task {string} of iteration {int} has verdict {string} and a {string} CI', async function (this: World, r: string, iteration: number, expected: string, result: string) {
  const t = await verdict(this, r, iteration);
  assert.deepEqual([t.verdict_source, t.ci_green], [expected, ci(result)]);
});
Then('task {string} of iteration {int} has no verdict', async function (this: World, r: string, iteration: number) {
  const t = await verdict(this, r, iteration);
  assert.deepEqual([t.verdict_source, t.ci_green], [null, null]);
});

Then('the database refuses to set the verdict of task {string} of iteration {int} to {string} while also changing its cost', async function (this: World, r: string, iteration: number, v: string) {
  const id = await this.taskId(r, iteration);
  await assert.rejects(this.base.pool.query(`UPDATE tasks SET verdict_source = $2, ci_green = true, cost_usd = cost_usd + 1 WHERE id = $1`, [id, v]), /close/);
});

Then('the database refuses to set the verdict of task {string} of iteration {int} to {string} without the CI result', async function (this: World, r: string, iteration: number, v: string) {
  const id = await this.taskId(r, iteration);
  await assert.rejects(this.base.pool.query(`UPDATE tasks SET verdict_source = $2 WHERE id = $1`, [id, v]), /tasks_ci_green_if_ci/);
});

When('the CI of the branch of task {string} of iteration {int} answers {string}', async function (this: World, r: string, iteration: number, result: string) {
  await this.base.ciVerdict(await this.taskId(r, iteration), ci(result));
});

Then('a new {string} answer from the CI does not change the verdict of task {string} of iteration {int}', async function (this: World, result: string, r: string, iteration: number) {
  assert.equal(await this.base.ciVerdict(await this.taskId(r, iteration), ci(result)), false);
});

Then('the database refuses any further change to the verdict or CI result of task {string} of iteration {int}', async function (this: World, r: string, iteration: number) {
  const id = await this.taskId(r, iteration);
  for (const v of ['agent', 'ci', null]) {
    for (const green of [true, false, null]) {
      await assert.rejects(this.base.pool.query(`UPDATE tasks SET verdict_source = $2, ci_green = $3 WHERE id = $1`, [id, v, green]), /close/, `${v} ${green}`);
    }
  }
});
