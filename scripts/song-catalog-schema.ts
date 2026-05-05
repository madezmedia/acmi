import { z } from 'zod';

/**
 * ACMI Song Catalog Schema (v1.0.0)
 * 
 * Formalizes the structure for Folana's persistent music memory.
 * Stored at: acmi:registry:song-catalog:song:<slug>:profile
 */

export const SongBlueprintSchema = z.object({
  id: z.string().describe("Canonical ID: song:<slug>"),
  slug: z.string(),
  title: z.string(),
  artist: z.string().default("Folana Lanez"),
  version: z.string().default("1.0.0"),
  
  // The core output from music-prompt-agent.ts
  prompt: z.string().describe("Minimax-ready technical prompt"),
  lyrics: z.string().describe("Full lyrics with [bracketed] sections"),
  
  // Metadata for trending/creative context
  metadata: z.object({
    genre: z.string().optional(),
    mood: z.string().optional(),
    tags: z.array(z.string()).default([]),
    trend_context: z.string().optional().describe("Link to the trend/opinion that triggered this song"),
    generated_at_ms: z.number(),
    model_id: z.string().default("openai/musical-maniac-v1"),
  }),

  // Link to the raw LLM turn
  raw_output_ref: z.string().optional().describe("CorrelationId of the brainstorm event"),
  
  // Tenant isolation (v1.3)
  tenant_id: z.string().default("madez"),
  actor_type: z.literal("system").default("system")
});

export type SongBlueprint = z.infer<typeof SongBlueprintSchema>;
