-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT NOT NULL DEFAULT '',
    "sentEmailId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InboundEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InboundEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InboundEmail_sentEmailId_fkey" FOREIGN KEY ("sentEmailId") REFERENCES "SentEmail" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SentEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL DEFAULT '',
    "contactId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME,
    "messageId" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SentEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SentEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SentEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SentEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SentEmail_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SentEmail_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SentEmail" ("body", "contactId", "createdAt", "dealId", "error", "id", "leadId", "organizationId", "recipientEmail", "recipientName", "sentAt", "status", "subject", "templateId", "userId") SELECT "body", "contactId", "createdAt", "dealId", "error", "id", "leadId", "organizationId", "recipientEmail", "recipientName", "sentAt", "status", "subject", "templateId", "userId" FROM "SentEmail";
DROP TABLE "SentEmail";
ALTER TABLE "new_SentEmail" RENAME TO "SentEmail";
CREATE INDEX "SentEmail_organizationId_createdAt_idx" ON "SentEmail"("organizationId", "createdAt");
CREATE INDEX "SentEmail_contactId_idx" ON "SentEmail"("contactId");
CREATE INDEX "SentEmail_leadId_idx" ON "SentEmail"("leadId");
CREATE INDEX "SentEmail_dealId_idx" ON "SentEmail"("dealId");
CREATE INDEX "SentEmail_userId_createdAt_idx" ON "SentEmail"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "InboundEmail_organizationId_receivedAt_idx" ON "InboundEmail"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundEmail_contactId_idx" ON "InboundEmail"("contactId");

-- CreateIndex
CREATE INDEX "InboundEmail_leadId_idx" ON "InboundEmail"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_organizationId_messageId_key" ON "InboundEmail"("organizationId", "messageId");
