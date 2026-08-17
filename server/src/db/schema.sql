-- ==============================================================================
-- EMI Shield - Production PostgreSQL Database Schema DDL
-- ==============================================================================

CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER');
CREATE TYPE device_status AS ENUM ('PENDING', 'ENROLLED', 'ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING', 'INACTIVE', 'REMOVED');
CREATE TYPE installment_status AS ENUM ('PENDING', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'PAID');
CREATE TYPE plan_status AS ENUM ('CURRENT', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'COMPLETED', 'CANCELLED');
CREATE TYPE payment_method AS ENUM ('CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'ONLINE');
CREATE TYPE payment_status AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'REFUNDED');
CREATE TYPE qr_type AS ENUM ('STANDARD', 'PRO', 'LEGACY', 'QC');
CREATE TYPE enrollment_status AS ENUM ('WAITING', 'SCANNED', 'VERIFYING', 'ENROLLED', 'EXPIRED', 'FAILED');

-- Dealers / Retailers Table
CREATE TABLE dealers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    owner_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    license_key_id UUID,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users & Authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID REFERENCES dealers(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'DEALER_STAFF',
    phone VARCHAR(50) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Customers Table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    cnic VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    emergency_contact_name VARCHAR(255) NOT NULL,
    emergency_contact_phone VARCHAR(50) NOT NULL,
    notes TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Devices Table (Financed Smartphones)
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(150) NOT NULL,
    imei VARCHAR(20) UNIQUE NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    color VARCHAR(50),
    ram_storage VARCHAR(50),
    purchase_price NUMERIC(12, 2) NOT NULL,
    status device_status NOT NULL DEFAULT 'PENDING',
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    battery_level INTEGER DEFAULT 100,
    is_online BOOLEAN DEFAULT TRUE,
    os_version VARCHAR(50) DEFAULT 'Android 14',
    security_patch VARCHAR(50) DEFAULT '2026-06-01',
    lock_reason TEXT,
    lock_message TEXT,
    location_lat NUMERIC(10, 6),
    location_lng NUMERIC(10, 6),
    sim_carrier VARCHAR(100),
    wifi_ssid VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enrollment Tokens for QR Provisioning
CREATE TABLE enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    qr_type qr_type NOT NULL DEFAULT 'STANDARD',
    status enrollment_status NOT NULL DEFAULT 'WAITING',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Installment Plans
CREATE TABLE installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    total_amount NUMERIC(12, 2) NOT NULL,
    down_payment NUMERIC(12, 2) NOT NULL,
    financed_amount NUMERIC(12, 2) NOT NULL,
    monthly_installment NUMERIC(12, 2) NOT NULL,
    total_installments INTEGER NOT NULL,
    paid_installments INTEGER DEFAULT 0,
    remaining_balance NUMERIC(12, 2) NOT NULL,
    first_due_date DATE NOT NULL,
    grace_period_days INTEGER DEFAULT 3,
    status plan_status NOT NULL DEFAULT 'CURRENT',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Individual Monthly Installment Records
CREATE TABLE installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    installment_number INTEGER NOT NULL,
    amount_due NUMERIC(12, 2) NOT NULL,
    amount_paid NUMERIC(12, 2) DEFAULT 0,
    due_date DATE NOT NULL,
    grace_date DATE NOT NULL,
    status installment_status NOT NULL DEFAULT 'PENDING',
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    installment_id UUID REFERENCES installments(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES installment_plans(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    payment_method payment_method NOT NULL DEFAULT 'CASH',
    reference_number VARCHAR(100) NOT NULL,
    notes TEXT,
    status payment_status NOT NULL DEFAULT 'PENDING',
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Financial Transactions Ledger
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- Device Action Logs (Immutable)
CREATE TABLE device_action_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    user_name VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    old_status device_status,
    new_status device_status,
    reason TEXT,
    command_payload TEXT,
    device_ack BOOLEAN DEFAULT TRUE,
    ip_address VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System Audit Logs (Immutable)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID REFERENCES dealers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    actor_name VARCHAR(255) NOT NULL,
    actor_role user_role NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    details TEXT NOT NULL,
    ip_address VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- License Keys
CREATE TABLE license_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    license_key VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) NOT NULL,
    device_limit INTEGER NOT NULL,
    used_devices INTEGER DEFAULT 0,
    expiry_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Dealer Device & Financing Policies
CREATE TABLE device_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID UNIQUE NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    grace_period_days INTEGER DEFAULT 3,
    auto_lock_enabled BOOLEAN DEFAULT FALSE,
    auto_unlock_enabled BOOLEAN DEFAULT TRUE,
    lock_warning_days INTEGER DEFAULT 2,
    customer_reminder_enabled BOOLEAN DEFAULT TRUE,
    emergency_calls_allowed BOOLEAN DEFAULT TRUE,
    payment_methods_on_lock TEXT[] DEFAULT ARRAY['CASH', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high throughput and fast queries
CREATE INDEX idx_devices_dealer_status ON devices(dealer_id, status);
CREATE INDEX idx_devices_imei ON devices(imei);
CREATE INDEX idx_customers_dealer ON customers(dealer_id);
CREATE INDEX idx_installments_status_due ON installments(dealer_id, status, due_date);
CREATE INDEX idx_payments_dealer ON payments(dealer_id);
CREATE INDEX idx_action_logs_device ON device_action_logs(device_id);
CREATE INDEX idx_audit_logs_dealer ON audit_logs(dealer_id);
