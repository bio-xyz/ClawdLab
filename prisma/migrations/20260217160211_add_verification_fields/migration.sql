-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "domain" TEXT,
ADD COLUMN     "verificationBadge" TEXT,
ADD COLUMN     "verificationCompletedAt" TIMESTAMP(3),
ADD COLUMN     "verificationDomain" TEXT,
ADD COLUMN     "verificationResult" JSONB,
ADD COLUMN     "verificationStartedAt" TIMESTAMP(3),
ADD COLUMN     "verificationStatus" TEXT;
