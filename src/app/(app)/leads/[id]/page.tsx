import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth";
import { findDuplicateCandidates } from "@/server/dedupe";
import LeadDetailClient from "@/components/lead-detail-client";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const lead = await db.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    include: {
      source: true,
      assignedUser: { select: { id: true, name: true, avatarColor: true } },
      owner: { select: { id: true, name: true, avatarColor: true } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 20,
        include: {
          user: { select: { id: true, name: true, avatarColor: true } },
          task: { select: { id: true, title: true } },
        },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { id: true, name: true, avatarColor: true } } },
      },
      sentEmails: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { template: { select: { id: true, name: true } } },
      },
      inboundEmails: {
        orderBy: { receivedAt: "desc" },
        take: 20,
      },
      deals: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { stage: { select: { id: true, name: true } } },
      },
    },
  });

  if (!lead) notFound();

  const duplicateCandidates = await findDuplicateCandidates(
    user.organizationId,
    "lead",
    lead.id
  );

  const leadTasks = await db.task.findMany({
    where: {
      organizationId: user.organizationId,
      relatedType: "lead",
      relatedId: lead.id,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    orderBy: { dueAt: "asc" },
    take: 20,
    include: {
      assignedUser: { select: { id: true, name: true, avatarColor: true } },
    },
  });

  const leadData = {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    companyName: lead.companyName,
    status: lead.status,
    score: lead.score,
    estimatedValue: lead.estimatedValue,
    expectedCloseDate: lead.expectedCloseDate?.toISOString() ?? null,
    followUpAt: lead.followUpAt?.toISOString() ?? null,
    summary: lead.summary,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    contactId: lead.contactId,
    source: lead.source ? { id: lead.source.id, name: lead.source.name } : null,
    assignedUser: lead.assignedUser
      ? { id: lead.assignedUser.id, name: lead.assignedUser.name, avatarColor: lead.assignedUser.avatarColor }
      : null,
    owner: lead.owner
      ? { id: lead.owner.id, name: lead.owner.name, avatarColor: lead.owner.avatarColor }
      : null,
    company: lead.company ? { id: lead.company.id, name: lead.company.name } : null,
    contact: lead.contact
      ? { id: lead.contact.id, firstName: lead.contact.firstName, lastName: lead.contact.lastName }
      : null,
    activities: lead.activities.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      description: a.description,
      occurredAt: a.occurredAt.toISOString(),
      user: { id: a.user.id, name: a.user.name, avatarColor: a.user.avatarColor },
      task: a.task ? { id: a.task.id, title: a.task.title } : null,
    })),
    notes: lead.notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      user: { id: n.user.id, name: n.user.name, avatarColor: n.user.avatarColor },
    })),
    sentEmails: lead.sentEmails.map((e) => ({
      id: e.id,
      subject: e.subject,
      recipientEmail: e.recipientEmail,
      recipientName: e.recipientName,
      status: e.status,
      sentAt: e.sentAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
      template: e.template ? { id: e.template.id, name: e.template.name } : null,
    })),
    inboundEmails: lead.inboundEmails.map((e) => ({
      id: e.id,
      fromEmail: e.fromEmail,
      fromName: e.fromName,
      subject: e.subject,
      body: e.body,
      status: e.status,
      receivedAt: e.receivedAt.toISOString(),
      sentEmailId: e.sentEmailId,
    })),
    tasks: leadTasks.map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      assignedUser: t.assignedUser
        ? { id: t.assignedUser.id, name: t.assignedUser.name, avatarColor: t.assignedUser.avatarColor }
        : null,
    })),
    deals: lead.deals.map((d) => ({
      id: d.id,
      name: d.name,
      value: d.value,
      status: d.status,
      stage: d.stage ? { id: d.stage.id, name: d.stage.name } : null,
    })),
    duplicateCandidates: duplicateCandidates.map((c) => ({
      id: c.id,
      type: c.type,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      status: c.status,
      score: c.score,
      matchReasons: c.matchReasons,
    })),
  };

  return <LeadDetailClient lead={leadData} />;
}
