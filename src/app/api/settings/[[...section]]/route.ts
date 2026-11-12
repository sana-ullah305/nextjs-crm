import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import {
  organizationUpdateSchema,
  tagCreateSchema,
  leadSourceCreateSchema,
  pipelineCreateSchema,
  emailTemplateCreateSchema,
  customFieldCreateSchema,
} from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ section?: string[]; id?: string[] }> };

async function resolvePath(ctx: Ctx): Promise<string[]> {
  const parts = (await ctx.params) as unknown as { section?: string[] };
  return parts.section ?? [];
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const user = await requireApiUserWith("settings:read");
  const section = segs[0] ?? "overview";
  const orgId = user.organizationId;

  switch (section) {
    case "overview":
    case "organization": {
      const org = await db.organization.findUnique({
        where: { id: orgId },
        include: { emailSettings: true },
      });
      return ok({ organization: org });
    }
    case "tags": {
      const tags = await db.tag.findMany({
        where: { organizationId: orgId },
        orderBy: { name: "asc" },
      });
      return ok({ tags });
    }
    case "lead-sources": {
      const sources = await db.leadSource.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "asc" },
      });
      return ok({ sources });
    }
    case "pipelines": {
      const pipelines = await db.pipeline.findMany({
        where: { organizationId: orgId },
        include: {
          stages: { orderBy: { position: "asc" } },
          _count: { select: { deals: true } },
        },
      });
      return ok({ pipelines });
    }
    case "email-templates": {
      const templates = await db.emailTemplate.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
      });
      return ok({ templates });
    }
    case "custom-fields": {
      const fields = await db.customField.findMany({
        where: { organizationId: orgId },
        orderBy: [{ entityType: "asc" }, { position: "asc" }],
      });
      return ok({ fields });
    }
    case "users": {
      const users = await db.user.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, role: true, isActive: true, avatarColor: true },
        orderBy: { name: "asc" },
      });
      return ok({ users });
    }
    default:
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown settings section" } }, { status: 404 });
  }
});

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const section = segs[0] ?? "";
  const id = segs[1] ?? null;

  if (!id) {
    switch (section) {
      case "tags": {
        const user = await requireApiUserWith("settings:manage");
        const body = await parseBody(req, tagCreateSchema);
        const exists = await db.tag.findFirst({
          where: { organizationId: user.organizationId, name: body.name },
        });
        if (exists) throw new ApiValidationError([{ path: ["name"], message: "Tag already exists" }]);
        const tag = await db.tag.create({
          data: { organizationId: user.organizationId, name: body.name, color: body.color },
        });
        await writeAudit({
          organizationId: user.organizationId,
          userId: user.id,
          action: "TAG_CREATE",
          entityType: "tag",
          entityId: tag.id,
          ipAddress: clientIp(req),
        });
        return ok(tag, { status: 201 });
      }
      case "lead-sources": {
        const user = await requireApiUserWith("settings:manage");
        const body = await parseBody(req, leadSourceCreateSchema);
        const exists = await db.leadSource.findFirst({
          where: { organizationId: user.organizationId, name: body.name },
        });
        if (exists) throw new ApiValidationError([{ path: ["name"], message: "Source already exists" }]);
        const source = await db.leadSource.create({
          data: {
            organizationId: user.organizationId,
            name: body.name,
            description: body.description,
          },
        });
        await writeAudit({
          organizationId: user.organizationId,
          userId: user.id,
          action: "LEAD_SOURCE_CREATE",
          entityType: "leadSource",
          entityId: source.id,
          ipAddress: clientIp(req),
        });
        return ok(source, { status: 201 });
      }
      case "pipelines": {
        const user = await requireApiUserWith("pipelines:manage");
        const body = await parseBody(req, pipelineCreateSchema);
        if (body.stages.length === 0) {
          throw new ApiValidationError([
            { path: ["stages"], message: "A pipeline needs at least one stage" },
          ]);
        }
        const result = await db.$transaction(async (tx) => {
          const pipeline = await tx.pipeline.create({
            data: { organizationId: user.organizationId, name: body.name },
          });
          for (let i = 0; i < body.stages.length; i++) {
            const s = body.stages[i]!;
            await tx.stage.create({
              data: {
                pipelineId: pipeline.id,
                name: s.name,
                position: i,
                probability: s.probability,
                type: s.type,
              },
            });
          }
          return pipeline;
        });
        await writeAudit({
          organizationId: user.organizationId,
          userId: user.id,
          action: "PIPELINE_CREATE",
          entityType: "pipeline",
          entityId: result.id,
          ipAddress: clientIp(req),
        });
        return ok(result, { status: 201 });
      }
      case "email-templates": {
        const user = await requireApiUserWith("settings:manage");
        const body = await parseBody(req, emailTemplateCreateSchema);
        const template = await db.emailTemplate.create({
          data: {
            organizationId: user.organizationId,
            name: body.name,
            subject: body.subject,
            body: body.body,
            category: body.category,
          },
        });
        await writeAudit({
          organizationId: user.organizationId,
          userId: user.id,
          action: "EMAIL_TEMPLATE_CREATE",
          entityType: "emailTemplate",
          entityId: template.id,
          ipAddress: clientIp(req),
        });
        return ok(template, { status: 201 });
      }
      case "custom-fields": {
        const user = await requireApiUserWith("settings:manage");
        const body = await parseBody(req, customFieldCreateSchema);
        const count = await db.customField.count({
          where: { organizationId: user.organizationId, entityType: body.entityType },
        });
        const field = await db.customField.create({
          data: {
            organizationId: user.organizationId,
            entityType: body.entityType,
            name: body.name,
            dataType: body.dataType,
            options: JSON.stringify(body.options),
            isRequired: body.isRequired,
            position: count,
          },
        });
        await writeAudit({
          organizationId: user.organizationId,
          userId: user.id,
          action: "CUSTOM_FIELD_CREATE",
          entityType: "customField",
          entityId: field.id,
          ipAddress: clientIp(req),
        });
        return ok(field, { status: 201 });
      }
      default:
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown section" } }, { status: 404 });
    }
  }
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const section = segs[0] ?? "";
  const id = segs[1] ?? null;

  if (!id) {
    if (section === "organization") {
      const user = await requireApiUserWith("settings:manage");
      const body = await parseBody(req, organizationUpdateSchema);
      const org = await db.organization.update({
        where: { id: user.organizationId },
        data: { ...body },
      });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "ORGANIZATION_UPDATE",
        entityType: "organization",
        entityId: org.id,
        ipAddress: clientIp(req),
      });
      return ok(org);
    }
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }

  switch (section) {
    case "pipelines": {
      // PATCH /settings/pipelines/:id — rename pipeline, or set default.
      const user = await requireApiUserWith("pipelines:manage");
      const pipeline = await db.pipeline.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!pipeline) throw new ApiNotFoundError("Pipeline not found");
      const body = await parseBody(
        req,
        z.object({
          name: z.string().trim().min(1).max(100).optional(),
          isDefault: z.boolean().optional(),
        })
      );
      if (body.isDefault) {
        await db.pipeline.updateMany({
          where: { organizationId: user.organizationId },
          data: { isDefault: false },
        });
      }
      const updated = await db.pipeline.update({
        where: { id },
        data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}) },
        include: { stages: { orderBy: { position: "asc" } } },
      });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "PIPELINE_UPDATE",
        entityType: "pipeline",
        entityId: id,
        ipAddress: clientIp(req),
      });
      return ok(updated);
    }
    case "email-templates": {
      const user = await requireApiUserWith("settings:manage");
      const template = await db.emailTemplate.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!template) throw new ApiNotFoundError("Template not found");
      const body = await parseBody(
        req,
        emailTemplateCreateSchema.partial()
      );
      const updated = await db.emailTemplate.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.subject !== undefined ? { subject: body.subject } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
        },
      });
      return ok(updated);
    }
    default:
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const section = segs[0] ?? "";
  const id = segs[1] ?? null;
  if (!id) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }

  switch (section) {
    case "tags": {
      const user = await requireApiUserWith("settings:manage");
      const tag = await db.tag.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!tag) throw new ApiNotFoundError("Tag not found");
      await db.tag.delete({ where: { id } });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "TAG_DELETE",
        entityType: "tag",
        entityId: id,
        ipAddress: clientIp(req),
      });
      return ok({ deleted: true });
    }
    case "lead-sources": {
      const user = await requireApiUserWith("settings:manage");
      const inUse = await db.lead.count({
        where: { sourceId: id, deletedAt: null },
      });
      if (inUse > 0) {
        throw new ApiValidationError([
          { path: ["id"], message: "Cannot delete a source that is used by leads" },
        ]);
      }
      const source = await db.leadSource.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!source) throw new ApiNotFoundError("Lead source not found");
      await db.leadSource.delete({ where: { id } });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "LEAD_SOURCE_DELETE",
        entityType: "leadSource",
        entityId: id,
        ipAddress: clientIp(req),
      });
      return ok({ deleted: true });
    }
    case "email-templates": {
      const user = await requireApiUserWith("settings:manage");
      const template = await db.emailTemplate.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!template) throw new ApiNotFoundError("Template not found");
      await db.emailTemplate.delete({ where: { id } });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "EMAIL_TEMPLATE_DELETE",
        entityType: "emailTemplate",
        entityId: id,
        ipAddress: clientIp(req),
      });
      return ok({ deleted: true });
    }
    case "custom-fields": {
      const user = await requireApiUserWith("settings:manage");
      const field = await db.customField.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!field) throw new ApiNotFoundError("Custom field not found");
      await db.customField.delete({ where: { id } });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "CUSTOM_FIELD_DELETE",
        entityType: "customField",
        entityId: id,
        ipAddress: clientIp(req),
      });
      return ok({ deleted: true });
    }
    case "pipelines": {
      const user = await requireApiUserWith("pipelines:manage");
      const pipeline = await db.pipeline.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { _count: { select: { deals: true } } },
      });
      if (!pipeline) throw new ApiNotFoundError("Pipeline not found");
      if (pipeline._count.deals > 0) {
        throw new ApiValidationError([
          { path: ["id"], message: "Cannot delete a pipeline that contains deals" },
        ]);
      }
      const remaining = await db.pipeline.count({
        where: { organizationId: user.organizationId },
      });
      if (remaining <= 1) {
        throw new ApiValidationError([
          { path: ["id"], message: "At least one pipeline is required" },
        ]);
      }
      await db.pipeline.delete({ where: { id } });
      await writeAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "PIPELINE_DELETE",
        entityType: "pipeline",
        entityId: id,
        ipAddress: clientIp(req),
      });
      return ok({ deleted: true });
    }
    default:
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }
});
