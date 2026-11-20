-- Shop staff who may look at the shop's records but never change them.
ALTER TYPE "UserRole" ADD VALUE 'DEALER_VIEWER' BEFORE 'CUSTOMER';
