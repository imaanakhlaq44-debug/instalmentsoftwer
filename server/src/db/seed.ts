import {
  Dealer,
  User,
  Customer,
  Device,
  InstallmentPlan,
  Installment,
  Payment,
  Transaction,
  LicenseKey,
  DevicePolicy,
  AuditLog,
  DeviceActionLog,
  Notification,
  NotificationTemplate,
  EnrollmentToken,
} from '../types/index.js';
import { hashPassword } from '../utils/password.js';
import { config } from '../config.js';

/**
 * The demo dataset, one array per table.
 *
 * This is the only shape the old JSON store left behind: it describes the
 * fixture, not a storage engine. `seedPostgres.ts` writes it to the database.
 */
export interface SeedData {
  dealers: Dealer[];
  users: User[];
  customers: Customer[];
  devices: Device[];
  enrollmentTokens: EnrollmentToken[];
  installmentPlans: InstallmentPlan[];
  installments: Installment[];
  payments: Payment[];
  transactions: Transaction[];
  deviceActionLogs: DeviceActionLog[];
  auditLogs: AuditLog[];
  licenseKeys: LicenseKey[];
  devicePolicies: DevicePolicy[];
  notifications: Notification[];
  notificationTemplates: NotificationTemplate[];
}

export function generateSeedData(): SeedData {
  const now = new Date('2026-08-17T06:00:00.000Z');

  // Every demo account shares one password, hashed once and reused so seeding
  // stays fast. Set SEED_DEFAULT_PASSWORD in server/.env to change it.
  const demoPasswordHash = hashPassword(config.seedDefaultPassword);

  // 1. Dealers
  const dealers: Dealer[] = [
    {
      id: 'dealer-1',
      name: 'Al-Madina Mobile Hub',
      code: 'AMM-LHR',
      ownerName: 'Tariq Mehmood',
      email: 'tariq@almadinamobiles.pk',
      phone: '0300-8451299',
      city: 'Lahore',
      address: 'Shop 42, Ground Floor, Hafeez Centre, Gulberg III, Lahore',
      licenseKeyId: 'lic-1',
      active: true,
      createdAt: '2026-01-10T10:00:00.000Z',
    },
    {
      id: 'dealer-2',
      name: 'Karachi Telecom Traders',
      code: 'KTT-KHI',
      ownerName: 'Kamran Siddiqui',
      email: 'kamran@karachiteleecom.pk',
      phone: '0321-9988771',
      city: 'Karachi',
      address: 'Shop 112, Star City Mall, Saddar, Karachi',
      licenseKeyId: 'lic-2',
      active: true,
      createdAt: '2026-01-15T11:30:00.000Z',
    },
    {
      id: 'dealer-3',
      name: 'Rawalpindi SmartFin Mobiles',
      code: 'RSM-RWP',
      ownerName: 'Chaudhry Bilal',
      email: 'bilal@smartfinrwp.pk',
      phone: '0333-5123456',
      city: 'Rawalpindi',
      address: 'Opposite Singapore Plaza, Bank Road, Saddar, Rawalpindi',
      licenseKeyId: 'lic-3',
      active: true,
      createdAt: '2026-02-01T09:15:00.000Z',
    },
    {
      id: 'dealer-4',
      name: 'Islamabad Tech Installments',
      code: 'ITI-ISB',
      ownerName: 'Hamza Khan',
      email: 'hamza@isbtechfin.pk',
      phone: '0345-5544332',
      city: 'Islamabad',
      address: 'Mezzanine Floor, Beverly Centre, Blue Area, Islamabad',
      licenseKeyId: 'lic-4',
      active: true,
      createdAt: '2026-02-20T14:00:00.000Z',
    },
    {
      id: 'dealer-5',
      name: 'Peshawar Phone Point',
      code: 'PPP-PEW',
      ownerName: 'Fazal Rehman',
      email: 'fazal@peshawarphones.pk',
      phone: '0313-9090123',
      city: 'Peshawar',
      address: 'Deans Trade Centre, Cantt, Peshawar',
      licenseKeyId: 'lic-5',
      active: true,
      createdAt: '2026-03-05T08:45:00.000Z',
    },
  ];

  // 2. Users
  const users: User[] = [
    {
      id: 'user-superadmin',
      name: 'System Super Admin',
      email: 'admin@emishield.pk',
      passwordHash: demoPasswordHash,
      role: 'SUPER_ADMIN',
      phone: '0300-0000001',
      active: true,
      lastLoginAt: '2026-08-17T05:30:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'user-dealer-admin-1',
      dealerId: 'dealer-1',
      name: 'Tariq Mehmood (Admin)',
      email: 'tariq@almadinamobiles.pk',
      passwordHash: demoPasswordHash,
      role: 'DEALER_ADMIN',
      phone: '0300-8451299',
      active: true,
      lastLoginAt: '2026-08-17T05:45:00.000Z',
      createdAt: '2026-01-10T10:00:00.000Z',
    },
    {
      id: 'user-dealer-staff-1',
      dealerId: 'dealer-1',
      name: 'Usman Ali (Counter Staff)',
      email: 'usman@almadinamobiles.pk',
      passwordHash: demoPasswordHash,
      role: 'DEALER_STAFF',
      phone: '0304-7766554',
      active: true,
      lastLoginAt: '2026-08-16T17:20:00.000Z',
      createdAt: '2026-01-12T12:00:00.000Z',
    },
    {
      id: 'user-dealer-admin-2',
      dealerId: 'dealer-2',
      name: 'Kamran Siddiqui',
      email: 'kamran@karachiteleecom.pk',
      passwordHash: demoPasswordHash,
      role: 'DEALER_ADMIN',
      phone: '0321-9988771',
      active: true,
      lastLoginAt: '2026-08-16T19:00:00.000Z',
      createdAt: '2026-01-15T11:30:00.000Z',
    },
    {
      id: 'user-customer-1',
      // Scopes this login to the "Muhammad Ali" customer record (cust-1) so the
      // self-service portal can only ever show that customer's own data.
      dealerId: 'dealer-1',
      customerId: 'cust-1',
      name: 'Muhammad Ali (Customer)',
      email: 'ali.customer@gmail.com',
      passwordHash: demoPasswordHash,
      role: 'CUSTOMER',
      phone: '0301-8765432',
      active: true,
      lastLoginAt: '2026-08-15T10:00:00.000Z',
      createdAt: '2026-03-01T10:00:00.000Z',
    },
  ];

  // 3. Customers (20 customers with realistic Pakistani context)
  const customerSeeds = [
    { name: 'Muhammad Ali', phone: '0301-8765432', cnic: '35202-*******-1', city: 'Lahore', address: 'House 14B, Street 3, Model Town, Lahore', eName: 'Asad Ali (Brother)', ePhone: '0302-1234567' },
    { name: 'Zubair Ahmed', phone: '0322-4455667', cnic: '35201-*******-3', city: 'Lahore', address: 'Plot 88, Block D, DHA Phase 5, Lahore', eName: 'Ahmed Bilal (Father)', ePhone: '0321-5566778' },
    { name: 'Rashid Khan', phone: '0333-9876543', cnic: '37405-*******-5', city: 'Rawalpindi', address: 'Flat 4, Gulshan Dadan, Murree Road, Rawalpindi', eName: 'Imran Khan (Cousin)', ePhone: '0334-1122334' },
    { name: 'Fahad Mustafa', phone: '0312-3344556', cnic: '42101-*******-7', city: 'Karachi', address: 'House 55, Block 13-D, Gulshan-e-Iqbal, Karachi', eName: 'Mustafa Kamal (Father)', ePhone: '0315-9988776' },
    { name: 'Bilal Javed', phone: '0300-5544331', cnic: '35200-*******-9', city: 'Lahore', address: 'Street 9, Cavalry Ground, Lahore Cantt', eName: 'Shahid Javed (Brother)', ePhone: '0306-6655443' },
    { name: 'Kashif Mehmood', phone: '0345-1239874', cnic: '61101-*******-1', city: 'Islamabad', address: 'House 220, Street 45, Sector G-9/1, Islamabad', eName: 'Mehmood Ul Hassan (Father)', ePhone: '0346-7788990' },
    { name: 'Noman Yousaf', phone: '0321-8765012', cnic: '35202-*******-3', city: 'Lahore', address: 'House 10, Main Bazaar, Ichhra, Lahore', eName: 'Yousaf Raza (Father)', ePhone: '0324-4433221' },
    { name: 'Waseem Akram', phone: '0307-9911223', cnic: '35404-*******-5', city: 'Sheikhupura', address: 'Civil Lines Road, Near Stadium, Sheikhupura', eName: 'Akram Baig (Uncle)', ePhone: '0308-3322110' },
    { name: 'Salman Tariq', phone: '0311-6677889', cnic: '42201-*******-7', city: 'Karachi', address: 'Apartment 304, Clifton Heights, Block 2, Karachi', eName: 'Tariq Aziz (Father)', ePhone: '0313-5544112' },
    { name: 'Shahzaib Hassan', phone: '0331-4455112', cnic: '37406-*******-9', city: 'Islamabad', address: 'House 19, Street 12, Sector F-10/2, Islamabad', eName: 'Hassan Raza (Brother)', ePhone: '0335-9900112' },
    { name: 'Adeel Murtaza', phone: '0303-7788112', cnic: '35201-*******-2', city: 'Lahore', address: 'House 4, Sector B, Bahria Town, Lahore', eName: 'Murtaza Hashmi (Father)', ePhone: '0300-1199884' },
    { name: 'Shoaib Akhtar', phone: '0323-8899223', cnic: '37401-*******-4', city: 'Rawalpindi', address: 'House 112, Satellite Town, Commercial Market, Rawalpindi', eName: 'Asif Akhtar (Brother)', ePhone: '0321-4433119' },
    { name: 'Haris Rauf', phone: '0342-9900334', cnic: '61101-*******-6', city: 'Islamabad', address: 'Plot 77, Street 18, Sector I-8/4, Islamabad', eName: 'Rauf Ahmed (Father)', ePhone: '0340-2233445' },
    { name: 'Irfan Ullah', phone: '0315-7766221', cnic: '17301-*******-8', city: 'Peshawar', address: 'House 45, Hayatabad Phase 3, Peshawar', eName: 'Inam Ullah (Brother)', ePhone: '0314-8877119' },
    { name: 'Babar Azam', phone: '0305-1122338', cnic: '35202-*******-0', city: 'Lahore', address: 'House 89, Shadman 1, Jail Road, Lahore', eName: 'Azam Siddiq (Father)', ePhone: '0308-7766551' },
    { name: 'Saad Farooq', phone: '0324-6655110', cnic: '42301-*******-2', city: 'Karachi', address: 'House 12, PECHS Block 6, Karachi', eName: 'Farooq Qureshi (Father)', ePhone: '0322-1144778' },
    { name: 'Danish Ali', phone: '0336-7788443', cnic: '35201-*******-4', city: 'Lahore', address: 'Flat 12, Gulberg Green Towers, Lahore', eName: 'Ali Asghar (Father)', ePhone: '0332-9988112' },
    { name: 'Hamid Raza', phone: '0348-1122998', cnic: '37405-*******-6', city: 'Rawalpindi', address: 'House 6, Lane 4, Peshawar Road, Rawalpindi', eName: 'Raza Ali (Brother)', ePhone: '0341-3344556' },
    { name: 'Omer Farooq', phone: '0316-5544229', cnic: '42101-*******-8', city: 'Karachi', address: 'B-14, North Nazimabad, Block L, Karachi', eName: 'Farooq Ahmed (Father)', ePhone: '0317-6655441' },
    { name: 'Waqas Malik', phone: '0302-9988334', cnic: '35200-*******-2', city: 'Lahore', address: 'House 28, Allama Iqbal Town, Lahore', eName: 'Malik Nasir (Uncle)', ePhone: '0309-8877441' },
  ];

  const customers: Customer[] = customerSeeds.map((c, idx) => ({
    id: `cust-${idx + 1}`,
    dealerId: idx < 12 ? 'dealer-1' : idx < 16 ? 'dealer-2' : 'dealer-3',
    name: c.name,
    phone: c.phone,
    cnic: c.cnic,
    address: c.address,
    emergencyContactName: c.eName,
    emergencyContactPhone: c.ePhone,
    notes: 'Verified CNIC copy on file with dealer record.',
    active: true,
    createdAt: new Date(now.getTime() - (30 - idx) * 86400000).toISOString(),
  }));

  // 4. Devices (25 devices with detailed phone models)
  const deviceConfigs = [
    { brand: 'Samsung', model: 'Galaxy A15', ramStorage: '6GB / 128GB', price: 54000, status: 'ACTIVE', battery: 78, online: true, os: 'Android 14', color: 'Blue Black' },
    { brand: 'Samsung', model: 'Galaxy A25 5G', ramStorage: '8GB / 256GB', price: 79000, status: 'OVERDUE', battery: 64, online: true, os: 'Android 14', color: 'Light Blue', lockReason: 'Installment #3 overdue by 4 days' },
    { brand: 'Infinix', model: 'Note 30 Pro', ramStorage: '8GB / 256GB', price: 62000, status: 'LOCKED', battery: 42, online: true, os: 'Android 13 (XOS 13)', color: 'Magic Black', lockReason: 'Payment overdue Rs. 7,500 since 10 Aug 2026', lockMsg: 'DEVICE RESTRICTED: Your installment is overdue. Contact Al-Madina Mobiles.' },
    { brand: 'Tecno', model: 'Camon 30', ramStorage: '8GB / 256GB', price: 58000, status: 'ACTIVE', battery: 92, online: true, os: 'Android 14 (HiOS 14)', color: 'Iceland Silver' },
    { brand: 'Xiaomi', model: 'Redmi Note 13', ramStorage: '8GB / 256GB', price: 54999, status: 'ACTIVE', battery: 85, online: true, os: 'Android 14 (HyperOS)', color: 'Midnight Black' },
    { brand: 'Vivo', model: 'Y27 5G', ramStorage: '6GB / 128GB', price: 49999, status: 'PENDING', battery: 100, online: false, os: 'Android 13 (Funtouch 13)', color: 'Burgundy Black' },
    { brand: 'Oppo', model: 'A78', ramStorage: '8GB / 256GB', price: 66000, status: 'ACTIVE', battery: 55, online: true, os: 'Android 13 (ColorOS 13.1)', color: 'Aqua Green' },
    { brand: 'Samsung', model: 'Galaxy A05s', ramStorage: '4GB / 128GB', price: 41000, status: 'ACTIVE', battery: 33, online: true, os: 'Android 14', color: 'Silver' },
    { brand: 'Infinix', model: 'Hot 40i', ramStorage: '8GB / 128GB', price: 38000, status: 'OVERDUE', battery: 71, online: true, os: 'Android 13 (XOS 13)', color: 'Starlit Black', lockReason: 'Installment #2 overdue 5 days' },
    { brand: 'Tecno', model: 'Spark 20 Pro', ramStorage: '8GB / 256GB', price: 48500, status: 'LOCKED', battery: 19, online: true, os: 'Android 13', color: 'Frosty Ivory', lockReason: 'Installment overdue Rs. 6,200', lockMsg: 'DEVICE RESTRICTED: Please clear pending dues immediately.' },
    { brand: 'Xiaomi', model: 'Poco M6 Pro', ramStorage: '8GB / 256GB', price: 68000, status: 'ENROLLED', battery: 95, online: true, os: 'Android 14 (HyperOS)', color: 'Black' },
    { brand: 'Vivo', model: 'V30e 5G', ramStorage: '8GB / 256GB', price: 89999, status: 'ACTIVE', battery: 67, online: true, os: 'Android 14', color: 'Coco Brown' },
    { brand: 'Samsung', model: 'Galaxy A35 5G', ramStorage: '8GB / 256GB', price: 112000, status: 'ACTIVE', battery: 80, online: true, os: 'Android 14', color: 'Awesome Navy' },
    { brand: 'Infinix', model: 'GT 20 Pro 5G', ramStorage: '12GB / 256GB', price: 74999, status: 'ACTIVE', battery: 49, online: true, os: 'Android 14', color: 'Mecha Blue' },
    { brand: 'Tecno', model: 'Pova 6 Pro 5G', ramStorage: '12GB / 256GB', price: 69999, status: 'INACTIVE', battery: 0, online: false, os: 'Android 14', color: 'Comet Green' },
    { brand: 'Xiaomi', model: 'Redmi 13C', ramStorage: '6GB / 128GB', price: 33500, status: 'ACTIVE', battery: 88, online: true, os: 'Android 13', color: 'Navy Blue' },
    { brand: 'Oppo', model: 'Reno 11F 5G', ramStorage: '8GB / 256GB', price: 82000, status: 'ACTIVE', battery: 73, online: true, os: 'Android 14', color: 'Palm Green' },
    { brand: 'Vivo', model: 'Y17s', ramStorage: '6GB / 128GB', price: 39999, status: 'ACTIVE', battery: 60, online: true, os: 'Android 13', color: 'Glitter Purple' },
    { brand: 'Samsung', model: 'Galaxy A55 5G', ramStorage: '8GB / 256GB', price: 135000, status: 'ACTIVE', battery: 90, online: true, os: 'Android 14', color: 'Awesome Iceblue' },
    { brand: 'Infinix', model: 'Zero 30 5G', ramStorage: '12GB / 256GB', price: 92000, status: 'OVERDUE', battery: 45, online: true, os: 'Android 13', color: 'Rome Green', lockReason: 'Installment #4 unpaid' },
    { brand: 'Tecno', model: 'Spark 20', ramStorage: '8GB / 128GB', price: 36000, status: 'ACTIVE', battery: 82, online: true, os: 'Android 13', color: 'Gravity Black' },
    { brand: 'Xiaomi', model: 'Redmi Note 12', ramStorage: '8GB / 128GB', price: 47000, status: 'LOCKED', battery: 38, online: true, os: 'Android 13', color: 'Onyx Gray', lockReason: 'Overdue installment Rs. 5,500', lockMsg: 'DEVICE RESTRICTED: Please clear installment at Al-Madina Mobiles.' },
    { brand: 'Oppo', model: 'A58', ramStorage: '6GB / 128GB', price: 46000, status: 'ACTIVE', battery: 77, online: true, os: 'Android 13', color: 'Glowing Black' },
    { brand: 'Vivo', model: 'Y02t', ramStorage: '4GB / 64GB', price: 27999, status: 'ACTIVE', battery: 91, online: true, os: 'Android 13 Go', color: 'Cosmic Grey' },
    { brand: 'Samsung', model: 'Galaxy A14', ramStorage: '4GB / 128GB', price: 45000, status: 'ACTIVE', battery: 68, online: true, os: 'Android 13', color: 'Black' },
  ];

  const devices: Device[] = deviceConfigs.map((cfg, idx) => {
    const custIdx = idx % customers.length;
    const imeiBase = 359871080000000 + idx * 137 + 1234;
    const serial = `SN${cfg.brand.substring(0, 3).toUpperCase()}${20260000 + idx}`;
    const cust = customers[custIdx];

    return {
      id: `dev-${idx + 1}`,
      dealerId: cust.dealerId,
      customerId: cust.id,
      brand: cfg.brand,
      model: cfg.model,
      imei: String(imeiBase),
      serialNumber: serial,
      color: cfg.color,
      ramStorage: cfg.ramStorage,
      purchasePrice: cfg.price,
      status: cfg.status as any,
      lastSeen: cfg.online ? new Date(now.getTime() - (idx % 15) * 60000).toISOString() : new Date(now.getTime() - 86400000 * 2).toISOString(),
      batteryLevel: cfg.battery,
      isOnline: cfg.online,
      osVersion: cfg.os,
      securityPatch: '2026-06-01',
      lockReason: cfg.lockReason,
      lockMessage: cfg.lockMsg,
      locationLat: 31.5204 + (idx * 0.005),
      locationLng: 74.3587 + (idx * 0.004),
      simCarrier: idx % 3 === 0 ? 'Jazz 4G' : idx % 3 === 1 ? 'Zong 4G' : 'Telenor 4G',
      wifiSsid: 'Home_WiFi_5G',
      createdAt: new Date(now.getTime() - (60 - idx) * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - idx * 3600000).toISOString(),
    };
  });

  // 5. Installment Plans & Installments
  const installmentPlans: InstallmentPlan[] = [];
  const installments: Installment[] = [];
  const payments: Payment[] = [];
  const transactions: Transaction[] = [];

  devices.forEach((dev, idx) => {
    const totalMonths = 6;
    const downPayment = Math.round(dev.purchasePrice * 0.25);
    const financed = dev.purchasePrice - downPayment;
    const monthly = Math.round(financed / totalMonths);
    const planId = `plan-${idx + 1}`;

    // Determine paid installments based on device status
    let paidCount = 2;
    let planStatus: any = 'CURRENT';
    if (dev.status === 'LOCKED' || dev.status === 'OVERDUE') {
      paidCount = 1;
      planStatus = 'OVERDUE';
    } else if (dev.status === 'PENDING') {
      paidCount = 0;
      planStatus = 'CURRENT';
    }

    const plan: InstallmentPlan = {
      id: planId,
      dealerId: dev.dealerId,
      customerId: dev.customerId,
      deviceId: dev.id,
      totalAmount: dev.purchasePrice,
      downPayment: downPayment,
      financedAmount: financed,
      monthlyInstallment: monthly,
      totalInstallments: totalMonths,
      paidInstallments: paidCount,
      remainingBalance: dev.purchasePrice - downPayment - (paidCount * monthly),
      firstDueDate: '2026-05-20',
      gracePeriodDays: 3,
      status: planStatus,
      createdAt: dev.createdAt,
    };
    installmentPlans.push(plan);

    // Initial Down Payment transaction
    const downPayId = `pay-dp-${idx + 1}`;
    payments.push({
      id: downPayId,
      dealerId: dev.dealerId,
      customerId: dev.customerId,
      planId: plan.id,
      amount: downPayment,
      paymentMethod: 'CASH',
      referenceNumber: `REC-DP-${2026000 + idx}`,
      notes: 'Initial Down Payment at counter',
      status: 'VERIFIED',
      verifiedBy: 'user-dealer-admin-1',
      verifiedAt: dev.createdAt,
      createdAt: dev.createdAt,
    });
    transactions.push({
      id: `tx-dp-${idx + 1}`,
      dealerId: dev.dealerId,
      customerId: dev.customerId,
      paymentId: downPayId,
      type: 'DOWN_PAYMENT',
      amount: downPayment,
      status: 'COMPLETED',
      date: dev.createdAt,
      notes: `Down payment for ${dev.brand} ${dev.model}`,
    });

    // Create 6 monthly installments
    for (let m = 1; m <= totalMonths; m++) {
      const instId = `inst-${idx + 1}-${m}`;
      const dueDate = new Date('2026-04-20T00:00:00Z');
      dueDate.setMonth(dueDate.getMonth() + m);
      const graceDate = new Date(dueDate);
      graceDate.setDate(graceDate.getDate() + 3);

      let instStatus: any = 'PENDING';
      let paidAt: string | undefined = undefined;
      let amountPaid = 0;

      if (m <= paidCount) {
        instStatus = 'PAID';
        paidAt = new Date(dueDate.getTime() - 86400000 * 2).toISOString();
        amountPaid = monthly;

        // Record payment for paid installments
        const payId = `pay-${idx + 1}-${m}`;
        const payMethods: any[] = ['JAZZCASH', 'EASYPAISA', 'CASH', 'BANK_TRANSFER'];
        const chosenMethod = payMethods[(idx + m) % payMethods.length];

        payments.push({
          id: payId,
          dealerId: dev.dealerId,
          customerId: dev.customerId,
          installmentId: instId,
          planId: plan.id,
          amount: monthly,
          paymentMethod: chosenMethod,
          referenceNumber: `${chosenMethod.substring(0, 3)}-${990000 + idx * 10 + m}`,
          notes: `Installment #${m} of 6`,
          status: 'VERIFIED',
          verifiedBy: 'user-dealer-admin-1',
          verifiedAt: paidAt,
          createdAt: paidAt,
        });

        transactions.push({
          id: `tx-${idx + 1}-${m}`,
          dealerId: dev.dealerId,
          customerId: dev.customerId,
          paymentId: payId,
          type: 'MONTHLY_INSTALLMENT',
          amount: monthly,
          status: 'COMPLETED',
          date: paidAt,
          notes: `Installment #${m} received via ${chosenMethod}`,
        });
      } else if (m === paidCount + 1) {
        if (dev.status === 'OVERDUE' || dev.status === 'LOCKED') {
          instStatus = 'OVERDUE';
        } else {
          instStatus = 'DUE_SOON';
        }
      }

      installments.push({
        id: instId,
        planId: plan.id,
        dealerId: dev.dealerId,
        customerId: dev.customerId,
        installmentNumber: m,
        amountDue: monthly,
        amountPaid: amountPaid,
        dueDate: dueDate.toISOString().split('T')[0],
        graceDate: graceDate.toISOString().split('T')[0],
        status: instStatus,
        paidAt: paidAt,
        createdAt: dev.createdAt,
      });
    }
  });

  // 6. License Keys
  const licenseKeys: LicenseKey[] = [
    {
      id: 'lic-1',
      dealerId: 'dealer-1',
      licenseKey: 'EMIS-PRO-8892-4410-LHR',
      plan: 'PROFESSIONAL',
      deviceLimit: 100,
      usedDevices: 12,
      expiryDate: '2027-01-10',
      status: 'ACTIVE',
      createdAt: '2026-01-10T10:00:00.000Z',
    },
    {
      id: 'lic-2',
      dealerId: 'dealer-2',
      licenseKey: 'EMIS-BIZ-1029-7744-KHI',
      plan: 'BUSINESS',
      deviceLimit: 500,
      usedDevices: 4,
      expiryDate: '2027-01-15',
      status: 'ACTIVE',
      createdAt: '2026-01-15T11:30:00.000Z',
    },
    {
      id: 'lic-3',
      dealerId: 'dealer-3',
      licenseKey: 'EMIS-STR-3341-9902-RWP',
      plan: 'STARTER',
      deviceLimit: 25,
      usedDevices: 9,
      expiryDate: '2027-02-01',
      status: 'ACTIVE',
      createdAt: '2026-02-01T09:15:00.000Z',
    },
    {
      id: 'lic-4',
      dealerId: 'dealer-4',
      licenseKey: 'EMIS-PRO-5541-1122-ISB',
      plan: 'PROFESSIONAL',
      deviceLimit: 100,
      usedDevices: 0,
      expiryDate: '2027-02-20',
      status: 'ACTIVE',
      createdAt: '2026-02-20T14:00:00.000Z',
    },
    {
      id: 'lic-5',
      dealerId: 'dealer-5',
      licenseKey: 'EMIS-ENT-7788-3344-PEW',
      plan: 'ENTERPRISE',
      deviceLimit: 2000,
      usedDevices: 0,
      expiryDate: '2027-03-05',
      status: 'ACTIVE',
      createdAt: '2026-03-05T08:45:00.000Z',
    },
  ];

  // 7. Device Policies
  const devicePolicies: DevicePolicy[] = dealers.map((d) => ({
    id: `pol-${d.id}`,
    dealerId: d.id,
    gracePeriodDays: 3,
    autoLockEnabled: false,
    autoUnlockEnabled: true,
    lockWarningDays: 2,
    customerReminderEnabled: true,
    emergencyCallsAllowed: true,
    paymentMethodsOnLock: ['CASH', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'RAAST'],
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
  }));

  // 8. Device Action Logs
  const deviceActionLogs: DeviceActionLog[] = [
    {
      id: 'dlog-1',
      deviceId: 'dev-3',
      dealerId: 'dealer-1',
      userId: 'user-dealer-admin-1',
      userName: 'Tariq Mehmood',
      action: 'LOCK',
      oldStatus: 'OVERDUE',
      newStatus: 'LOCKED',
      reason: 'Payment overdue Rs. 7,500 since 10 Aug 2026',
      commandPayload: JSON.stringify({ mode: 'RESTRICTED_LOCK', emergencyCall: true }),
      deviceAck: true,
      ipAddress: '182.185.142.10',
      createdAt: '2026-08-14T10:44:00.000Z',
    },
    {
      id: 'dlog-2',
      deviceId: 'dev-10',
      dealerId: 'dealer-1',
      userId: 'user-dealer-admin-1',
      userName: 'Tariq Mehmood',
      action: 'LOCK',
      oldStatus: 'OVERDUE',
      newStatus: 'LOCKED',
      reason: 'Installment overdue Rs. 6,200',
      commandPayload: JSON.stringify({ mode: 'RESTRICTED_LOCK', emergencyCall: true }),
      deviceAck: true,
      ipAddress: '182.185.142.10',
      createdAt: '2026-08-15T09:12:00.000Z',
    },
    {
      id: 'dlog-3',
      deviceId: 'dev-22',
      dealerId: 'dealer-1',
      userId: 'user-dealer-admin-1',
      userName: 'Tariq Mehmood',
      action: 'LOCK',
      oldStatus: 'OVERDUE',
      newStatus: 'LOCKED',
      reason: 'Overdue installment Rs. 5,500',
      commandPayload: JSON.stringify({ mode: 'RESTRICTED_LOCK', emergencyCall: true }),
      deviceAck: true,
      ipAddress: '182.185.142.10',
      createdAt: '2026-08-16T14:30:00.000Z',
    },
  ];

  // 9. System Audit Logs
  const auditLogs: AuditLog[] = [
    {
      id: 'alog-1',
      dealerId: 'dealer-1',
      userId: 'user-dealer-admin-1',
      actorName: 'Tariq Mehmood',
      actorRole: 'DEALER_ADMIN',
      action: 'DEVICE_LOCK_REQUESTED',
      targetType: 'DEVICE',
      targetId: 'dev-3',
      details: 'Admin manually triggered remote restricted lock for Infinix Note 30 Pro due to overdue payment.',
      ipAddress: '182.185.142.10',
      createdAt: '2026-08-14T10:44:00.000Z',
    },
    {
      id: 'alog-2',
      dealerId: 'dealer-1',
      userId: 'user-dealer-admin-1',
      actorName: 'Tariq Mehmood',
      actorRole: 'DEALER_ADMIN',
      action: 'PAYMENT_VERIFIED',
      targetType: 'PAYMENT',
      targetId: 'pay-1-2',
      details: 'Recorded and verified JazzCash payment Rs. 6,750 for Muhammad Ali.',
      ipAddress: '182.185.142.10',
      createdAt: '2026-08-15T11:00:00.000Z',
    },
    {
      id: 'alog-3',
      dealerId: 'dealer-1',
      userId: 'user-dealer-admin-1',
      actorName: 'Tariq Mehmood',
      actorRole: 'DEALER_ADMIN',
      action: 'CUSTOMER_CREATED',
      targetType: 'CUSTOMER',
      targetId: 'cust-1',
      details: 'Registered new customer Muhammad Ali with CNIC 35202-*******-1.',
      ipAddress: '182.185.142.10',
      createdAt: '2026-07-20T10:15:00.000Z',
    },
  ];

  // 10. Notifications & Templates
  const notifications: Notification[] = [
    {
      id: 'notif-1',
      dealerId: 'dealer-1',
      customerId: 'cust-2',
      deviceId: 'dev-2',
      type: 'PAYMENT_OVERDUE',
      channel: 'SMS',
      title: 'Installment Overdue Alert',
      message: 'Dear Zubair Ahmed, your installment of Rs. 9,875 for Samsung Galaxy A25 is overdue. Please pay to avoid phone restriction.',
      status: 'DELIVERED',
      sentAt: '2026-08-15T08:00:00.000Z',
      createdAt: '2026-08-15T08:00:00.000Z',
    },
    {
      id: 'notif-2',
      dealerId: 'dealer-1',
      customerId: 'cust-3',
      deviceId: 'dev-3',
      type: 'DEVICE_LOCKED',
      channel: 'PUSH',
      title: 'Device Lock Notice',
      message: 'Your Infinix Note 30 Pro has been locked due to overdue installment. Clear your balance to instantly restore device.',
      status: 'DELIVERED',
      sentAt: '2026-08-14T10:45:00.000Z',
      createdAt: '2026-08-14T10:45:00.000Z',
    },
    {
      id: 'notif-3',
      dealerId: 'dealer-1',
      customerId: 'cust-1',
      deviceId: 'dev-1',
      type: 'PAYMENT_DUE',
      channel: 'SMS',
      title: 'Upcoming Installment Reminder',
      message: 'Dear Muhammad Ali, your installment of Rs. 6,750 is due on 20 Aug 2026. Pay via JazzCash/Easypaisa or visit Al-Madina Mobiles.',
      status: 'SENT',
      sentAt: '2026-08-16T09:00:00.000Z',
      createdAt: '2026-08-16T09:00:00.000Z',
    },
  ];

  const notificationTemplates: NotificationTemplate[] = [
    {
      id: 'tmpl-1',
      name: 'Due Date Reminder (3 Days Before)',
      triggerEvent: 'INSTALLMENT_DUE_SOON',
      channel: 'SMS',
      subjectTemplate: 'Upcoming Installment Reminder',
      bodyTemplate: 'Dear {{customer_name}}, your installment of Rs. {{amount}} for {{device_model}} is due on {{due_date}}. Pay on time to keep services active.',
    },
    {
      id: 'tmpl-2',
      name: 'Overdue Notice',
      triggerEvent: 'INSTALLMENT_OVERDUE',
      channel: 'SMS',
      subjectTemplate: 'Installment Overdue Notice',
      bodyTemplate: 'Dear {{customer_name}}, your installment of Rs. {{amount}} is now overdue. Please clear dues immediately to avoid automatic device restrictions.',
    },
    {
      id: 'tmpl-3',
      name: 'Device Lock Alert',
      triggerEvent: 'DEVICE_LOCKED',
      channel: 'PUSH',
      subjectTemplate: 'Device Restricted',
      bodyTemplate: 'Your device {{device_model}} has been locked per agreement. Please submit payment of Rs. {{amount}} to unlock.',
    },
    {
      id: 'tmpl-4',
      name: 'Payment Received & Unlocked',
      triggerEvent: 'PAYMENT_VERIFIED',
      channel: 'SMS',
      subjectTemplate: 'Payment Received',
      bodyTemplate: 'Thank you {{customer_name}}! Payment of Rs. {{amount}} received (Ref: {{ref_no}}). Device status is ACTIVE.',
    },
  ];

  // 11. Sample Enrollment Tokens
  const enrollmentTokens: EnrollmentToken[] = [
    {
      id: 'tok-1',
      dealerId: 'dealer-1',
      deviceId: 'dev-6',
      customerId: 'cust-6',
      token: 'EMIS-TOKEN-9941-LHR-2026',
      qrType: 'STANDARD',
      status: 'WAITING',
      expiresAt: new Date(now.getTime() + 86400000 * 2).toISOString(),
      createdAt: now.toISOString(),
    },
  ];

  return {
    dealers,
    users,
    customers,
    devices,
    enrollmentTokens,
    installmentPlans,
    installments,
    payments,
    transactions,
    deviceActionLogs,
    auditLogs,
    licenseKeys,
    devicePolicies,
    notifications,
    notificationTemplates,
  };
}
