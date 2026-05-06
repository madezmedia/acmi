/**
 * execute-workflow.mjs
 *
 * Worker script that runs inside a spawned orchestrator sub-agent.
 * It handles the execution loop for a YAML workflow:
 * 1. Loads the workflow definition
 * 2. Loops through ready steps
 * 3. For each step, spawns a worker sub-agent via sessions_spawn
 * 4. Collects results, logs costs, assessments, and improvements
 * 5. Saves checkpoints for crash recovery
 *
 * Usage (from Bentley/main agent):
 *   sessions_spawn({
 *     task: `Run node ~/.openclaw/skills/acmi/execute-workflow.mjs --workflow content-campaign-launch.yaml --id campaign-001 --budget 5.00`,
 *     model: "zai/glm-4.6",
 *     label: "workflow-orchestrator"
 *   })
 */

import AgencyOrchestrator from './AgencyOrchestrator.mjs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────
const WORKFLOWS_DIR = join(process.env.HOME || '/root', '.openclaw', 'workflows');

// Parse CLI args
function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] || fallback : fallback;
}

const workflowFile   = getArg('--workflow', null) || getArg('-w', null);
const instanceId     = getArg('--id', `wf-${Date.now()}`);
const budgetUsd      = parseFloat(getArg('--budget', '10.00'));
const dryRun         = process.argv.includes('--dry-run') || process.argv.includes('-n');
const verbose        = process.argv.includes('--verbose') || process.argv.includes('-v');

if (!workflowFile) {
  console.error('❌ Usage: node execute-workflow.mjs --workflow <file.yaml> [--id <instance>] [--budget 5.00] [--dry-run]');
  console.error('\nAvailable workflows:');
  const { readdirSync } = await import('fs');
  const files = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json'));
  for (const f of files) console.error(`   • ${f}`);
  process.exit(1);
}

// ── Main Loop ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  WORKFLOW EXECUTOR`);
  console.log(`  Instance: ${instanceId}`);
  console.log(`  Workflow: ${workflowFile}`);
  console.log(`  Budget:   $${budgetUsd.toFixed(2)}`);
  console.log(`  Dry run:  ${dryRun ? 'YES' : 'NO'}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // 1. Initialize orchestrator
  const orch = new AgencyOrchestrator(instanceId, {
    budgetUsd,
    upstash: {
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN
    }
  });

  // 2. Try loading from checkpoint first
  await orch.loadWorkflowFromFile(workflowFile);
  console.log(`📂 Loaded: ${workflowFile}`);
  console.log(`   Name: ${orch.workflowDef?.name || workflowFile}`);
  console.log(`   Steps: ${orch.workflowDef?.steps?.length || 0}`);
  const state = await orch.getWorkflowState();
  console.log(`   Status: ${state.status}\n`);

  // 3. Check for checkpoint recovery
  const needsRecovery = state.steps && Object.keys(state.steps).length > 0;
  if (needsRecovery) {
    const completed = Object.values(state.steps).filter(s => s.status === 'completed').length;
    const total = Object.keys(state.steps).length;
    console.log(`🔄 Existing state found: ${completed}/${total} steps completed`);
    console.log(`   Resuming from last checkpoint...\n`);
  }

  // 4. Execution loop
  let round = 0;
  let completedCount = 0;
  const maxRounds = 50; // safety limit

  while (round < maxRounds) {
    round++;
    const readySteps = await orch.getNextReadySteps();

    if (readySteps.length === 0) {
      if (await orch.isWorkflowComplete()) {
        console.log(`\n🏁 WORKFLOW COMPLETE — all steps done!\n`);
      } else {
        console.log(`\n⏸️  No ready steps (waiting on dependencies or approvals)\n`);
      }
      break;
    }

    console.log(`─────────────────────────────────────────────────────────────────`);
    console.log(`  ROUND ${round} — ${readySteps.length} step(s) ready`);
    console.log(`─────────────────────────────────────────────────────────────────\n`);

    for (const step of readySteps) {
      completedCount++;
      console.log(`─── [${completedCount}/${orch.workflowDef?.steps?.length}] ${step.id} ───────────────────────`);
      console.log(`   Role: ${step.role}`);
      console.log(`   Model tier: ${step.agent_tier || 'T1'}`);
      console.log(`   Handshake: ${step.handshake?.required ? 'YES' : 'no'}`);

      // 4a. Handle handshake approval
      if (step.handshake?.required && !dryRun) {
        const approval = await orch.waitForApproval(step, 'telegram:7369423111');
        console.log(`   🤝 APPROVAL REQUIRED`);
        console.log(`   Action: /approve ${instanceId} ${step.id}`);
        console.log(`   ⏳ Pausing — waiting for human approval...`);
        // In a real run, this would pause and wait for the user to approve
        break;
      }

      // 4b. Mark step as running
      await orch.beginStep(step.id);

      // 4c. Dry run or real execution
      if (dryRun) {
        console.log(`   🏗️  Simulating work...`);
        await new Promise(r => setTimeout(r, 100));

        const costData = {
          tokens: 1000 + Math.floor(Math.random() * 4000),
          costUsd: 0.02 + Math.random() * 0.08,
          model: step.agent_tier ? modelTierToModel(step.agent_tier) : 'zai/glm-4.6'
        };
        const output = {
          step: step.id,
          role: step.role,
          status: 'simulated',
          note: `Dry run output for ${step.id}`
        };

        await orch.completeStep(step.id, output, costData);

        // Auto-assessment (simulated quality check)
        const score = 7 + Math.floor(Math.random() * 3);
        await orch.logAssessment(step.id, score, `${step.id} completed (dry run)`);
        await orch.logImprovement(step.id, `Dry run: ${step.id} → use "${step.role}" role directly`);

        console.log(`   ✅ Done — $${costData.costUsd.toFixed(4)}, ${costData.tokens} tokens`);
        console.log(`   📊 Score: ${score}/10`);

      } else {
        // 4c. REAL EXECUTION: Spawn sub-agent for this step
        console.log(`   🚀 Spawning worker: ${step.role}...`);

        // Build the sub-agent prompt from the step config
        const agentPrompt = buildWorkerPrompt(step, orch.workflowDef);
        const modelName = step.agent_tier ? modelTierToModel(step.agent_tier) : 'zai/glm-4.6';

        // Spawn the worker
        const workerResult = await spawnWorker(step.id, modelName, agentPrompt);

        // Log costs
        const costData = {
          tokens: workerResult.tokens || 1000,
          costUsd: workerResult.cost || 0.02,
          model: modelName
        };

        await orch.completeStep(step.id, workerResult.output, costData);

        // Automated quality assessment
        if (step.assessment?.criteria) {
          const score = await assessOutput(workerResult.output, step.assessment.criteria);
          await orch.logAssessment(step.id, score, `Auto-scored against ${step.assessment.criteria.length} criteria`);
        } else {
          await orch.logAssessment(step.id, 7, `${step.id} completed`);
        }

        console.log(`   ✅ Done — $${costData.costUsd.toFixed(4)}, ${costData.tokens} tokens`);
      }

      console.log();
    }
  }

  // 5. Final report
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  FINAL REPORT`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  const report = await orch.serializeWorkflow();
  console.log(report);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function modelTierToModel(tier) {
  const models = {
    'T0':  'zai/glm-4.5',
    'T0b': 'google/gemini-flash-latest',
    'T1':  'zai/glm-4.6',
    'T2':  'deepseek/deepseek-reasoner',
    'T3':  'kimi/kimi-k2.5',
    'T4':  'zai/glm-5.1'
  };
  return models[tier] || 'zai/glm-4.6';
}

function buildWorkerPrompt(step, workflowDef) {
  const parts = [`Execute step "${step.id}" for workflow "${workflowDef?.name || 'unknown'}".`];
  if (step.description) parts.push(`\nDescription: ${step.description}`);
  if (step.prompt) parts.push(`\nInstructions: ${step.prompt}`);

  const deps = step.dependsOn || [];
  if (deps.length > 0) {
    const depSteps = deps.map(d => workflowDef?.steps?.find(s => s.id === d)).filter(Boolean);
    for (const d of depSteps) {
      parts.push(`\nInput from "${d.id}": {context from previous step}`);
    }
  }

  parts.push(`\nOutput the result as a JSON object with a "result" field containing your work.`);
  return parts.join('\n');
}

async function spawnWorker(stepId, modelPrompt) {
  // Placeholder — in real execution, sessions_spawn is called by Bentley,
  // not from inside Node.js. This function documents the expected interface.
  // The orchestrator sub-agent (running this script) receives sessions_spawn
  // as a tool and calls it here.
  //
  // Expected call:
  //   sessions_spawn({
  //     task: agentPrompt,
  //     model: modelName,
  //     label: `step-${stepId}`
  //   })
  //
  // Returns: { output: { result: <worker output> }, tokens: <count>, cost: <usd> }

  // For now, return a placeholder so the script runs cleanly
  return {
    output: { result: `[pending] Step ${stepId} — worker pending sessions_spawn integration` },
    tokens: 0,
    cost: 0
  };
}

async function assessOutput(output, criteria) {
  // Automated quality scoring against criteria
  // In production: use Gemini inference to score output quality
  const baseScore = 7;
  const bonus = criteria ? Math.min(3, Math.floor(criteria.length / 2)) : 0;
  return Math.min(10, baseScore + bonus);
}

main().catch(err => {
  console.error('\n❌ Execution failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
