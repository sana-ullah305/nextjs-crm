import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { apiHandler, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

type QuotationPdfData = {
  id: string;
  quotationNumber: string;
  status: string;
  validUntil: Date | null;
  subtotal: number;
  tax: number;
  total: number;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  organization: { name: string; address: string; phone: string; website: string };
  contact: { firstName: string; lastName: string; email: string; phone: string } | null;
  company: { name: string } | null;
  deal: { name: string } | null;
  lineItems: Array<{
    name: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    product: { currency: string } | null;
  }>;
};

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }

  const user = await requireApiUserWith("quotations:read");
  const quotation = (await db.quotation.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      lineItems: { include: { product: true } },
      contact: true,
      company: true,
      deal: true,
      organization: true,
    },
  })) as unknown as QuotationPdfData;
  if (!quotation) throw new Error("Quotation not found");

  const pdfBuffer = await generateQuotationPdf(quotation);

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "QUOTATION_PDF_DOWNLOAD",
    entityType: "quotation",
    entityId: id,
    ipAddress: clientIp(req),
  });

  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="quotation-${quotation.quotationNumber}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
});

function generateQuotationPdf(quotation: QuotationPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(24).font("Helvetica-Bold").text("QUOTATION", { align: "center" });
    doc.moveDown(0.5);

    // Organization info
    const org = quotation.organization;
    doc.fontSize(10).font("Helvetica").text(org.name, { align: "right" });
    if (org.address) doc.text(org.address, { align: "right" });
    if (org.phone) doc.text("Phone: " + org.phone, { align: "right" });
    if (org.website) doc.text(org.website, { align: "right" });
    doc.moveDown(1);

    // Quotation details
    const col1 = 50;
    const col2 = 200;
    doc.fontSize(12).font("Helvetica-Bold");
    doc.text("Quotation #:", col1, doc.y, { continued: true });
    doc.font("Helvetica").text(quotation.quotationNumber, col2, doc.y);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Date:", col1, doc.y, { continued: true });
    doc.font("Helvetica").text(formatDate(quotation.createdAt), col2, doc.y);
    doc.moveDown(0.3);
    if (quotation.validUntil) {
      doc.font("Helvetica-Bold").text("Valid Until:", col1, doc.y, { continued: true });
      doc.font("Helvetica").text(formatDate(quotation.validUntil), col2, doc.y);
      doc.moveDown(0.3);
    }
    doc.font("Helvetica-Bold").text("Status:", col1, doc.y, { continued: true });
    doc.font("Helvetica").text(quotation.status, col2, doc.y);
    doc.moveDown(1);

    // Customer info
    doc.fontSize(12).font("Helvetica-Bold").text("Bill To:", col1);
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    if (quotation.contact) {
      doc.text(quotation.contact.firstName + " " + quotation.contact.lastName);
      if (quotation.contact.email) doc.text(quotation.contact.email);
      if (quotation.contact.phone) doc.text(quotation.contact.phone);
    }
    if (quotation.company) {
      if (quotation.contact) doc.moveDown(0.2);
      doc.text(quotation.company.name);
    }
    doc.moveDown(1);

    // Deal reference
    if (quotation.deal) {
      doc.fontSize(10).font("Helvetica-Bold").text("Deal: ", col1, doc.y, { continued: true });
      doc.font("Helvetica").text(quotation.deal.name, col2, doc.y);
      doc.moveDown(1);
    }

    // Line items table
    const tableTop = doc.y;
    const colX = [50, 100, 280, 380, 440, 500];
    const colW = [40, 180, 100, 60, 60, 60];

    // Header row
    doc.font("Helvetica-Bold").fontSize(9);
    doc.rect(col1, tableTop, 500, 20).fill("#f0f0f0");
    doc.fillColor("black");
    doc.text("#", colX[0], tableTop + 5, { width: colW[0], align: "left" });
    doc.text("Name", colX[1], tableTop + 5, { width: colW[1], align: "left" });
    doc.text("Description", colX[2], tableTop + 5, { width: colW[2], align: "left" });
    doc.text("Qty", colX[3], tableTop + 5, { width: colW[3], align: "right" });
    doc.text("Unit Price", colX[4], tableTop + 5, { width: colW[4], align: "right" });
    doc.text("Total", colX[5], tableTop + 5, { width: colW[5], align: "right" });

    // Data rows
    let y = tableTop + 20;
    doc.font("Helvetica").fontSize(9);
    quotation.lineItems.forEach((item, idx) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      const rowHeight = Math.max(20, doc.heightOfString(item.description || "—", { width: colW[2] }) + 6);
      doc.text(String(idx + 1), colX[0], y + 3, { width: colW[0], align: "left" });
      doc.text(item.name, colX[1], y + 3, { width: colW[1], align: "left" });
      doc.text(item.description || "—", colX[2], y + 3, { width: colW[2], align: "left" });
      doc.text(item.quantity.toString(), colX[3], y + 3, { width: colW[3], align: "right" });
      doc.text(formatCurrency(item.unitPrice), colX[4], y + 3, { width: colW[4], align: "right" });
      doc.text(formatCurrency(item.total), colX[5], y + 3, { width: colW[5], align: "right" });
      y += rowHeight;
    });

    // Totals
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Subtotal:", colX[4] - 60, y, { width: 80, align: "right" });
    doc.text(formatCurrency(quotation.subtotal || 0), colX[5], y, { width: colW[5], align: "right" });
    y += 18;
    doc.text("Tax:", colX[4] - 60, y, { width: 80, align: "right" });
    doc.text(formatCurrency(quotation.tax || 0), colX[5], y, { width: colW[5], align: "right" });
    y += 18;
    doc.text("Total:", colX[4] - 60, y, { width: 80, align: "right" });
    doc.text(formatCurrency(quotation.total || 0), colX[5], y, { width: colW[5], align: "right" });

    // Notes / Terms
    if (quotation.notes) {
      y += 30;
      doc.font("Helvetica-Bold").fontSize(10).text("Notes / Terms:", 50, y);
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(9).text(quotation.notes, 50, doc.y, { width: 500 });
    }

    doc.end();
  });
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}
