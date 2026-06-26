-- CreateTable
CREATE TABLE "MetadataGroup" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" TEXT NOT NULL COLLATE "C",
    CONSTRAINT "MetadataGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataField" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "groupId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "builtinKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "suggests" BOOLEAN NOT NULL DEFAULT true,
    "position" TEXT NOT NULL COLLATE "C",
    CONSTRAINT "MetadataField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoMetadataValue" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "PhotoMetadataValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataGroup_catalogId_idx" ON "MetadataGroup"("catalogId");
CREATE INDEX "MetadataField_catalogId_idx" ON "MetadataField"("catalogId");
CREATE UNIQUE INDEX "MetadataField_catalogId_key_key" ON "MetadataField"("catalogId", "key");
CREATE UNIQUE INDEX "PhotoMetadataValue_photoId_fieldId_key" ON "PhotoMetadataValue"("photoId", "fieldId");
CREATE INDEX "PhotoMetadataValue_fieldId_value_idx" ON "PhotoMetadataValue"("fieldId", "value");

-- AddForeignKey
ALTER TABLE "MetadataGroup" ADD CONSTRAINT "MetadataGroup_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataField" ADD CONSTRAINT "MetadataField_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataField" ADD CONSTRAINT "MetadataField_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MetadataGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhotoMetadataValue" ADD CONSTRAINT "PhotoMetadataValue_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoMetadataValue" ADD CONSTRAINT "PhotoMetadataValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "MetadataField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
