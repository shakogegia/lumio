-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "uploadTemplate" TEXT NOT NULL DEFAULT '{YYYY}/{YYYY}-{MM}-{DD}/{filename}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);
