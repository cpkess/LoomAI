import bcrypt from "bcryptjs";

import { db } from "./index";
import {
  agents,
  agentWorkspaces,
  organizationMembers,
  organizations,
  prompts,
  users,
  workspaceMembers,
  workspaces,
} from "./schema";

async function seed() {
  const existing = await db.query.users.findFirst();
  if (existing) {
    console.log("Database already seeded, skipping.");
    return;
  }

  const adminPassword = process.env.LOOMAI_ADMIN_PASSWORD ?? "loomai-admin";
  const [admin] = await db
    .insert(users)
    .values({
      name: "Platform Admin",
      email: "admin@loomai.local",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      isPlatformAdmin: true,
    })
    .returning();

  const [org] = await db
    .insert(organizations)
    .values({ slug: "acme", name: "Acme Corp" })
    .returning();

  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: admin.id,
    role: "org_admin",
    title: "CEO",
  });

  const [engineering, marketing] = await db
    .insert(workspaces)
    .values([
      {
        organizationId: org.id,
        slug: "engineering",
        name: "Engineering",
        description: "Product engineering department",
      },
      {
        organizationId: org.id,
        slug: "marketing",
        name: "Marketing",
        description: "Marketing and communications department",
      },
    ])
    .returning();

  await db.insert(workspaceMembers).values([
    { workspaceId: engineering.id, userId: admin.id, isManager: true },
    { workspaceId: marketing.id, userId: admin.id, isManager: true },
  ]);

  const [architectPersona, copywriterPersona] = await db
    .insert(prompts)
    .values([
      {
        organizationId: org.id,
        name: "Software Architect",
        category: "Personas",
        description: "Senior software architect persona for engineering work",
        content:
          "You are {{name}}, a senior software architect at {{company}}. You give precise, pragmatic technical guidance, favor simple designs, and always call out trade-offs and risks explicitly.",
        variables: ["name", "company"],
        createdByUserId: admin.id,
      },
      {
        organizationId: org.id,
        name: "Marketing Copywriter",
        category: "Personas",
        description: "Conversion-focused copywriter persona",
        content:
          "You are {{name}}, a senior copywriter at {{company}}. You write clear, punchy, benefit-led copy and adapt tone to the requested audience. Offer two alternatives when asked for copy.",
        variables: ["name", "company"],
        createdByUserId: admin.id,
      },
      {
        organizationId: org.id,
        name: "Research Assistant",
        category: "General",
        description: "Thorough research assistant prompt",
        content:
          "You are a meticulous research assistant. Summarize sources faithfully, cite where claims come from, and clearly separate facts from interpretation.",
        variables: [],
        createdByUserId: admin.id,
      },
    ])
    .returning();

  const [atlas] = await db
    .insert(agents)
    .values({
      organizationId: org.id,
      name: "Atlas",
      title: "Principal Engineer (AI)",
      status: "active",
      personaPromptId: architectPersona.id,
      personaText:
        "You are Atlas, Acme Corp's AI principal engineer. You give precise, pragmatic technical guidance, favor simple designs, and always call out trade-offs and risks explicitly.",
      reportsToUserId: admin.id,
      avatarColor: "#6366f1",
    })
    .returning();

  const [nova] = await db
    .insert(agents)
    .values({
      organizationId: org.id,
      name: "Nova",
      title: "Content Strategist (AI)",
      status: "active",
      personaPromptId: copywriterPersona.id,
      personaText:
        "You are Nova, Acme Corp's AI content strategist. You write clear, punchy, benefit-led copy and adapt tone to the requested audience.",
      reportsToAgentId: atlas.id,
      avatarColor: "#ec4899",
    })
    .returning();

  await db.insert(agentWorkspaces).values([
    { agentId: atlas.id, workspaceId: engineering.id },
    { agentId: nova.id, workspaceId: marketing.id },
  ]);

  console.log("Seeded:");
  console.log(`  platform admin: admin@loomai.local / ${adminPassword}`);
  console.log(`  organization:   ${org.name} (/${org.slug})`);
  console.log(`  departments:    Engineering, Marketing`);
  console.log(`  AI employees:   Atlas (Principal Engineer), Nova (Content Strategist)`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
