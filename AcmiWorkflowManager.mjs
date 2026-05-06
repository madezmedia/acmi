/**
 * AcmiWorkflowManager.mjs
 * Prototype for managing Agency Agent OS workflows via Upstash Redis.
 * Handles DAG progression, token checking, and agent handshakes.
 */

export class AcmiWorkflowManager {
  /**
   * @param {string} workflowId - Unique ID for the workflow instance
   * @param {object} config - Upstash credentials (URL and REST token)
   */
  constructor(workflowId, config = {}) {
    this.workflowId = workflowId;
    this.upstashUrl = config.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL;
    this.upstashToken = config.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!this.upstashUrl || !this.upstashToken) {
      throw new Error('Missing Upstash Redis credentials');
    }

    // ACMI Namespace definitions
    this.namespace = `acmi:workflow:${this.workflowId}`;
    this.keys = {
      definition: `${this.namespace}:definition`,
      state: `${this.namespace}:state`,
      costLedger: `${this.namespace}:profile.cost_ledger`,
      timeline: `${this.namespace}:timeline`
    };

    this.workflowDef = null;
  }

  /**
   * Internal helper to execute Upstash Redis REST commands.
   * @param {Array} command - e.g., ['SET', 'key', 'value']
   */
  async _redis(command) {
    const response = await fetch(this.upstashUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.upstashToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });

    if (!response.ok) {
      throw new Error(`Upstash request failed: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(`Redis error: ${data.error}`);
    return data.result;
  }

  // ==========================================
  // 1. WORKFLOW DEFINITION & STATE
  // ==========================================

  /**
   * Load the workflow definition (DAG) and initialize Redis state.
   * @param {string|object} definition - The YAML/JSON workflow map
   */
  async loadWorkflow(definition) {
    this.workflowDef = typeof definition === 'string' ? JSON.parse(definition) : definition;

    // Initialize state if it doesn't exist
    const existingState = await this._redis(['GET', this.keys.state]);
    if (!existingState) {
      const initialState = { status: 'running', steps: {} };
      await this._redis(['SET', this.keys.state, JSON.stringify(initialState)]);
    }

    await this._redis(['SET', this.keys.definition, JSON.stringify(this.workflowDef)]);
    console.log(`[ACMI] Workflow ${this.workflowId} loaded.`);
  }

  async getWorkflowState() {
    const raw = await this._redis(['GET', this.keys.state]);
    return raw ? JSON.parse(raw) : null;
  }

  // ==========================================
  // 2. CHECKBOOK (COST LEDGER)
  // ==========================================

  /**
   * Append token/cost logs to the checkbook profile.
   */
  async logCost(agentId, usage) {
    const entry = {
      timestamp: Date.now(),
      agentId,
      tokens: usage.tokens || 0,
      costUsd: usage.cost || 0,
      model: usage.model || 'unknown'
    };

    await this._redis(['RPUSH', this.keys.costLedger, JSON.stringify(entry)]);
    console.log(`[ACMI Checkbook] Logged $${entry.costUsd} for ${agentId}`);
  }

  // ==========================================
  // 3. HANDSHAKES (TIMELINE PILLAR)
  // ==========================================

  /**
   * Emit a handoff request to another agent.
   */
  async requestHandoff(fromAgent, toAgent, taskId, payload) {
    const event = {
      type: 'handoff_request',
      id: `req_${Date.now()}`,
      timestamp: Date.now(),
      taskId,
      from: fromAgent,
      to: toAgent,
      payload
    };

    await this._redis(['RPUSH', this.keys.timeline, JSON.stringify(event)]);
    console.log(`[ACMI Handshake] Request: ${fromAgent} -> ${toAgent} (Task: ${taskId})`);
    return event.id;
  }

  /**
   * Receiver acknowledges the handoff request.
   */
  async acknowledgeHandoff(fromAgent, toAgent, taskId, status = 'accepted') {
    const event = {
      type: 'handoff_ack',
      timestamp: Date.now(),
      taskId,
      from: toAgent, // Reversing direction for ACK
      to: fromAgent,
      status
    };

    await this._redis(['RPUSH', this.keys.timeline, JSON.stringify(event)]);
    console.log(`[ACMI Handshake] ACK: ${toAgent} accepted task ${taskId} from ${fromAgent}`);
  }

  /**
   * Poll/verify if the target agent has acknowledged the handoff.
   */
  async verifyHandoffAck(fromAgent, toAgent, taskId) {
    // Grab the last 50 events from the timeline to check for the ACK
    const eventsRaw = await this._redis(['LRANGE', this.keys.timeline, '-50', '-1']);
    if (!eventsRaw) return false;

    const events = eventsRaw.map(e => JSON.parse(e));
    return events.some(e => 
      e.type === 'handoff_ack' && 
      e.taskId === taskId && 
      e.from === toAgent && 
      e.to === fromAgent
    );
  }

  // ==========================================
  // 4. EXECUTE STEPS (DAG PROGRESSION)
  // ==========================================

  /**
   * Update the status of a specific workflow node/step.
   */
  async updateStepStatus(stepId, status, output = null) {
    // Note: A production implementation should use Redis Lua scripts to prevent race conditions.
    const state = await this.getWorkflowState();
    if (!state) throw new Error('Workflow state not initialized');

    state.steps[stepId] = { status, output, updatedAt: Date.now() };
    await this._redis(['SET', this.keys.state, JSON.stringify(state)]);
    
    // Log progression to timeline
    await this._redis(['RPUSH', this.keys.timeline, JSON.stringify({
      type: 'step_status_change',
      timestamp: Date.now(),
      stepId,
      status,
      output
    })]);

    console.log(`[ACMI Workflow] Step ${stepId} -> ${status}`);
  }

  /**
   * Determine which steps are ready to run based on dependencies.
   * Assumes workflowDef.steps is an array with `id` and `dependsOn` fields.
   */
  async getNextReadySteps() {
    const state = await this.getWorkflowState();
    if (!state || !this.workflowDef?.steps) return [];

    const ready = [];
    for (const step of this.workflowDef.steps) {
      if (state.steps[step.id]?.status === 'completed') continue;
      
      const deps = step.dependsOn || [];
      const allDepsCompleted = deps.every(depId => state.steps[depId]?.status === 'completed');
      if (allDepsCompleted) ready.push(step);
    }
    return ready;
  }

  /**
   * Start a step (mark as running) and return its configuration.
   */
  async startStep(stepId) {
    await this.updateStepStatus(stepId, 'running');
    return this.workflowDef?.steps?.find(s => s.id === stepId);
  }

  /**
   * Complete a step (mark as completed) and store output.
   */
  async completeStep(stepId, output) {
    await this.updateStepStatus(stepId, 'completed', output);
  }

  /**
   * Check if the entire workflow is finished.
   */
  async isWorkflowComplete() {
    const state = await this.getWorkflowState();
    if (!state || !this.workflowDef?.steps) return false;

    return this.workflowDef.steps.every(step => state.steps[step.id]?.status === 'completed');
  }
}

// Example usage (commented out)
/*
const manager = new AcmiWorkflowManager('campaign_001');
await manager.loadWorkflow({
  steps: [
    { id: 'research', dependsOn: [] },
    { id: 'write', dependsOn: ['research'] },
    { id: 'publish', dependsOn: ['write'] }
  ]
});

const ready = await manager.getNextReadySteps();
for (const step of ready) {
  await manager.startStep(step.id);
  // ... execute skill ...
  await manager.completeStep(step.id, { result: 'done' });
}
*/