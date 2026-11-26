import { z } from "zod";

export const ROLES = ["ADMIN", "MANAGER", "SALES_REP"] as const;
export const CONTACT_STATUSES = ["LEAD", "ACTIVE", "CUSTOMER", "INACTIVE", "CHURNED"] as const;
export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const;
export const TASK_TYPES = ["CALL", "MEETING", "FOLLOW_UP", "EMAIL", "TODO"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"] as const;
export const ACTIVITY_TYPES = [
  "CALL",
  "EMAIL",
  "MEETING",
  "NOTE",
  "CREATED",
  "UPDATED",
  "STAGE_CHANGE",
  "DEAL_WON",
  "DEAL_LOST",
  "CONVERTED",
  "TASK_COMPLETED",
] as const;
export const STAGE_TYPES = ["OPEN", "WON", "LOST"] as const;
export const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;
export const CUSTOM_FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"] as const;

const emptyToUndefined = (v: string | undefined) =>
  (v === "" || v === undefined ? undefined : v);

const trimToDefault = (v: string | undefined) => (v === undefined ? "" : v.trim());
const optionalTrimmed = z
  .string()
  .optional()
  .transform(trimToDefault);

const email = z.string().trim().toLowerCase().email("Invalid email address");
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+()\-.\s\d]*$/, "Invalid phone number")
  .optional()
  .transform(emptyToUndefined)
  .transform((v) => v ?? "");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200),
  role: z.enum(ROLES),
  title: optionalTrimmed,
  phone,
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  title: optionalTrimmed,
  phone,
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

export const contactCreateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: email.optional(),
  phone,
  mobile: phone,
  title: optionalTrimmed,
  companyId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  ownerId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  status: z.enum(CONTACT_STATUSES).default("ACTIVE"),
  address: optionalTrimmed,
  city: optionalTrimmed,
  state: optionalTrimmed,
  country: optionalTrimmed,
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

export const contactUpdateSchema = contactCreateSchema.partial();

export const companyCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  domain: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((v) => (v ?? "").trim()),
  industry: optionalTrimmed,
  size: optionalTrimmed,
  phone,
  website: optionalTrimmed,
  address: optionalTrimmed,
  city: optionalTrimmed,
  state: optionalTrimmed,
  country: optionalTrimmed,
  ownerId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  summary: z.string().max(5000).optional(),
});

export const companyUpdateSchema = companyCreateSchema.partial();

export const leadCreateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: email,
  phone,
  companyName: optionalTrimmed,
  sourceId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  status: z.enum(LEAD_STATUSES).default("NEW"),
  estimatedValue: z.coerce.number().min(0).max(100_000_000).default(0),
  expectedCloseDate: z.string().trim().optional().transform(emptyToUndefined),
  followUpAt: z.string().trim().optional().transform(emptyToUndefined),
  notes: z.string().max(5000).optional().default(""),
  assignedUserId: z.string().trim().max(64).optional().transform(emptyToUndefined),
});

export const leadUpdateSchema = leadCreateSchema.partial();

// Public lead-capture payload for API-key callers. Strictly flat and
// allow-listed: no owner, assignment, status, or other internal fields are
// accepted (mass-assignment guard).
export const leadCaptureSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email,
  phone,
  companyName: optionalTrimmed,
  source: z.string().trim().min(1).max(60).optional(),
});

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

// Sequence steps: a single omitted position defaults to its array index at
// insert time, but the route's unique-position guard maps every omitted
// position to a shared sentinel — so a payload with two or more omitted
// positions is 400-rejected. Send explicit positions (the UI always does).
export const sequenceStepSchema = z.object({
  position: z.coerce.number().int().min(0).max(14).optional(),
  delayHours: z.coerce.number().int().min(0).max(24 * 365).default(24),
  subjectTemplate: z.string().trim().min(1, "Subject template is required").max(200),
  bodyTemplate: z.string().trim().min(1, "Body template is required").max(20000),
});

export const sequenceCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).default(""),
  steps: z.array(sequenceStepSchema).min(1, "A sequence needs at least one step").max(15),
});

export const sequenceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
});

export const sequenceStepsReplaceSchema = z.object({
  steps: z.array(sequenceStepSchema).min(1).max(15),
});

// Exactly one of contactId / leadId, enforced at route level via refine.
export const sequenceEnrollSchema = z
  .object({
    contactId: z.string().trim().min(1).max(64).optional(),
    leadId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => Boolean(v.contactId) !== Boolean(v.leadId), {
    message: "Provide exactly one of contactId or leadId",
  });

export const leadConvertSchema = z.object({
  createDeal: z.boolean().default(true),
  dealName: z.string().trim().max(150).optional(),
  dealValue: z.coerce.number().min(0).optional(),
  pipelineId: z.string().trim().max(64).optional(),
  expectedCloseDate: z.string().trim().optional().transform(emptyToUndefined),
});

export const dealCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  contactId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  companyId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  stageId: z.string().trim().min(1, "Stage is required").max(64),
  ownerId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  sourceId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  value: z.coerce.number().min(0).max(100_000_000).default(0),
  expectedCloseDate: z.string().trim().optional().transform(emptyToUndefined),
  nextStep: optionalTrimmed,
  notes: z.string().max(5000).optional().default(""),
});

export const dealUpdateSchema = dealCreateSchema.partial().extend({
  status: z.enum(DEAL_STATUSES).optional(),
  lostReason: z.string().max(500).optional(),
});

export const stageMoveSchema = z.object({
  stageId: z.string().trim().min(1).max(64),
  position: z.coerce.number().int().min(0).optional(),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional().default(""),
  type: z.enum(TASK_TYPES).default("TODO"),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  dueAt: z.string().trim().optional().transform(emptyToUndefined),
  reminderAt: z.string().trim().optional().transform(emptyToUndefined),
  relatedType: z.enum(["contact", "company", "lead", "deal"]).optional().transform(emptyToUndefined),
  relatedId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  assignedUserId: z.string().trim().max(64).optional().transform(emptyToUndefined),
});

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(TASK_STATUSES).optional(),
  completedAt: z.string().trim().nullable().optional(),
});

export const activityCreateSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  contactId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  companyId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  dealId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  leadId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  durationMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  occurredAt: z.string().trim().optional().transform(emptyToUndefined),
});

export const noteCreateSchema = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(5000),
  contactId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  companyId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  dealId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  leadId: z.string().trim().max(64).optional().transform(emptyToUndefined),
});

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
});

export const leadSourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalTrimmed,
});

export const pipelineCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        probability: z.coerce.number().int().min(0).max(100).default(0),
        type: z.enum(STAGE_TYPES).default("OPEN"),
      })
    )
    .min(1)
    .max(15)
    .default([]),
});

export const emailTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(20000),
  category: z.string().trim().max(60).default("GENERAL"),
});

export const customFieldCreateSchema = z.object({
  entityType: z.enum(["contact", "company", "lead", "deal"]),
  name: z.string().trim().min(1).max(80),
  dataType: z.enum(CUSTOM_FIELD_TYPES).default("TEXT"),
  options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  isRequired: z.boolean().default(false),
});

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  industry: optionalTrimmed,
  website: optionalTrimmed,
  phone,
  address: optionalTrimmed,
  currency: z.string().trim().length(3).optional(),
});

export const notificationSettingsSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
});

export const emailSendSchema = z.object({
  to: z.string().trim().toLowerCase().email("Invalid recipient email"),
  toName: z.string().trim().max(120).optional(),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(50000),
  contactId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  leadId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  dealId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  templateId: z.string().trim().max(64).optional().transform(emptyToUndefined),
});

export const emailSettingsSchema = z.object({
  smtpHost: z.string().trim().max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().trim().max(255).optional(),
  fromAddress: z.string().trim().max(255).refine((v) => !v || /.+@.+\..+/.test(v), "Invalid from address").optional(),
  notificationsEnabled: z.boolean().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Search term must be at least 2 characters").max(120),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const contactImportSchema = z.object({
  contacts: z
    .array(
      z.object({
        firstName: z.string().trim().max(80),
        lastName: z.string().trim().max(80).default(""),
        email: z.string().trim().max(200).default(""),
        phone: z.string().trim().max(40).default(""),
        title: z.string().trim().max(100).default(""),
        company: z.string().trim().max(150).default(""),
      })
    )
    .min(1, "No contacts in file")
    .max(500, "Import limited to 500 contacts per batch"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadCaptureInput = z.infer<typeof leadCaptureSchema>;
export type DealCreateInput = z.infer<typeof dealCreateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;
export type EmailSendInput = z.infer<typeof emailSendSchema>;
export type EmailSettingsInput = z.infer<typeof emailSettingsSchema>;

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  description: z.string().max(5000).optional().default(""),
  sku: z.string().trim().max(64).optional().transform(emptyToUndefined),
  unitPrice: z.coerce.number().min(0).max(100_000_000),
  currency: z.string().trim().length(3).default("USD"),
  isActive: z.boolean().default(true),
});

export const productUpdateSchema = productCreateSchema.partial();

export const priceListCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional().default(""),
  isDefault: z.boolean().default(false),
});

export const priceListUpdateSchema = priceListCreateSchema.partial();

export const priceListItemCreateSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  price: z.coerce.number().min(0).max(100_000_000),
  currency: z.string().trim().length(3).default("USD"),
});

export const priceListItemsReplaceSchema = z.object({
  items: z.array(priceListItemCreateSchema).max(200),
});

export const dealLineItemCreateSchema = z.object({
  productId: z.string().trim().max(64).optional().transform(emptyToUndefined),
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(5000).optional().default(""),
  quantity: z.coerce.number().min(0.0001).max(1_000_000).default(1),
  unitPrice: z.coerce.number().min(0).max(100_000_000),
  total: z.coerce.number().min(0).max(100_000_000),
});

export const dealLineItemUpdateSchema = dealLineItemCreateSchema.partial();

export const dealLineItemsReplaceSchema = z.object({
  items: z.array(dealLineItemCreateSchema).max(100),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type PriceListCreateInput = z.infer<typeof priceListCreateSchema>;
export type PriceListUpdateInput = z.infer<typeof priceListUpdateSchema>;
export type PriceListItemCreateInput = z.infer<typeof priceListItemCreateSchema>;
export type DealLineItemCreateInput = z.infer<typeof dealLineItemCreateSchema>;
export type DealLineItemUpdateInput = z.infer<typeof dealLineItemUpdateSchema>;
