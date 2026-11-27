-- CreateTable
CREATE TABLE "SequenceDeadLetter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "stepId" TEXT NOT NULL,
    "stepPosition" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SequenceDeadLetter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SequenceDeadLetter_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SequenceDeadLetter_organizationId_createdAt_idx" ON "SequenceDeadLetter"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SequenceDeadLetter_enrollmentId_idx" ON "SequenceDeadLetter"("enrollmentId");
