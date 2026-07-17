import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const providerType = pgEnum("provider_type", [
  "lmstudio",
  "openai_compatible",
  "ollama",
  "anthropic",
]);

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: providerType("type").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  // AES-256-GCM encrypted with LOOMAI_SECRET; null for keyless local servers
  apiKeyEncrypted: text("api_key_encrypted"),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface ModelCapabilities {
  vision?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  embeddings?: boolean;
  contextWindow?: number;
  [key: string]: unknown;
}

export const aiModels = pgTable(
  "ai_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name"),
    kind: text("kind").notNull().default("chat"), // chat | embedding
    capabilities: jsonb("capabilities").$type<ModelCapabilities>().notNull().default({}),
    contextWindow: integer("context_window"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_models_provider_model_idx").on(t.providerId, t.modelId)]
);

export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
export type ProviderType = (typeof providerType.enumValues)[number];
