/**
 * AgencyOrchestrator.mjs
 * High-level orchestration engine for Bentley to manage multi-step workflows
 * across 150+ agency agent roles. Wraps AcmiWorkflowManager with workflow loading,
 * checkpoint recovery, cost tracking, and lifecycle management.
 *
 * @example
 * const orchestrator = new AgencyOrchestrator('content-campaign-001', { budgetUsd: 5.00 });
 * await orchestrator.loadWorkflowFromFile('workflows/content-agency.yml');
 * for (const step of await orchestrator.getNextReadySteps()) {
 *   await orchestrator.beginStep(step.id);
 *   // ... spawn sub-agent ...
 *   await orchestrator.completeStep(step.id, result, { tokens: 1500, cost: 0.05 });
 * }
 */

import { AcmiWorkflowManager } from './AcmiWorkflowManager.mjs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AgencyOrchestrator {
  /**
   * @param {string} workflowId - Unique ID for this workflow instance
   * @param {object} config - Configuration options
   * @param {number} config.budgetUsd - Maximum budget in USD (default: 10.00)
   * @param {number} config.costWarningThreshold - Warning threshold % of budget (default: 0.8)
   * @param {string} config.workflowsDir - Path to workflows directory (default: ~/.openclaw/workflows/)
   * @param {object} config.upstash - Upstash Redis credentials (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)
   */
  constructor(workflowId, config = {}) {
    this.workflowId = workflowId;
    this.budgetUsd = config.budgetUsd || 10.00;
    this.costWarningThreshold = config.costWarningThreshold || 0.8;
    this.workflowsDir = config.workflowsDir || join(process.env.HOME, '.openclaw', 'workflows');

    // Initialize the ACMI workflow manager
    this.acmi = new AcmiWorkflowManager(workflowId, config.upstash || {});

    // Cache for workflow definition
    this.workflowDef = null;

    // Assessment and improvement logs (in-memory, can be persisted)
    this.assessments = new Map(); // stepId -> { score, notes, timestamp }
    this.improvements = new Map(); // stepId -> Array of lesson strings
  }

  // ==========================================
  // WORKFLOW LOADING
  // ==========================================

  /**
   * Load a workflow from a YAML or JSON file in the workflows directory.
   * @param {string} filename - The workflow file name (e.g., 'content-agency.yml')
   * @throws {Error} If file not found or parsing fails
   */
  async loadWorkflowFromFile(filename) {
    const filepath = join(this.workflowsDir, filename);
    const ext = filename.split('.').pop().toLowerCase();

    if (!existsSync(filepath)) {
      throw new Error(`Workflow file not found: ${filepath}`);
    }

    const content = readFileSync(filepath, 'utf-8');
    let definition;

    try {
      if (ext === 'yml' || ext === 'yaml') {
        definition = parseYaml(content);
      } else if (ext === 'json') {
        definition = JSON.parse(content);
      } else {
        throw new Error(`Unsupported workflow file format: ${ext}`);
      }
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        // YAML package not installed, fall back to JSON
        console.warn('[AgencyOrchestrator] YAML package not installed, falling back to JSON only');
        if (ext !== 'json') {
          throw new Error(`Cannot parse ${ext} without yaml package installed`);
        }
        definition = JSON.parse(content);
      } else {
        throw error;
      }
    }

    await this.acmi.loadWorkflow(definition);
    this.workflowDef = definition;
    console.log(`[AgencyOrchestrator] Loaded workflow from ${filename}`);
  }

  /**
   * List all available workflow files in the workflows directory.
   * @returns {Array<{name: string, type: string}>} List of workflow files
   */
  listAvailableWorkflows() {
    if (!existsSync(this.workflowsDir)) {
      return [];
    }

    const files = readdirSync(this.workflowsDir);
    return files
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json'))
      .map(f => ({
        name: f,
        type: f.endsWith('.json') ? 'json' : 'yaml'
      }));
  }

  // ==========================================
  // HANDSHAKE LIFECYCLE METHODS
  // ==========================================

  /**
   * Begin executing a workflow step. Marks step as running and logs to timeline.
   * @param {string} stepId - The step identifier
   * @returns {Promise<object>} The step configuration
   */
  async beginStep(stepId) {
    console.log(`[AgencyOrchestrator] Beginning step: ${stepId}`);
    return await this.acmi.startStep(stepId);
  }

  /**
   * Generate a user approval notification for a step requiring approval.
   * @param {object} stepConfig - The step configuration from the workflow definition
   * @param {string} userChannel - Target channel/user ID for the approval (e.g., 'telegram:user123')
   * @returns {Promise<object>} Notification payload ready for messaging
   */
  async waitForApproval(stepConfig, userChannel) {
    const notification = {
      type: 'approval_request',
      workflowId: this.workflowId,
      stepId: stepConfig.id,
      stepName: stepConfig.name || stepConfig.id,
      description: stepConfig.description || '',
      agentTier: stepConfig.agent_tier || 'unknown',
      channel: userChannel,
      timestamp: Date.now(),
      actions: {
        approve: `/approve_workflow ${this.workflowId} ${stepConfig.id}`,
        reject: `/reject_workflow ${this.workflowId} ${stepConfig.id}`,
        skip: `/skip_workflow ${this.workflowId} ${stepConfig.id}`
      },
      message: `⏸️ Workflow ${this.workflowId} awaiting approval for step "${stepConfig.name || stepConfig.id}"\n\n` +
               `Agent Tier: ${stepConfig.agent_tier || 'unknown'}\n` +
               `Description: ${stepConfig.description || 'No description'}\n\n` +
               `Approve to continue, reject to cancel, or skip to proceed.`
    };

    // Log to ACMI timeline
    await this.acmi._redis(['RPUSH', this.acmi.keys.timeline, JSON.stringify({
      type: 'approval_requested',
      timestamp: Date.now(),
      stepId: stepConfig.id,
      channel: userChannel
    })]);

    console.log(`[AgencyOrchestrator] Approval requested for ${stepConfig.id}`);
    return notification;
  }

  /**
   * Complete a workflow step with output and cost data. Logs cost to checkbook,
   * marks step complete, and saves checkpoint if configured.
   * @param {string} stepId - The step identifier
   * @param {object} output - The step output/result
   * @param {object} costData - Token and cost information
   * @param {number} costData.tokens - Tokens consumed
   * @param {number} costData.costUsd - Cost in USD
   * @param {string} costData.model - Model used
   * @returns {Promise<void>}
   */
  async completeStep(stepId, output, costData = {}) {
    // Log cost to checkbook
    if (costData.tokens || costData.costUsd) {
      await this.acmi.logCost(stepId, {
        tokens: costData.tokens || 0,
        cost: costData.costUsd || 0,
        model: costData.model || 'unknown'
      });

      // Check if over budget
      if (await this.isOverBudget()) {
        console.warn(`[AgencyOrchestrator] ⚠️ Workflow ${this.workflowId} over budget!`);
      } else if ((await this.getCostRatio()) >= this.costWarningThreshold) {
        console.warn(`[AgencyOrchestrator] ⚠️ Workflow ${this.workflowId} at ${(this.getCostRatio() * 100).toFixed(1)}% of budget`);
      }
    }

    // Complete the step
    await this.acmi.completeStep(stepId, output);

    // Save checkpoint if step is marked as checkpoint
    const stepConfig = this.workflowDef?.steps?.find(s => s.id === stepId);
    if (stepConfig?.checkpoint) {
      await this.saveCheckpoint(stepId);
    }

    console.log(`[AgencyOrchestrator] Completed step: ${stepId}`);
  }

  /**
   * Get the next steps that are ready to run (wraps AcmiWorkflowManager).
   * @returns {Promise<Array<object>>} Array of ready step configurations
   */
  async getNextReadySteps() {
    return await this.acmi.getNextReadySteps();
  }

  /**
   * Serialize the full workflow state into a human-readable report string.
   * @returns {Promise<string>} Multi-line report of workflow status
   */
  async serializeWorkflow() {
    const state = await this.acmi.getWorkflowState();
    const costEntries = await this.acmi._redis(['LRANGE', this.acmi.keys.costLedger, '0', '-1']);
    const timelineEntries = await this.acmi._redis(['LRANGE', this.acmi.keys.timeline, '-20', '-1']);

    const report = [
      `═══════════════════════════════════════════════════════════════`,
      `  WORKFLOW REPORT: ${this.workflowId}`,
      `═══════════════════════════════════════════════════════════════`,
      ``,
      `STATUS: ${state?.status || 'unknown'}`,
      ``,
      `─────────────────────────────────────────────────────────────────`,
      `  STEPS`,
      `─────────────────────────────────────────────────────────────────`,
    ];

    if (this.workflowDef?.steps) {
      for (const step of this.workflowDef.steps) {
        const stepState = state?.steps?.[step.id] || {};
        const status = stepState.status || 'pending';
        const statusIcon = status === 'completed' ? '✅' : status === 'running' ? '🔄' : '⏳';

        report.push(`${statusIcon} ${step.id.padEnd(30)} ${status}`);

        if (step.dependsOn?.length > 0) {
          report.push(`    Depends on: ${step.dependsOn.join(', ')}`);
        }

        if (stepState.output) {
          const preview = JSON.stringify(stepState.output).slice(0, 100);
          report.push(`    Output: ${preview}${preview.length >= 100 ? '...' : ''}`);
        }

        report.push('');
      }
    }

    report.push(
      `─────────────────────────────────────────────────────────────────`,
      `  COST LEDGER`,
      `─────────────────────────────────────────────────────────────────`,
      ''
    );

    if (costEntries?.length > 0) {
      const costs = costEntries.map(e => JSON.parse(e));
      let totalTokens = 0;
      let totalCost = 0;

      for (const cost of costs) {
        totalTokens += cost.tokens;
        totalCost += cost.costUsd;
      }

      const costRatio = this.budgetUsd > 0 ? (totalCost / this.budgetUsd) : 0;
      const budgetStatus = costRatio >= 1 ? '❌ OVER BUDGET' : costRatio >= this.costWarningThreshold ? '⚠️  WARNING' : '✅ OK';

      report.push(`Total Tokens: ${totalTokens.toLocaleString()}`);
      report.push(`Total Cost:   $${totalCost.toFixed(4)}`);
      report.push(`Budget:       $${this.budgetUsd.toFixed(2)}`);
      report.push(`Used:         ${(costRatio * 100).toFixed(1)}% ${budgetStatus}`);
    } else {
      report.push('No cost entries recorded.');
    }

    report.push('');
    report.push(
      `─────────────────────────────────────────────────────────────────`,
      `  RECENT TIMELINE (last 20 events)`,
      `─────────────────────────────────────────────────────────────────`,
      ''
    );

    if (timelineEntries?.length > 0) {
      const events = timelineEntries.map(e => JSON.parse(e));
      for (const event of events) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const summary = this._summarizeTimelineEvent(event);
        report.push(`[${time}] ${summary}`);
      }
    } else {
      report.push('No timeline events.');
    }

    report.push('');
    report.push(
      `─────────────────────────────────────────────────────────────────`,
      `  ASSESSMENTS`,
      `─────────────────────────────────────────────────────────────────`,
      ''
    );

    if (this.assessments.size > 0) {
      for (const [stepId, data] of this.assessments) {
        report.push(`📊 ${stepId}: Score ${data.score}/10 - ${data.notes}`);
      }
    } else {
      report.push('No assessments recorded.');
    }

    report.push('');
    report.push(
      `─────────────────────────────────────────────────────────────────`,
      `  IMPROVEMENTS`,
      `─────────────────────────────────────────────────────────────────`,
      ''
    );

    if (this.improvements.size > 0) {
      for (const [stepId, lessons] of this.improvements) {
        report.push(`💡 ${stepId}:`);
        for (const lesson of lessons) {
          report.push(`    • ${lesson}`);
        }
      }
    } else {
      report.push('No improvements logged.');
    }

    report.push('');
    report.push(`═══════════════════════════════════════════════════════════════`);

    return report.join('\n');
  }

  // ==========================================
  // CHECKPOINT RECOVERY
  // ==========================================

  /**
   * Save a checkpoint marker in the timeline for recovery.
   * @param {string} stepId - The step to checkpoint
   * @returns {Promise<void>}
   */
  async saveCheckpoint(stepId) {
    await this.acmi._redis(['RPUSH', this.acmi.keys.timeline, JSON.stringify({
      type: 'checkpoint',
      timestamp: Date.now(),
      stepId,
      workflowId: this.workflowId
    })]);
    console.log(`[AgencyOrchestrator] Checkpoint saved: ${stepId}`);
  }

  /**
   * Resume from the last checkpoint and return steps that still need execution.
   * @returns {Promise<Array<object>>} Array of pending step configurations
   */
  async resumeFromLastCheckpoint() {
    // Find the last checkpoint in the timeline
    const timelineEntries = await this.acmi._redis(['LRANGE', this.acmi.keys.timeline, '0', '-1']);
    let lastCheckpointStepId = null;

    if (timelineEntries?.length > 0) {
      const events = timelineEntries.map(e => JSON.parse(e));
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'checkpoint') {
          lastCheckpointStepId = events[i].stepId;
          break;
        }
      }
    }

    if (!lastCheckpointStepId) {
      console.log('[AgencyOrchestrator] No checkpoint found, starting fresh');
      return await this.getNextReadySteps();
    }

    console.log(`[AgencyOrchestrator] Resuming from checkpoint: ${lastCheckpointStepId}`);

    // Return steps that are after the checkpoint and ready
    const readySteps = await this.getNextReadySteps();
    const completedSteps = await this._getCompletedSteps();

    return readySteps.filter(step => !completedSteps.has(step.id) && step.id !== lastCheckpointStepId);
  }

  /**
   * Get all completed step IDs from the workflow state.
   * @returns {Promise<Set<string>>} Set of completed step IDs
   */
  async _getCompletedSteps() {
    const state = await this.acmi.getWorkflowState();
    const completed = new Set();

    if (state?.steps) {
      for (const [stepId, stepState] of Object.entries(state.steps)) {
        if (stepState.status === 'completed') {
          completed.add(stepId);
        }
      }
    }

    return completed;
  }

  // ==========================================
  // COST TRACKING
  // ==========================================

  /**
   * Calculate total cost from the cost ledger.
   * @returns {Promise<number>} Total cost in USD
   */
  async getTotalCost() {
    const entries = await this.acmi._redis(['LRANGE', this.acmi.keys.costLedger, '0', '-1']);
    if (!entries?.length) return 0;

    return entries.reduce((total, entry) => {
      const cost = JSON.parse(entry);
      return total + (cost.costUsd || 0);
    }, 0);
  }

  /**
   * Get the ratio of used budget to total budget.
   * @returns {Promise<number>} Ratio between 0 and 1
   */
  async getCostRatio() {
    const total = await this.getTotalCost();
    return this.budgetUsd > 0 ? total / this.budgetUsd : 0;
  }

  /**
   * Check if the workflow is over budget.
   * @returns {Promise<boolean>} True if over budget
   */
  async isOverBudget() {
    return (await this.getCostRatio()) >= 1.0;
  }

  /**
   * Check if the workflow is near budget threshold.
   * @returns {Promise<boolean>} True if at or above warning threshold
   */
  async isNearBudgetThreshold() {
    return (await this.getCostRatio()) >= this.costWarningThreshold;
  }

  // ==========================================
  // ASSESSMENT LOGGING
  // ==========================================

  /**
   * Log a quality assessment for a completed step.
   * @param {string} stepId - The step identifier
   * @param {number} score - Quality score (0-10)
   * @param {string} notes - Assessment notes
   * @returns {void}
   */
  logAssessment(stepId, score, notes) {
    if (score < 0 || score > 10) {
      throw new Error('Assessment score must be between 0 and 10');
    }

    this.assessments.set(stepId, {
      score,
      notes,
      timestamp: Date.now()
    });

    console.log(`[AgencyOrchestrator] Assessment logged for ${stepId}: ${score}/10`);
  }

  /**
   * Get the assessment for a step.
   * @param {string} stepId - The step identifier
   * @returns {object|null} Assessment data or null
   */
  getAssessment(stepId) {
    return this.assessments.get(stepId) || null;
  }

  /**
   * Get the average assessment score across all assessed steps.
   * @returns {number} Average score (0-10)
   */
  getAverageAssessmentScore() {
    if (this.assessments.size === 0) return 0;

    let total = 0;
    for (const assessment of this.assessments.values()) {
      total += assessment.score;
    }

    return total / this.assessments.size;
  }

  // ==========================================
  // LEARNING LOGS
  // ==========================================

  /**
   * Log a lesson learned for future workflow runs.
   * @param {string} stepId - The step identifier
   * @param {string} lesson - The lesson learned
   * @returns {void}
   */
  logImprovement(stepId, lesson) {
    if (!this.improvements.has(stepId)) {
      this.improvements.set(stepId, []);
    }

    this.improvements.get(stepId).push(lesson);
    console.log(`[AgencyOrchestrator] Improvement logged for ${stepId}: ${lesson}`);
  }

  /**
   * Get all improvements logged for a step.
   * @param {string} stepId - The step identifier
   * @returns {Array<string>} Array of improvement lessons
   */
  getImprovements(stepId) {
    return this.improvements.get(stepId) || [];
  }

  /**
   * Get all improvements across all steps.
   * @returns {Map<string, Array<string>>} Map of stepId -> improvements array
   */
  getAllImprovements() {
    return this.improvements;
  }

  // ==========================================
  // WORKFLOW STATUS
  // ==========================================

  /**
   * Check if the workflow is complete.
   * @returns {Promise<boolean>} True if all steps are completed
   */
  async isWorkflowComplete() {
    return await this.acmi.isWorkflowComplete();
  }

  /**
   * Get the current workflow state.
   * @returns {Promise<object>} Workflow state object
   */
  async getWorkflowState() {
    return await this.acmi.getWorkflowState();
  }

  // ==========================================
  // PERFORMANCE-BASED ROUTING [Phase 4]
  // ==========================================

  /**
   * Route a task to the best agent lane based on agent performance history.
   * Reads acmi:feedback:aggregate:<agentId> for quality metrics.
   * If avg_quality < 0.6 for all eligible agents, force-route to High-Quality Lane (T2/T3).
   * Logs all routing decisions to acmi:thread:agent-coordination:timeline.
   *
   * @param {object} task - Task description { title, skills, tier, priority }
   * @param {Array<string>} eligibleAgents - Agent IDs to consider
   * @param {number} [threshold=0.6] - Quality threshold for HQ lane routing
   * @returns {Promise<object>} Routing decision { lane, agent, tier, model, score, reason }
   */
  async routeTaskWithPerformance(task, eligibleAgents = [], threshold = 0.6) {
    const now = Date.now();
    const decisions = [];

    for (const agentId of eligibleAgents) {
      const perfMetrics = await this._fetchAgentPerformance(agentId);
      const score = perfMetrics?.avg_quality ?? null;

      decisions.push({
        agentId,
        tier: this._getAgentTier(agentId),
        score,
        meetsThreshold: score !== null && score >= threshold,
      });
    }

    // Sort by score descending (null scores last)
    decisions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    // Best eligible agent that meets threshold
    const bestAgent = decisions.find(d => d.meetsThreshold);

    let decision;
    if (bestAgent) {
      decision = {
        lane: 'standard',
        agent: bestAgent.agentId,
        tier: bestAgent.tier,
        score: bestAgent.score,
        reason: 'Best performing agent meets quality threshold',
        allScores: decisions.map(d => ({ agentId: d.agentId, score: d.score, meetsThreshold: d.meetsThreshold })),
      };
    } else {
      // Route to High-Quality Lane
      let hqAgentId = 'director';
      let hqTier = 'T2';
      // Pick the agent with the closest score to threshold
      const scored = decisions.filter(d => d.score !== null);
      if (scored.length > 0 && scored[0].score > 0) {
        // Use the best available but route through HQ
        decision = {
          lane: 'high-quality',
          agent: hqAgentId,
          tier: hqTier,
          score: scored[0].score,
          reason: `No eligible agent meets quality threshold (${threshold}). Best available: ${scored[0].agentId} (${scored[0].score?.toFixed(3)}). Routing through HQ lane.`,
          allScores: decisions.map(d => ({ agentId: d.agentId, score: d.score, meetsThreshold: d.meetsThreshold })),
        };
      } else {
        // No performance data at all -- route to HQ lane
        decision = {
          lane: 'high-quality',
          agent: hqAgentId,
          tier: hqTier,
          score: null,
          reason: 'No performance data available for any agent. Routing through HQ lane as default.',
          allScores: decisions.map(d => ({ agentId: d.agentId, score: d.score, meetsThreshold: d.meetsThreshold })),
        };
      }
    }

    // Log routing decision to coordination thread
    await this._logRoutingDecision(task, decision, now);

    return decision;
  }

  /**
   * Fetch aggregate performance metrics for an agent from ACMI.
   * @private
   * @param {string} agentId
   * @returns {Promise<object|null>}
   */
  async _fetchAgentPerformance(agentId) {
    try {
      const raw = await this.acmi._redis(['HGETALL', `acmi:feedback:aggregate:${agentId}`]);
      if (!raw || raw.length === 0) return null;

      const metrics = {};
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const key = raw[i];
        const value = raw[i + 1];
        if (['total_tasks', 'completed_tasks', 'failed_tasks'].includes(key)) {
          metrics[key] = parseInt(value, 10);
        } else if (key.startsWith('avg_')) {
          metrics[key] = parseFloat(value);
        } else {
          metrics[key] = value;
        }
      }
      return metrics;
    } catch {
      return null;
    }
  }

  /**
   * Get the model tier string for a known agent ID.
   * @private
   * @param {string} agentId
   * @returns {string}
   */
  _getAgentTier(agentId) {
    const knownTiers = {
      bentley: 'T4',
      'claude-engineer': 'T4',
      'gemini-cli': 'T0b',
      director: 'T2',
      researcher: 'T3',
      batch: 'T0',
      cron: 'T0b',
    };
    return knownTiers[agentId] || 'T1';
  }

  /**
   * Log routing decision to the coordination thread timeline.
   * @private
   * @param {object} task
   * @param {object} decision
   * @param {number} timestamp
   */
  async _logRoutingDecision(task, decision, timestamp) {
    const summary = decision.lane === 'high-quality'
      ? `Routing: HQ lane for "${task.title || 'untitled'}" — ${decision.reason}`
      : `Routing: ${decision.agent} for "${task.title || 'untitled'}" — score ${decision.score?.toFixed(3)}`;

    const event = {
      ts: timestamp,
      source: 'agency-orchestrator',
      kind: 'routing_decision',
      summary,
      lane: decision.lane,
      agent: decision.agent,
      score: decision.score,
      tier: decision.tier,
      task_title: task.title || '',
      eligible_agents: decision.allScores?.length || 0,
    };

    try {
      await this.acmi._redis(['ZADD', 'acmi:thread:agent-coordination:timeline', timestamp, JSON.stringify(event)]);
    } catch (e) {
      console.warn(`[AgencyOrchestrator] Could not log routing decision: ${e.message}`);
    }
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  /**
   * Generate a one-line summary of a timeline event.
   * @private
   * @param {object} event - Timeline event object
   * @returns {string} One-line summary
   */
  _summarizeTimelineEvent(event) {
    switch (event.type) {
      case 'handoff_request':
        return `🔄 Handoff: ${event.from} -> ${event.to} (${event.taskId})`;
      case 'handoff_ack':
        const status = event.status === 'accepted' ? '✅' : '❌';
        return `${status} ACK: ${event.from} -> ${event.to}`;
      case 'step_status_change':
        const icon = event.status === 'completed' ? '✅' : event.status === 'running' ? '🔄' : '⏳';
        return `${icon} Step: ${event.stepId} -> ${event.status}`;
      case 'checkpoint':
        return `📍 Checkpoint: ${event.stepId}`;
      case 'approval_requested':
        return `⏸️  Approval: ${event.stepId}`;
      default:
        return `❓ ${event.type}`;
    }
  }
}

export default AgencyOrchestrator;
