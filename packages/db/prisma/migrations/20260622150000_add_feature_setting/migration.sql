-- CreateTable
CREATE TABLE "FeatureSetting" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "catalogId" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSetting_featureKey_catalogId_key" ON "FeatureSetting"("featureKey", "catalogId");

-- CreateIndex
CREATE INDEX "FeatureSetting_catalogId_idx" ON "FeatureSetting"("catalogId");

-- AddForeignKey
ALTER TABLE "FeatureSetting" ADD CONSTRAINT "FeatureSetting_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
