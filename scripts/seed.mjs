#!/usr/bin/env node
// Idempotent seed: creates the platform admin and a demo organization with a
// couple of reusable prompts. Projects, knowledge, and deliverables are created
// by the user — there are no persistent AI employees. Plain JS (no build step)
// so it runs both in development (npm run db:seed) and inside the Docker image.
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
    VALUES (${org.id}, ${admin.id}, 'org_admin', 'Owner')`;

  await sql`
    INSERT INTO prompts (organization_id, name, category, description, content, variables, created_by_user_id)
    VALUES (
      ${org.id}, 'Research Assistant', 'General',
      'Thorough research assistant prompt',
      'You are a meticulous research assistant. Summarize sources faithfully, cite where claims come from, and clearly separate facts from interpretation.',
      ${sql.json([])}, ${admin.id}
    )`;

  console.log("Seeded:");
  console.log(`  platform admin: admin@loomai.local / ${adminPassword}`);
  console.log("  organization:   Acme Corp (/acme)");
} finally {
  await sql.end();
}
