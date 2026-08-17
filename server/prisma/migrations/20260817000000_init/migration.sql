-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'ENROLLED', 'ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING', 'INACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PendingCommand" AS ENUM ('LOCK', 'UNLOCK');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'PAID');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('CURRENT', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'ONLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "QRType" AS ENUM ('STANDARD', 'PRO', 'LEGACY', 'QC');

-- CreateEnum
CREATE TYPE "EnrollmentTokenStatus" AS ENUM ('WAITING', 'SCANNED', 'VERIFYING', 'ENROLLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DOWN_PAYMENT', 'MONTHLY_INSTALLMENT', 'LATE_FEE', 'LATE_FEE_WAIVER', 'REFUND', 'REVERSAL', 'ADVANCE_CREDIT', 'EARLY_SETTLEMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'PENDING', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "DeviceAction" AS ENUM ('LOCK', 'UNLOCK', 'REGISTER', 'ENROLL', 'REBOOT', 'SEND_MESSAGE', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "LicensePlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "LateFeeFrequency" AS ENUM ('ONE_TIME', 'DAILY');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT_DUE', 'PAYMENT_OVERDUE', 'DEVICE_LOCKED', 'DEVICE_UNLOCKED', 'DEVICE_OFFLINE', 'ENROLLMENT_SUCCESS', 'SECURITY_ALERT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "dealers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "owner_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "city" VARCHAR(60) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "license_key_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_keys" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "license_key" VARCHAR(60) NOT NULL,
    "plan" "LicensePlan" NOT NULL,
    "device_limit" INTEGER NOT NULL,
    "used_devices" INTEGER NOT NULL DEFAULT 0,
    "expiry_date" DATE NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "customer_id" TEXT,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "cnic" VARCHAR(20) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "emergency_contact_name" VARCHAR(120) NOT NULL,
    "emergency_contact_phone" VARCHAR(20) NOT NULL,
    "notes" VARCHAR(1000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "brand" VARCHAR(40) NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "imei" VARCHAR(20) NOT NULL,
    "serial_number" VARCHAR(64) NOT NULL,
    "color" VARCHAR(30) NOT NULL,
    "ram_storage" VARCHAR(40) NOT NULL,
    "purchase_price" INTEGER NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "last_seen" TIMESTAMPTZ(3) NOT NULL,
    "battery_level" INTEGER NOT NULL DEFAULT 100,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "os_version" VARCHAR(40) NOT NULL,
    "security_patch" VARCHAR(20) NOT NULL,
    "lock_reason" VARCHAR(500),
    "lock_message" VARCHAR(300),
    "location_lat" DOUBLE PRECISION,
    "location_lng" DOUBLE PRECISION,
    "sim_carrier" VARCHAR(40),
    "wifi_ssid" VARCHAR(60),
    "pending_command" "PendingCommand",
    "pending_command_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_action_logs" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "user_name" VARCHAR(120) NOT NULL,
    "action" "DeviceAction" NOT NULL,
    "old_status" "DeviceStatus",
    "new_status" "DeviceStatus",
    "reason" VARCHAR(600),
    "command_payload" TEXT,
    "device_ack" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_tokens" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "device_id" TEXT,
    "customer_id" TEXT,
    "token" VARCHAR(120) NOT NULL,
    "qr_type" "QRType" NOT NULL,
    "status" "EnrollmentTokenStatus" NOT NULL DEFAULT 'WAITING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "down_payment" INTEGER NOT NULL,
    "financed_amount" INTEGER NOT NULL,
    "monthly_installment" INTEGER NOT NULL,
    "total_installments" INTEGER NOT NULL,
    "paid_installments" INTEGER NOT NULL DEFAULT 0,
    "remaining_balance" INTEGER NOT NULL,
    "first_due_date" DATE NOT NULL,
    "grace_period_days" INTEGER NOT NULL DEFAULT 3,
    "status" "PlanStatus" NOT NULL DEFAULT 'CURRENT',
    "credit_balance" INTEGER NOT NULL DEFAULT 0,
    "outstanding_late_fees" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMPTZ(3),
    "closure_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount_due" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "grace_date" DATE NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "late_fee" INTEGER NOT NULL DEFAULT 0,
    "late_fee_paid" INTEGER NOT NULL DEFAULT 0,
    "late_fee_waived_at" TIMESTAMPTZ(3),
    "late_fee_waived_by" VARCHAR(64),
    "late_fee_waiver_reason" VARCHAR(500),
    "late_fee_accrued_through" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "installment_id" TEXT,
    "plan_id" TEXT,
    "amount" INTEGER NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "reference_number" VARCHAR(60) NOT NULL,
    "notes" VARCHAR(500),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by" VARCHAR(64),
    "verified_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by" VARCHAR(64),
    "reversal_reason" VARCHAR(500),
    "reversal_of_payment_id" VARCHAR(64),
    "late_fee_portion" INTEGER NOT NULL DEFAULT 0,
    "receipt_number" VARCHAR(40),
    "recorded_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "plan_id" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "date" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(500),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_policies" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "grace_period_days" INTEGER NOT NULL DEFAULT 3,
    "auto_lock_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_unlock_enabled" BOOLEAN NOT NULL DEFAULT true,
    "lock_warning_days" INTEGER NOT NULL DEFAULT 2,
    "customer_reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
    "emergency_calls_allowed" BOOLEAN NOT NULL DEFAULT true,
    "payment_methods_on_lock" TEXT[],
    "late_fee_enabled" BOOLEAN NOT NULL DEFAULT false,
    "late_fee_type" "LateFeeType" NOT NULL DEFAULT 'FIXED',
    "late_fee_amount" INTEGER NOT NULL DEFAULT 500,
    "late_fee_frequency" "LateFeeFrequency" NOT NULL DEFAULT 'ONE_TIME',
    "late_fee_max_per_installment" INTEGER NOT NULL DEFAULT 5000,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "user_id" VARCHAR(64) NOT NULL,
    "actor_name" VARCHAR(120) NOT NULL,
    "actor_role" "UserRole" NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(64) NOT NULL,
    "details" VARCHAR(1000) NOT NULL,
    "ip_address" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "device_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'SMS',
    "title" VARCHAR(120) NOT NULL,
    "message" VARCHAR(600) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "trigger_event" VARCHAR(60) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "subject_template" VARCHAR(200) NOT NULL,
    "body_template" VARCHAR(1000) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dealers_code_key" ON "dealers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dealers_email_key" ON "dealers"("email");

-- CreateIndex
CREATE INDEX "dealers_active_idx" ON "dealers"("active");

-- CreateIndex
CREATE UNIQUE INDEX "license_keys_license_key_key" ON "license_keys"("license_key");

-- CreateIndex
CREATE INDEX "license_keys_dealer_id_idx" ON "license_keys"("dealer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_dealer_id_idx" ON "users"("dealer_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "customers_dealer_id_idx" ON "customers"("dealer_id");

-- CreateIndex
CREATE INDEX "customers_dealer_id_name_idx" ON "customers"("dealer_id", "name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_dealer_id_cnic_key" ON "customers"("dealer_id", "cnic");

-- CreateIndex
CREATE UNIQUE INDEX "devices_imei_key" ON "devices"("imei");

-- CreateIndex
CREATE INDEX "devices_dealer_id_idx" ON "devices"("dealer_id");

-- CreateIndex
CREATE INDEX "devices_dealer_id_status_idx" ON "devices"("dealer_id", "status");

-- CreateIndex
CREATE INDEX "devices_customer_id_idx" ON "devices"("customer_id");

-- CreateIndex
CREATE INDEX "devices_dealer_id_brand_idx" ON "devices"("dealer_id", "brand");

-- CreateIndex
CREATE INDEX "device_action_logs_device_id_created_at_idx" ON "device_action_logs"("device_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "device_action_logs_dealer_id_created_at_idx" ON "device_action_logs"("dealer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_tokens_token_key" ON "enrollment_tokens"("token");

-- CreateIndex
CREATE INDEX "enrollment_tokens_dealer_id_created_at_idx" ON "enrollment_tokens"("dealer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "enrollment_tokens_status_expires_at_idx" ON "enrollment_tokens"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "installment_plans_device_id_key" ON "installment_plans"("device_id");

-- CreateIndex
CREATE INDEX "installment_plans_dealer_id_status_idx" ON "installment_plans"("dealer_id", "status");

-- CreateIndex
CREATE INDEX "installment_plans_customer_id_idx" ON "installment_plans"("customer_id");

-- CreateIndex
CREATE INDEX "installments_status_grace_date_idx" ON "installments"("status", "grace_date");

-- CreateIndex
CREATE INDEX "installments_plan_id_installment_number_idx" ON "installments"("plan_id", "installment_number");

-- CreateIndex
CREATE INDEX "installments_dealer_id_due_date_idx" ON "installments"("dealer_id", "due_date");

-- CreateIndex
CREATE INDEX "installments_customer_id_idx" ON "installments"("customer_id");

-- CreateIndex
CREATE INDEX "payments_dealer_id_created_at_idx" ON "payments"("dealer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_customer_id_created_at_idx" ON "payments"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_plan_id_idx" ON "payments"("plan_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_dealer_id_reference_number_key" ON "payments"("dealer_id", "reference_number");

-- CreateIndex
CREATE INDEX "transactions_dealer_id_date_idx" ON "transactions"("dealer_id", "date" DESC);

-- CreateIndex
CREATE INDEX "transactions_customer_id_idx" ON "transactions"("customer_id");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "device_policies_dealer_id_key" ON "device_policies"("dealer_id");

-- CreateIndex
CREATE INDEX "audit_logs_dealer_id_created_at_idx" ON "audit_logs"("dealer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_idx" ON "audit_logs"("target_type");

-- CreateIndex
CREATE INDEX "notifications_dealer_id_created_at_idx" ON "notifications"("dealer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_customer_id_created_at_idx" ON "notifications"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- AddForeignKey
ALTER TABLE "license_keys" ADD CONSTRAINT "license_keys_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_action_logs" ADD CONSTRAINT "device_action_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_action_logs" ADD CONSTRAINT "device_action_logs_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_policies" ADD CONSTRAINT "device_policies_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

