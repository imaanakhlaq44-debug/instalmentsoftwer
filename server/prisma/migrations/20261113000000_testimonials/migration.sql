-- Real feedback from shops, for the website.
--
-- The site's testimonials section has only ever held samples, and the site
-- build refuses to publish those. This is where genuine ones come from: a shop
-- owner writes a quote, ticks a consent box permitting publication under the
-- name and city they chose, and the platform approves it. One row per shop.
-- Only APPROVED rows are ever served publicly; the consent wording, who gave it
-- and when are kept on the row.
CREATE TYPE "TestimonialStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'UNPUBLISHED', 'WITHDRAWN');

CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "quote" VARCHAR(600) NOT NULL,
    "rating" SMALLINT NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "city" VARCHAR(60) NOT NULL,
    "language" VARCHAR(2) NOT NULL,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'PENDING',
    "consent_text" VARCHAR(500) NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_by_user_id" VARCHAR(64) NOT NULL,
    "consent_by_name" VARCHAR(120) NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_name" VARCHAR(120),
    "review_note" VARCHAR(300),
    "withdrawn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "testimonials_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "testimonials_dealer_id_key" ON "testimonials"("dealer_id");
CREATE INDEX "testimonials_status_reviewed_at_idx" ON "testimonials"("status", "reviewed_at" DESC);

ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_dealer_id_fkey"
    FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
