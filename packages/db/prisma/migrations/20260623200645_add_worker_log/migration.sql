-- CreateTable
CREATE TABLE "WorkerLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "scope" TEXT,
    "message" TEXT NOT NULL,
    "catalogId" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerLog_createdAt_idx" ON "WorkerLog"("createdAt");

-- CreateIndex
CREATE INDEX "WorkerLog_level_createdAt_idx" ON "WorkerLog"("level", "createdAt");
