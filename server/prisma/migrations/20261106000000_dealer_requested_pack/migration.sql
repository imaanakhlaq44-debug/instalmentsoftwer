-- The pack of locks a shop asked for when it signed up.
--
-- Sign-up records the request but issues nothing (locks are minted only after
-- the platform confirms payment). Keeping the request on the dealer lets the
-- super admin's platform dashboard list shops still waiting to pay, and what
-- each owes. It is cleared once any pack is issued to that shop.
ALTER TABLE "dealers" ADD COLUMN "requested_pack_size" INTEGER;
