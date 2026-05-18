import { createAcmi } from "../client.js";
import { SongBlueprint, SongBlueprintSchema } from "../../scripts/song-catalog-schema.js";

/**
 * ACMI Song Catalog Library
 * 
 * High-level interface for archiving and retrieving Folana's song blueprints.
 */

export function createSongCatalog(acmi: ReturnType<typeof createAcmi>) {
  return {
    /**
     * Persist a song blueprint to ACMI.
     */
    async archive(slug: string, blueprint: Partial<SongBlueprint>) {
      const entityId = `registry:song-catalog:song:${slug}`;
      
      // Merge defaults
      const fullBlueprint = SongBlueprintSchema.parse({
        id: `song:${slug}`,
        slug,
        title: blueprint.title || "Untitled",
        prompt: blueprint.prompt,
        lyrics: blueprint.lyrics,
        metadata: {
          generated_at_ms: Date.now(),
          ...blueprint.metadata
        },
        ...blueprint
      });

      await acmi.profile.set(entityId, fullBlueprint);
      
      // Track in the catalog list
      const adapter = (acmi as any).adapter;
      if (adapter && typeof (adapter as any).cmd === 'function') {
        await (adapter as any).cmd("SADD", "acmi:registry:song-catalog:list", slug);
      }

      await acmi.timeline.append(entityId, {
        source: "agent:folana",
        kind: "song-archived",
        correlationId: `song-archive-${slug}-${Date.now()}`,
        summary: `Song archived: ${fullBlueprint.title}`
      });

      return fullBlueprint;
    },

    /**
     * Retrieve a song by slug.
     */
    async get(slug: string): Promise<SongBlueprint | null> {
      const entityId = `registry:song-catalog:song:${slug}`;
      const profile = await acmi.profile.get(entityId);
      return profile as SongBlueprint | null;
    },

    /**
     * List all archived songs.
     */
    async list(): Promise<string[]> {
      const adapter = (acmi as any).adapter;
      if (adapter && typeof (adapter as any).cmd === 'function') {
        return await (adapter as any).cmd("SMEMBERS", "acmi:registry:song-catalog:list");
      }
      return [];
    }
  };
}
