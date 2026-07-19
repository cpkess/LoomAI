#!/usr/bin/env node
// Idempotent seed: creates the platform admin and a demo organization with
// departments, prompts, and two AI employees. Plain JS (no build step) so it
// runs both in development (npm run db:seed) and inside the Docker image.
import bcrypt from "bcryptjs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM users`;
  if (count > 0) {
    console.log("Database already seeded, skipping.");
    process.exit(0);
  }

  const adminPassword = process.env.LOOMAI_ADMIN_PASSWORD || "loomai-admin";
  const passwordHash = bcrypt.hashSync(adminPassword, 10);

  const [admin] = await sql`
    INSERT INTO users (name, email, password_hash, is_platform_admin)
    VALUES ('Platform Admin', 'admin@loomai.local', ${passwordHash}, true)
    RETURNING id`;

  const [org] = await sql`
    INSERT INTO organizations (slug, name) VALUES ('acme', 'Acme Corp') RETURNING id`;

  await sql`
    INSERT INTO organization_members (organization_id, user_id, role, title)
    VALUES (${org.id}, ${admin.id}, 'org_admin', 'CEO')`;

  const [engineering] = await sql`
    INSERT INTO workspaces (organization_id, slug, name, description)
    VALUES (${org.id}, 'engineering', 'Engineering', 'Product engineering department')
    RETURNING id`;
  const [marketing] = await sql`
    INSERT INTO workspaces (organization_id, slug, name, description)
    VALUES (${org.id}, 'marketing', 'Marketing', 'Marketing and communications department')
    RETURNING id`;

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, is_manager)
    VALUES (${engineering.id}, ${admin.id}, true), (${marketing.id}, ${admin.id}, true)`;

  const [architectPersona] = await sql`
    INSERT INTO prompts (organization_id, name, category, description, content, variables, created_by_user_id)
    VALUES (
      ${org.id}, 'Software Architect', 'Personas',
      'Senior software architect persona for engineering work',
      'You are {{name}}, a senior software architect at {{company}}. You give precise, pragmatic technical guidance, favor simple designs, and always call out trade-offs and risks explicitly.',
      ${sql.json(["name", "company"])}, ${admin.id}
    ) RETURNING id`;
  const [copywriterPersona] = await sql`
    INSERT INTO prompts (organization_id, name, category, description, content, variables, created_by_user_id)
    VALUES (
      ${org.id}, 'Marketing Copywriter', 'Personas',
      'Conversion-focused copywriter persona',
      'You are {{name}}, a senior copywriter at {{company}}. You write clear, punchy, benefit-led copy and adapt tone to the requested audience. Offer two alternatives when asked for copy.',
      ${sql.json(["name", "company"])}, ${admin.id}
    ) RETURNING id`;
  await sql`
    INSERT INTO prompts (organization_id, name, category, description, content, variables, created_by_user_id)
    VALUES (
      ${org.id}, 'Research Assistant', 'General',
      'Thorough research assistant prompt',
      'You are a meticulous research assistant. Summarize sources faithfully, cite where claims come from, and clearly separate facts from interpretation.',
      ${sql.json([])}, ${admin.id}
    )`;

  const [atlas] = await sql`
    INSERT INTO agents (organization_id, name, title, status, persona_prompt_id, persona_text, reports_to_user_id, avatar_color, permissions)
    VALUES (
      ${org.id}, 'Atlas', 'Principal Engineer (AI)', 'active', ${architectPersona.id},
      ${"You are Atlas, Acme Corp's AI principal engineer. You give precise, pragmatic technical guidance, favor simple designs, and always call out trade-offs and risks explicitly."},
      ${admin.id}, '#6366f1',
      ${sql.json(["web_research", "hire_employee", "update_employee", "create_department", "assign_to_department"])}
    ) RETURNING id`;
  const [nova] = await sql`
    INSERT INTO agents (organization_id, name, title, status, persona_prompt_id, persona_text, reports_to_agent_id, avatar_color, permissions)
    VALUES (
      ${org.id}, 'Nova', 'Content Strategist (AI)', 'active', ${copywriterPersona.id},
      ${"You are Nova, Acme Corp's AI content strategist. You write clear, punchy, benefit-led copy and adapt tone to the requested audience."},
      ${atlas.id}, '#ec4899', ${sql.json(["web_research"])}
    ) RETURNING id`;

  await sql`
    INSERT INTO agent_workspaces (agent_id, workspace_id)
    VALUES (${atlas.id}, ${engineering.id}), (${nova.id}, ${marketing.id})`;

  console.log("Seeded:");
  console.log(`  platform admin: admin@loomai.local / ${adminPassword}`);
  console.log("  organization:   Acme Corp (/acme)");
  console.log("  departments:    Engineering, Marketing");
  console.log("  AI employees:   Atlas (Principal Engineer), Nova (Content Strategist)");
} finally {
  await sql.end();
}
