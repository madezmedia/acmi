#!/usr/bin/env node

// Temporary ACMI mock for lead generator
// This provides basic ACMI functionality without requiring the full ACMI system

const args = process.argv.slice(2);

console.log("ACMI Debug:", JSON.stringify(args));

// Mock ACMI functionality
function mockAcmiLog(event) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ACMI LOG: ${event}`);
}

function mockAcmiEnqueue(task) {
  console.log(`[${new Date().toISOString()}] ACMI ENQUEUE:`, JSON.stringify(task, null, 2));
  return { success: true, taskId: `mock-${Date.now()}` };
}

// Handle different ACMI commands
if (args.length >= 4 && args[0] === 'task' && args[1] === 'enqueue') {
  const queue = args[2];
  const taskJson = args.slice(3).join(' ');
  console.log("Task JSON:", taskJson);
  try {
    const task = JSON.parse(taskJson);
    const result = mockAcmiEnqueue(task);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }));
  }
} else if (args.length >= 3 && args[0] === 'event') {
  const thread = args[1];
  const event = args.slice(2).join(' ');
  mockAcmiLog(`thread:${thread} ${event}`);
} else {
  // Default log anything
  mockAcmiLog(args.join(' '));
}

process.exit(0);