/**
 * test-orchestrator.mjs
 * Dry run of the content-campaign-launch workflow to verify
 * the handshake/checkbook pipeline works end-to-end.
 */

import AgencyOrchestrator from './AgencyOrchestrator.mjs';

const WORKFLOW_ID = `dry-run-${Date.now()}`;
const YAML_FILE = 'content-campaign-launch.yaml';

async function main() {
  console.log(`\n=== AGENCY ORCHESTRATOR DRY RUN ===`);
  console.log(`Workflow ID: ${WORKFLOW_ID}\n`);

  // 1. Initialize orchestrator
  const orch = new AgencyOrchestrator(WORKFLOW_ID, {
    budgetUsd: 5.00,
    upstash: {
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN
    }
  });

  // 2. Load workflow
  console.log('📂 Loading workflow...');
  await orch.loadWorkflowFromFile(YAML_FILE);
  const state = await orch.getWorkflowState();
  console.log(`   Status: ${state.status}`);
  console.log(`   Steps defined: ${orch.workflowDef?.steps?.length || 0}\n`);

  // 3. Get next ready steps
  let readySteps = await orch.getNextReadySteps();
  console.log(`🎯 Next ready steps: ${readySteps.map(s => s.id).join(', ') || '(none)'}\n`);

  // 4. Simulate all ready steps
  for (const step of readySteps) {
    console.log(`▶️  Executing: ${step.id} (${step.role})`);

    // Check handshake
    if (step.handshake?.required) {
      const approval = await orch.waitForApproval(step, null);
      console.log(`   🤝 ${approval.type} — auto-approved (dry run)`);
      console.log(`   Action: /approve_workflow ${this?.workflowId || WORKFLOW_ID} ${step.id}\n`);
    }

    await orch.beginStep(step.id);
    console.log(`   Status -> running`);

    // Simulate work
    await new Promise(r => setTimeout(r, 30));

    // Generate sample output based on step
    const outputs = {
      content_strategy: {
        content_strategy_doc: '# Content Strategy\nOutline of Q3 campaign...',
        content_pillars: ['pillar1: AI Automation', 'pillar2: Creator Economy']
      },
      social_media_strategy: {
        social_media_calendar: { posts: 12, platforms: ['linkedin', 'twitter'] },
        platform_adaptations: '# Adapt each pillar per platform'
      },
      analytics_setup: {
        analytics_dashboard: { tools: ['ga4', 'data_studio'], kpis: ['impressions', 'clicks'] },
        kpi_report_template: '# Weekly KPI Report\n## Metrics'
      },
      brand_review: {
        brand_compliance_report: '# Compliance Review\nAll assets approved.',
        final_approval: { status: 'approved', notes: 'Minor tweaks to tone' }
      }
    };

    const output = outputs[step.id] || { result: `${step.id} completed` };
    const tokenCount = 1500 + Math.floor(Math.random() * 3000);
    const cost = tokenCount * 0.00002;
    const costData = { tokens: tokenCount, costUsd: cost, model: 'glm-4.6' };

    await orch.completeStep(step.id, output, costData);
    await orch.logAssessment(step.id, 7 + Math.floor(Math.random() * 3),
      `${step.id} completed with expected quality`);

    const lessonStr = `Use ${step.id} role directly for ${step.role} tasks — faster than manual prompting`;
    await orch.logImprovement(step.id, lessonStr);

    console.log(`   ✅ Complete — $${cost.toFixed(4)}, ${tokenCount} tokens`);
    console.log(`   📊 Assessment logged`);
    console.log(`   📝 Lesson: "${lessonStr.slice(0, 60)}..."\n`);
  }

  // 5. Check completion
  const complete = await orch.isWorkflowComplete();
  console.log(`🏁 Workflow complete: ${complete}\n`);

  // 6. Cost summary
  const totalCost = await orch.getTotalCost();
  const costRatio = await orch.getCostRatio();
  console.log(`💰 Cost Summary:`);
  console.log(`   Total: $${totalCost.toFixed(4)}`);
  console.log(`   Budget: $${orch.budgetUsd.toFixed(2)}`);
  console.log(`   Usage: ${(costRatio * 100).toFixed(1)}%`);
  console.log(`   Over budget? ${await orch.isOverBudget()}`);
  console.log(`   Near threshold? ${await orch.isNearBudgetThreshold()}\n`);

  // 7. Assessment summary
  const avgScore = orch.getAverageAssessmentScore();
  console.log(`📊 Avg assessment score: ${avgScore.toFixed(1)}/10\n`);

  // 8. Improvements summary
  const allImprovements = orch.getAllImprovements();
  console.log(`📝 Lessons Learned (${allImprovements.size} steps):`);
  for (const [stepId, lessons] of allImprovements) {
    console.log(`   [${stepId}]: ${lessons[0]?.slice(0, 80)}...`);
  }
  console.log();

  // 9. Full status report
  console.log(`📋 Full Workflow Report:`);
  const report = await orch.serializeWorkflow();
  console.log(report);

  console.log(`\n=== ✅ DRY RUN COMPLETE ===`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
