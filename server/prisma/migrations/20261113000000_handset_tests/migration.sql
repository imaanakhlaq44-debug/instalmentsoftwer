-- Handset compatibility tests.
--
-- One row is one real phone put through the lock app's checklist: provisioning,
-- enrol, lock, unlock and the rest. `steps` holds a result and a note per step;
-- `overall_result` is derived from it on every write and stored so the public
-- "tested phones" list is a plain indexed read.
--
-- `dealer_id` is nullable: the platform tests phones too, and a shop that is
-- later removed should not take its test evidence with it.
CREATE TYPE "HandsetTestOverall" AS ENUM ('PASS', 'FAIL', 'PARTIAL', 'NOT_TESTED');

CREATE TABLE "handset_tests" (
  "id"              TEXT           NOT NULL,
  "dealer_id"       TEXT,
  "brand"           VARCHAR(60)    NOT NULL,
  "model"           VARCHAR(80)    NOT NULL,
  "android_version" VARCHAR(20)    NOT NULL,
  "oem_build"       VARCHAR(120),
  "dpc_version"     VARCHAR(20)    NOT NULL,
  "steps"           JSONB          NOT NULL,
  "overall_result"  "HandsetTestOverall" NOT NULL,
  "notes"           VARCHAR(1000),
  "tested_by_id"    VARCHAR(64),
  "tested_by_name"  VARCHAR(120)   NOT NULL,
  "tested_at"       TIMESTAMPTZ(3) NOT NULL,
  "published"       BOOLEAN        NOT NULL DEFAULT false,
  "published_at"    TIMESTAMPTZ(3),
  "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "handset_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "handset_tests_dealer_id_tested_at_idx" ON "handset_tests"("dealer_id", "tested_at" DESC);
CREATE INDEX "handset_tests_brand_idx" ON "handset_tests"("brand");
CREATE INDEX "handset_tests_published_idx" ON "handset_tests"("published");

ALTER TABLE "handset_tests"
  ADD CONSTRAINT "handset_tests_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
