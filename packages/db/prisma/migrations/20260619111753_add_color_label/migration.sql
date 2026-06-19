-- CreateEnum
CREATE TYPE "ColorLabel" AS ENUM ('gray', 'pink', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple');

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "colorLabel" "ColorLabel";
