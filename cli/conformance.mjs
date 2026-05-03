#!/usr/bin/env node

import path from 'path';
import { runConformanceTests } from '../dist/testing/conformance.js';

/**
 * ACMI Conformance CLI
 * Run the ACMI conformance suite against any adapter.
 * 
 * Usage:
 *   node cli/conformance.mjs <factory-file.mjs>
 * 
 * The factory file must export a default function that returns an AcmiAdapter:
 *   export default function() { return new MyAdapter(); }
 */

async function main() {
  const factoryPath = process.argv[2];
  if (!factoryPath) {
    console.log("Usage: node cli/conformance.mjs <factory-file.mjs>");
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), factoryPath);
  
  try {
    const { default: factory } = await import(absolutePath);
    if (typeof factory !== 'function') {
      throw new Error("Default export must be a factory function");
    }

    console.log(`🚀 Running ACMI conformance suite against adapter from ${factoryPath}...`);
    
    const result = await runConformanceTests(factory);
    
    console.log("\nResults:");
    for (const r of result.results) {
      const icon = r.pass ? "✅" : "❌";
      console.log(`${icon} ${r.name}`);
      if (!r.pass) {
        console.log(`   Error: ${r.error}`);
      }
    }

    console.log(`\nSummary: ${result.passed}/${result.total} passed`);
    
    if (result.failed > 0) {
      console.log(`❌ ${result.failed} failures found.`);
      process.exit(1);
    } else {
      console.log("✨ All tests passed! Adapter is ACMI compliant.");
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
