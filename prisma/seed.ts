/**
 * Seed script: realistic development data.
 *
 * WARNING: `npm run db:seed` DELETES ALL DATA in the database and recreates it.
 * Development users all have password "password123" — dev/demo only.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required to seed. Set it to a PostgreSQL connection " +
      'string, e.g. "postgresql://user:password@localhost:5432/crm".',
  );
}
const adapter = new PrismaPg({ connectionString: url });
const db = new PrismaClient({ adapter });

const PASSWORD = "password123";
const AVATAR_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9"];

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function main() {
  console.log("Seeding database (this wipes existing data)...");

  // Wipe in FK-safe order.
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.auditLog.deleteMany();
  await db.customFieldValue.deleteMany();
  await db.customField.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.emailSettings.deleteMany();
  await db.deal.deleteMany();
  await db.lead.deleteMany();
  await db.stage.deleteMany();
  await db.pipeline.deleteMany();
  await db.contact.deleteMany();
  await db.tag.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.organization.deleteMany();

  const org = await db.organization.create({
    data: {
      name: "Acme Corp",
      industry: "B2B SaaS",
      website: "https://acme.example.com",
      phone: "+1 (555) 010-0001",
      address: "100 Market Street, Suite 400",
      currency: "USD",
    },
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const [admin, manager, rep1, rep2, rep3] = await Promise.all(
    [
      { name: "Avery Stone", email: "admin@acme.test", role: "ADMIN", title: "Head of Revenue", color: "#6366f1" },
      { name: "Morgan Reyes", email: "manager@acme.test", role: "MANAGER", title: "Sales Manager", color: "#ec4899" },
      { name: "Jamie Fox", email: "jamie@acme.test", role: "SALES_REP", title: "Account Executive", color: "#14b8a6" },
      { name: "Riley Chen", email: "riley@acme.test", role: "SALES_REP", title: "Account Executive", color: "#f59e0b" },
      { name: "Casey Park", email: "casey@acme.test", role: "SALES_REP", title: "Sales Development Rep", color: "#8b5cf6" },
    ].map((u, i) =>
      db.user.create({
        data: {
          organizationId: org.id,
          name: u.name,
          email: u.email,
          passwordHash,
          role: u.role,
          title: u.title,
          avatarColor: u.color,
          lastLoginAt: daysAgo(i),
        },
      })
    )
  );
  const reps = [rep1, rep2, rep3];
  const allUsers = [admin, manager, ...reps];

  // Lead sources
  const sourceNames = [
    "Website",
    "Referral",
    "Inbound Demo",
    "Trade Show",
    "Cold Call",
    "Partner Network",
  ];
  const sources = await Promise.all(
    sourceNames.map((name, i) =>
      db.leadSource.create({
        data: { organizationId: org.id, name, description: `Leads from ${name.toLowerCase()}`, isSystem: i < 3 },
      })
    )
  );

  // Tags
  const tagNames = ["VIP", "Enterprise", "SMB", "Churn Risk", "Decision Maker", "Technical", "Finance"];
  const tags = await Promise.all(
    tagNames.map((name, i) =>
      db.tag.create({ data: { organizationId: org.id, name, color: AVATAR_COLORS[i % AVATAR_COLORS.length] } })
    )
  );

  // Pipelines
  const defaultPipeline = await db.pipeline.create({
    data: { organizationId: org.id, name: "Default Sales Pipeline", isDefault: true },
  });
  const stageDefs: Array<[string, number, string]> = [
    ["New", 10, "OPEN"],
    ["Qualified", 30, "OPEN"],
    ["Proposal", 55, "OPEN"],
    ["Negotiation", 75, "OPEN"],
    ["Closed Won", 100, "WON"],
    ["Closed Lost", 0, "LOST"],
  ];
  const stages = [];
  for (let i = 0; i < stageDefs.length; i++) {
    const [name, probability, type] = stageDefs[i]!;
    stages.push(
      await db.stage.create({
        data: { pipelineId: defaultPipeline.id, name, position: i, probability, type },
      })
    );
  }

  const enterprisePipeline = await db.pipeline.create({
    data: { organizationId: org.id, name: "Enterprise Pipeline" },
  });
  const entStages = [];
  const entDefs: Array<[string, number, string]> = [
    ["Discovery", 15, "OPEN"],
    ["Security Review", 35, "OPEN"],
    ["Procurement", 60, "OPEN"],
    ["Won", 100, "WON"],
    ["Lost", 0, "LOST"],
  ];
  for (let i = 0; i < entDefs.length; i++) {
    const [name, probability, type] = entDefs[i]!;
    entStages.push(
      await db.stage.create({
        data: { pipelineId: enterprisePipeline.id, name, position: i, probability, type },
      })
    );
  }

  // Companies
  const companySeed = [
    ["Globex Industries", "globex.example", "Manufacturing", "500-1000", "Chicago, IL"],
    ["Initech Software", "initech.example", "Technology", "200-500", "Austin, TX"],
    ["Umbrella Health", "umbrella.example", "Healthcare", "1000+", "Boston, MA"],
    ["Soylent Foods", "soylent.example", "Food & Beverage", "200-500", "Portland, OR"],
    ["Wonka Confections", "wonka.example", "Consumer Goods", "50-200", "Denver, CO"],
    ["Tyrell Robotics", "tyrell.example", "Robotics", "100-250", "San Francisco, CA"],
    ["Cyberdyne Systems", "cyberdyne.example", "Defense", "500-1000", "Sunnyvale, CA"],
    ["Hooli Cloud", "hooli.example", "Technology", "1000+", "Palo Alto, CA"],
  ] as const;
  const companies = [];
  for (let i = 0; i < companySeed.length; i++) {
    const [name, domain, industry, size, city] = companySeed[i]!;
    companies.push(
      await db.company.create({
        data: {
          organizationId: org.id,
          name,
          domain,
          industry,
          size,
          city,
          website: `https://${domain}`,
          ownerId: allUsers[i % allUsers.length]!.id,
          createdAt: daysAgo(200 - i * 8),
        },
      })
    );
  }

  // Contacts
  const firstNames = ["Elena", "Marcus", "Priya", "Tobias", "Sofia", "Nathan", "Amara", "Lucas", "Ingrid", "Diego", "Hana", "Omar", "Freya", "Kenji", "Leila", "Bjorn", "Chidi", "Maya", "Rafael", "Zoe", "Simone", "Andre", "Talia", "Viktor", "Noor", "Felix", "Camila", "Owen", "Yara", "Hugo"];
  const lastNames = ["Vasquez", "Webb", "Nair", "Lindqvist", "Rossi", "Draper", "Okafor", "Meyer", "Bergstrom", "Alvarez", "Sato", "Farouk", "Nilsen", "Watanabe", "Haddad", "Hansen", "Okafor", "Delgado", "Silva", "Kowalski", "Laurent", "Beaumont", "Katz", "Petrov", "Rahman", "Wagner", "Costa", "Reid", "Haddad", "Moreau"];
  const statuses = ["LEAD", "ACTIVE", "CUSTOMER", "CUSTOMER", "CUSTOMER", "INACTIVE", "CHURNED"];
  const contacts = [];
  for (let i = 0; i < 30; i++) {
    const company = companies[i % companies.length]!;
    const owner = allUsers[i % allUsers.length]!;
    contacts.push(
      await db.contact.create({
        data: {
          organizationId: org.id,
          firstName: firstNames[i % firstNames.length]!,
          lastName: lastNames[i % lastNames.length]!,
          email: `${firstNames[i % firstNames.length]!.toLowerCase()}.${lastNames[i % lastNames.length]!.toLowerCase()}${i}@${company.domain}`,
          phone: `+1 (555) 01${String(i).padStart(2, "0")}-${1000 + i}`,
          title: ["CEO", "CTO", "VP Sales", "Procurement Lead", "IT Director", "Marketing Head"][i % 6]!,
          companyId: company.id,
          ownerId: owner.id,
          status: i < 3 ? "LEAD" : statuses[i % statuses.length]!,
          avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
          city: company.city,
          country: "USA",
          lastContactedAt: i % 4 === 0 ? daysAgo(i) : null,
          createdAt: daysAgo(180 - i * 5),
          tags: { connect: i % 3 === 0 ? [{ id: tags[i % tags.length]!.id }] : [] },
        },
      })
    );
  }

  // Leads across statuses
  const leadStatuses = ["NEW", "NEW", "CONTACTED", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "NEW", "QUALIFIED", "CONTACTED"];
  const leads = [];
  for (let i = 0; i < 25; i++) {
    const status = i < 10 ? leadStatuses[i]! : leadStatuses[i % leadStatuses.length]!;
    const source = sources[i % sources.length]!;
    const isConverted = status === "CONVERTED";
    const company = companies[i % companies.length]!;
    const estimatedValue = [0, 1200, 5500, 12000, 30000, 75000, 15000][i % 7]!;
    leads.push(
      await db.lead.create({
        data: {
          organizationId: org.id,
          firstName: firstNames[(i + 7) % firstNames.length]!,
          lastName: lastNames[(i + 9) % lastNames.length]!,
          email: `lead${i}.${lastNames[(i + 9) % lastNames.length]!.toLowerCase()}@${company.domain}`,
          phone: `+1 (555) 02${String(i).padStart(2, "0")}-2000`,
          companyName: company.name,
          companyId: i % 4 !== 0 ? company.id : null,
          sourceId: source.id,
          status,
          score: Math.max(5, Math.min(98, 25 + ((i * 13) % 70))),
          estimatedValue,
          expectedCloseDate: i % 3 === 0 ? daysFromNow(15 + (i % 40)) : null,
          followUpAt: !isConverted && i % 2 === 0 ? daysFromNow(i % 9) : null,
          summary: i % 2 === 0 ? "Interested in enterprise tier, wants security docs." : "",
          assignedUserId: reps[i % reps.length]!.id,
          ownerId: reps[i % reps.length]!.id,
          convertedAt: isConverted ? daysAgo(30 - i) : null,
          createdAt: daysAgo(60 - i * 2),
        },
      })
    );
  }

  // Convert a few leads fully: create contact + link
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    if (lead.status !== "CONVERTED") continue;
    const c = await db.contact.create({
      data: {
        organizationId: org.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        companyId: lead.companyId,
        status: "CUSTOMER",
        ownerId: lead.assignedUserId,
        createdAt: daysAgo(25),
      },
    });
    await db.lead.update({ where: { id: lead.id }, data: { contactId: c.id } });
  }

  // Deals: open across stages + historical won/lost for reports
  const dealNames = ["Platform rollout", "Annual license renewal", "Security add-on", "Team expansion", "Pilot program", "Data migration", "Integration package", "White-glove onboarding", "Multi-year contract", "API usage tier"];
  const deals = [];
  for (let i = 0; i < 16; i++) {
    const stage = stages[i % 4]!; // open stages
    const contact = contacts[i * 2 % contacts.length]!;
    const company = companies[i % companies.length]!;
    deals.push(
      await db.deal.create({
        data: {
          organizationId: org.id,
          name: `${company.name} — ${dealNames[i % dealNames.length]!}`,
          contactId: contact.id,
          companyId: company.id,
          stageId: stage.id,
          pipelineId: defaultPipeline.id,
          ownerId: allUsers[i % allUsers.length]!.id,
          sourceId: sources[i % sources.length]!.id,
          value: [2500, 8000, 15000, 32000, 48000, 65000, 90000, 120000][i % 8]!,
          probability: stage.probability,
          status: "OPEN",
          expectedCloseDate: daysFromNow(10 + (i % 50)),
          nextStep: i % 2 === 0 ? "Send revised proposal" : "Schedule security review",
          createdAt: daysAgo(40 - i * 2),
        },
      })
    );
  }

  // Won deals across the last 6 months for trends
  for (let i = 0; i < 12; i++) {
    const wonAt = new Date();
    wonAt.setMonth(wonAt.getMonth() - (i % 6));
    wonAt.setDate(2 + (i % 26));
    const contact = contacts[(i + 5) % contacts.length]!;
    const value = [18000, 45000, 75000, 120000, 96000, 52000][i % 6]!;
    deals.push(
      await db.deal.create({
        data: {
          organizationId: org.id,
          name: `${companies[(i + 3) % companies.length]!.name} — ${dealNames[(i + 4) % dealNames.length]!}`,
          contactId: contact.id,
          companyId: contact.companyId,
          stageId: stages[4]!.id,
          pipelineId: defaultPipeline.id,
          ownerId: allUsers[i % allUsers.length]!.id,
          sourceId: sources[i % sources.length]!.id,
          value,
          probability: 100,
          status: "WON",
          wonAt,
          actualCloseDate: wonAt,
          createdAt: new Date(wonAt.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      })
    );
  }

  // Lost deals
  const lossReasons = ["Price too high", "Chose competitor", "No budget", "Timing — recheck in Q3"];
  for (let i = 0; i < 6; i++) {
    const contact = contacts[(i + 11) % contacts.length]!;
    deals.push(
      await db.deal.create({
        data: {
          organizationId: org.id,
          name: `${companies[(i + 6) % companies.length]!.name} — ${dealNames[(i + 7) % dealNames.length]!}`,
          contactId: contact.id,
          companyId: contact.companyId,
          stageId: stages[5]!.id,
          pipelineId: defaultPipeline.id,
          ownerId: allUsers[i % allUsers.length]!.id,
          value: [20000, 40000, 60000, 85000][i % 4]!,
          probability: 0,
          status: "LOST",
          lostAt: daysAgo(10 + i * 7),
          actualCloseDate: daysAgo(10 + i * 7),
          lostReason: lossReasons[i % lossReasons.length]!,
          createdAt: daysAgo(50 + i * 7),
        },
      })
    );
  }

  // Enterprise pipeline deals
  for (let i = 0; i < 3; i++) {
    const contact = contacts[(i + 2) % contacts.length]!;
    deals.push(
      await db.deal.create({
        data: {
          organizationId: org.id,
          name: `${companies[(i + 1) % companies.length]!.name} — Enterprise agreement`,
          contactId: contact.id,
          companyId: contact.companyId,
          stageId: entStages[i % 3]!.id,
          pipelineId: enterprisePipeline.id,
          ownerId: [manager, rep1, rep2][i]!.id,
          value: [150000, 220000, 310000][i]!,
          probability: entStages[i % 3]!.probability,
          status: "OPEN",
          expectedCloseDate: daysFromNow(60 + i * 30),
          createdAt: daysAgo(15 + i * 5),
        },
      })
    );
  }

  // Tasks
  const taskTitles = [
    "Follow up on proposal",
    "Schedule product demo",
    "Send onboarding docs",
    "Quarterly check-in call",
    "Prepare renewal quote",
    "Confirm meeting with procurement",
    "Send contract for signature",
    "Call about security questionnaire",
  ];
  const taskTypes = ["FOLLOW_UP", "MEETING", "EMAIL", "CALL", "TODO", "MEETING", "EMAIL", "CALL"];
  const taskPriorities = ["HIGH", "MEDIUM", "URGENT", "LOW", "HIGH", "MEDIUM", "MEDIUM", "HIGH"];
  for (let i = 0; i < 14; i++) {
    const done = i >= 8;
    const overdue = !done && i % 5 === 0;
    await db.task.create({
      data: {
        organizationId: org.id,
        title: taskTitles[i % taskTitles.length]!,
        description: i % 3 === 0 ? "Prepared notes from last call — review before reaching out." : "",
        type: taskTypes[i % taskTypes.length]!,
        priority: taskPriorities[i % taskPriorities.length]!,
        status: done ? "COMPLETED" : i === 9 ? "IN_PROGRESS" : "PENDING",
        dueAt: overdue ? daysAgo(3 + i) : done ? daysAgo(i) : daysFromNow((i % 10) + 1),
        completedAt: done ? daysAgo(i) : null,
        relatedType: i % 2 === 0 ? "contact" : "deal",
        relatedId: i % 2 === 0 ? contacts[i % contacts.length]!.id : deals[i % deals.length]!.id,
        createdById: manager.id,
        assignedUserId: reps[i % reps.length]!.id,
        createdAt: daysAgo(20 - i),
      },
    });
  }

  // Activities timeline
  const activityTypes = ["CALL", "MEETING", "EMAIL", "NOTE", "STAGE_CHANGE", "DEAL_WON", "DEAL_LOST", "CREATED"];
  for (let i = 0; i < 40; i++) {
    const contact = contacts[i % contacts.length]!;
    const user = allUsers[i % allUsers.length]!;
    const type = activityTypes[i % activityTypes.length]!;
    await db.activity.create({
      data: {
        organizationId: org.id,
        type,
        title: {
          CALL: "Discovery call completed",
          MEETING: "Product demo delivered",
          EMAIL: "Pricing email sent",
          NOTE: "Added onboarding notes",
          STAGE_CHANGE: "Deal moved to Negotiation",
          DEAL_WON: "Deal won — annual contract",
          DEAL_LOST: "Deal lost to competitor",
          CREATED: "Contact created",
        }[type]!,
        description: i % 3 === 0 ? "Went well; stakeholder asked for security documentation." : "",
        contactId: i % 3 !== 2 ? contact.id : null,
        companyId: i % 3 === 2 ? contact.companyId : null,
        dealId: i % 4 === 0 ? deals[i % deals.length]!.id : null,
        userId: user.id,
        durationMinutes: type === "CALL" ? 30 + (i % 6) * 10 : type === "MEETING" ? 60 : null,
        occurredAt: daysAgo(i),
      },
    });
  }

  // Notes
  for (let i = 0; i < 8; i++) {
    await db.note.create({
      data: {
        organizationId: org.id,
        body: [
          "Prefers email communication. Available Tuesdays for calls.",
          "Budget cycle starts in May — engage procurement early.",
          "Technical evaluation led by their platform team; send them the architecture doc.",
          "Champion changed roles internally; new contact is the VP of Ops.",
          "Asked about SSO and audit logs for compliance.",
          "Interested in the enterprise tier but needs board approval for the total contract value.",
          "Renewal is due in 90 days; start the conversation now.",
          "Requested a custom integration scope; loop in solutions engineering.",
        ][i]!,
        contactId: contacts[i * 3 % contacts.length]!.id,
        userId: allUsers[i % allUsers.length]!.id,
        createdAt: daysAgo(i * 3),
      },
    });
  }

  // Notifications
  await db.notification.createMany({
    data: [
      { organizationId: org.id, userId: rep1.id, title: "New lead assigned: check priority", body: "A high-scoring lead from Referral was assigned to you.", type: "INFO", isRead: false },
      { organizationId: org.id, userId: rep1.id, title: "Task due today: Follow up on proposal", body: "", type: "TASK", isRead: false, link: "/tasks" },
      { organizationId: org.id, userId: manager.id, title: "Deal won: Hooli Cloud — Annual license renewal", body: "$120,000 closed by Jamie Fox.", type: "DEAL", isRead: true, link: "/pipeline" },
    ],
  });

  // Email templates
  await db.emailTemplate.createMany({
    data: [
      {
        organizationId: org.id,
        name: "Intro follow-up",
        subject: "Following up on our conversation",
        body: "Hi {{first_name}},\n\nThank you for your time today. As discussed, I've attached the overview of how we help teams like {{company}} grow revenue.\n\nWould you be open to a short demo next week?\n\nBest,\n{{sender_name}}",
        category: "FOLLOW_UP",
      },
      {
        organizationId: org.id,
        name: "Proposal sent",
        subject: "Your proposal from Acme Corp",
        body: "Hi {{first_name}},\n\nPlease find the proposal we discussed. It covers scope, pricing, and the onboarding timeline.\n\nHappy to walk through any questions.\n\nBest,\n{{sender_name}}",
        category: "PROPOSAL",
      },
      {
        organizationId: org.id,
        name: "Renewal reminder",
        subject: "Time to plan your renewal",
        body: "Hi {{first_name}},\n\nYour subscription renews in 60 days. I'd love to review your usage and make sure the plan still fits.\n\nBest,\n{{sender_name}}",
        category: "RENEWAL",
      },
    ],
  });

  // Custom fields
  const customFieldsSeed = [
    { entityType: "contact", name: "LinkedIn Profile", dataType: "TEXT", options: [] },
    { entityType: "contact", name: "Preferred Contact Method", dataType: "SELECT", options: ["Email", "Phone", "SMS"] },
    { entityType: "deal", name: "Competitor Mentioned", dataType: "TEXT", options: [] },
    { entityType: "company", name: "Annual Revenue Band", dataType: "SELECT", options: ["<1M", "1M-10M", "10M-100M", ">100M"] },
  ];
  for (let i = 0; i < customFieldsSeed.length; i++) {
    const f = customFieldsSeed[i]!;
    await db.customField.create({
      data: {
        organizationId: org.id,
        entityType: f.entityType,
        name: f.name,
        dataType: f.dataType,
        options: JSON.stringify(f.options),
        position: i,
      },
    });
  }

  // Email settings (architecture-level integration point; delivery stubbed)
  await db.emailSettings.create({
    data: { organizationId: org.id, notificationsEnabled: true, fromAddress: "notifications@acme.test" },
  });

  // Sample audit entries
  await db.auditLog.createMany({
    data: [
      { organizationId: org.id, userId: admin.id, action: "ORGANIZATION_CREATED", entityType: "organization", entityId: org.id, metadata: "{}" },
      { organizationId: org.id, userId: admin.id, action: "SEED_COMPLETED", entityType: "system", metadata: JSON.stringify({ at: new Date().toISOString() }) },
    ],
  });

  const counts = {
    users: await db.user.count(),
    companies: await db.company.count(),
    contacts: await db.contact.count(),
    leads: await db.lead.count(),
    pipelines: await db.pipeline.count(),
    deals: await db.deal.count(),
    tasks: await db.task.count(),
    activities: await db.activity.count(),
  };
  console.log("Seed complete:", counts);
  console.log("Dev accounts (password: password123):");
  console.log("  admin@acme.test    (ADMIN)");
  console.log("  manager@acme.test  (MANAGER)");
  console.log("  jamie@acme.test    (SALES_REP)");
  console.log("  riley@acme.test    (SALES_REP)");
  console.log("  casey@acme.test     (SALES_REP)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
