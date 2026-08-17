/**
 * Writes the demo dataset into PostgreSQL.
 *
 * `generateSeedData()` stays the single source of the fixture — this only
 * persists it, in foreign-key order, inside one transaction so a failure
 * half-way cannot leave a partly-populated database.
 */
import { runInTransaction, Tx, prisma } from './prisma.js';
import { generateSeedData } from './seed.js';
import { repo } from './repositories/index.js';

/**
 * Insert order matters: every table below depends only on tables above it.
 * Dealers reference a licence key and licence keys reference a dealer, so that
 * one circular pair is handled by inserting dealers first — the column is not a
 * declared foreign key precisely because of this.
 */
export async function seedPostgres(): Promise<void> {
  const data = generateSeedData();

  await runInTransaction(async (tx: Tx) => {
    await repo.dealers.createMany(data.dealers, tx);
    await repo.licenseKeys.createMany(data.licenseKeys, tx);
    await repo.devicePolicies.createMany(data.devicePolicies, tx);
    await repo.customers.createMany(data.customers, tx);
    // Users reference both a dealer and, for CUSTOMER logins, a customer.
    await repo.users.createMany(data.users, tx);
    await repo.devices.createMany(data.devices, tx);
    await repo.installmentPlans.createMany(data.installmentPlans, tx);
    await repo.installments.createMany(data.installments, tx);
    await repo.payments.createMany(data.payments, tx);
    await repo.transactions.createMany(data.transactions, tx);
    await repo.enrollmentTokens.createMany(data.enrollmentTokens, tx);
    await repo.deviceActionLogs.createMany(data.deviceActionLogs, tx);
    await repo.auditLogs.createMany(data.auditLogs, tx);
    await repo.notifications.createMany(data.notifications, tx);
    await repo.notificationTemplates.createMany(data.notificationTemplates, tx);
  });
}

/**
 * Every table, ordered so that truncating in sequence never trips a foreign
 * key. `TRUNCATE ... CASCADE` handles it in one statement, but listing them
 * keeps the intent explicit and the statement reviewable.
 */
const ALL_TABLES = [
  'installments',
  'installment_plans',
  'payments',
  'transactions',
  'device_action_logs',
  'devices',
  'enrollment_tokens',
  'notifications',
  'notification_templates',
  'audit_logs',
  'customers',
  'users',
  'device_policies',
  'license_keys',
  'dealers',
] as const;

/** Empties every table. Used by the test harness between cases. */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`
  );
}

/** Reseeds from scratch — truncate, then load the demo dataset. */
export async function resetAndSeedPostgres(): Promise<void> {
  await truncateAll();
  await seedPostgres();
}

/** `npm run db:seed` */
if (process.argv[1]?.endsWith('seedPostgres.ts')) {
  resetAndSeedPostgres()
    .then(async () => {
      const counts = await Promise.all([
        repo.dealers.count(),
        repo.customers.count(),
        repo.devices.count(),
        repo.installments.count(),
        repo.payments.count(),
      ]);
      console.log('PostgreSQL seeded successfully.');
      console.log(`- Dealers:      ${counts[0]}`);
      console.log(`- Customers:    ${counts[1]}`);
      console.log(`- Devices:      ${counts[2]}`);
      console.log(`- Installments: ${counts[3]}`);
      console.log(`- Payments:     ${counts[4]}`);
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Seeding failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
