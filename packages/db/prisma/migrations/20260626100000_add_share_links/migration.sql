-- CreateTable
CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "title" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ShareLink_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShareLinkPhoto" (
    "shareLinkId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,

    CONSTRAINT "ShareLinkPhoto_pkey" PRIMARY KEY ("shareLinkId", "photoId"),
    CONSTRAINT "ShareLinkPhoto_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLinkPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShareLink_catalogId_idx" ON "ShareLink"("catalogId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShareLinkPhoto_photoId_idx" ON "ShareLinkPhoto"("photoId");
