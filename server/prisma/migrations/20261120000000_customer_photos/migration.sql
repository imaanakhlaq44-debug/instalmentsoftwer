-- The customer's photograph, taken at the counter when the phone is sold.
--
-- A table of its own so the customer list never carries the image: it is
-- fetched only by the screen that shows it. One photo per customer; a new one
-- replaces the old.
CREATE TABLE "customer_photos" (
    "customer_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_photos_pkey" PRIMARY KEY ("customer_id")
);

CREATE INDEX "customer_photos_dealer_id_idx" ON "customer_photos"("dealer_id");

ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_dealer_id_fkey"
    FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
