#!/usr/bin/env node
/**
 * Put the demo database into the states the guide video has to show.
 *
 * The seed fixture covers a working shop — active plans, locked handsets,
 * payments — but not the one screen the IMEI chapter is built on: a handset
 * that reports a different IMEI on its heartbeat, the alert that raises, and
 * the automatic lock that follows. That cannot be faked in the fixture without
 * lying about how it comes about, so this drives the real endpoints instead:
 * enrol a handset honestly, then let it check in with the wrong IMEI.
 *
 *   node scripts/video/demo-state.mjs
 *
 * Demo data only. Never point this at a server holding real customers.
 */
const API = process.env.API_URL || 'http://localhost:5000/api';
const EMAIL = process.env.DEMO_EMAIL || 'tariq@almadinamobiles.pk';
const PASSWORD = process.env.DEMO_PASSWORD || 'ChangeMe#2026';

/** A serial that is obviously a demo value. */
const SERIAL = 'SN-DEMO-IMEI-01';
/** The IMEI the "replaced" handset reports — not the registered one. */
const WRONG_IMEI = '356938035643809';

const json = async (res, what) => {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what}: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
};

const post = (path, body, headers = {}) =>
  fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const get = (path, headers = {}) => fetch(API + path, { headers });

const main = async () => {
  const session = await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }), 'login');
  const auth = { authorization: `Bearer ${session.token}` };
  console.log(`signed in as ${session.user?.name ?? EMAIL}`);

  const list = await json(await get('/devices?limit=100', auth), 'devices');
  const devices = list.data ?? list.devices ?? list.items ?? [];
  const target = devices.find((d) => d.status === 'ENROLLED') ?? devices.find((d) => d.status === 'PENDING');
  if (!target) throw new Error('No ENROLLED or PENDING device in the fixture to use.');
  console.log(`using ${target.brand} ${target.model} (${target.id}), registered IMEI ${target.imei}`);

  const token = await json(
    await post('/enrollment/generate', { deviceId: target.id, expiresInMinutes: 60 }, auth),
    'generate enrolment token',
  );
  const enrolToken = token.token?.token ?? token.token ?? token.enrollmentToken;

  // Enrol honestly: the IMEI the shop registered. A mismatch here would be
  // refused outright — that is layer one, and it has its own shot in the video.
  const enrolled = await json(
    await post('/dpc/enroll', {
      token: enrolToken,
      // The enrolment code is bound to this device record; the server checks it.
      deviceId: target.id,
      dpcVersion: '1.5.2',
      imeis: [target.imei],
      serialNumber: SERIAL,
      isDeviceOwner: true,
    }),
    'enrol',
  );
  console.log(`enrolled, device token issued for ${enrolled.deviceId}`);

  const deviceAuth = { authorization: `Device ${enrolled.deviceId}.${enrolled.deviceToken}` };

  // One honest check-in first, so the timeline shows a normal heartbeat before
  // the bad one — the dashboard story reads better, and it is what really
  // happens.
  await json(
    await post('/dpc/check-in', {
      batteryLevel: 86,
      imeis: [target.imei],
      serialNumber: SERIAL,
      isDeviceOwner: true,
    }, deviceAuth),
    'first check-in',
  );
  console.log('check-in 1: registered IMEI, no alert');

  const after = await json(
    await post('/dpc/check-in', {
      batteryLevel: 84,
      imeis: [WRONG_IMEI],
      serialNumber: SERIAL,
      isDeviceOwner: true,
    }, deviceAuth),
    'mismatched check-in',
  );
  console.log(`check-in 2: IMEI ${WRONG_IMEI} — device now ${after.status}, command ${after.command?.type ?? 'none'}`);

  const fresh = await json(await get(`/devices/${target.id}`, auth), 'device after mismatch');
  const device = fresh.data ?? fresh.device ?? fresh;
  console.log(`dashboard shows: status ${device.status}, flags ${JSON.stringify(device.tamperFlags ?? [])}`);
  console.log('\nScreens to capture now:');
  console.log(`  /devices/${target.id}   — the tamper alert and the queued lock`);
  console.log('  /notifications          — the alert as the owner sees it');
};

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
