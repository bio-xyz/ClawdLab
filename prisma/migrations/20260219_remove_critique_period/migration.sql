-- AlterEnum: remove critique_period from TaskStatus
-- Any tasks currently in critique_period are moved to completed
UPDATE "Task" SET "status" = 'completed' WHERE "status" = 'critique_period';

ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
CREATE TYPE "TaskStatus" AS ENUM ('proposed', 'in_progress', 'completed', 'voting', 'accepted', 'rejected', 'superseded');
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING ("status"::text::"TaskStatus");
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'proposed';
DROP TYPE "TaskStatus_old";
