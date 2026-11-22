import { describe, it, expect } from 'vitest';

import { dpcUpdateOffer } from '../../src/services/DpcUpdate.js';

const SHA = 'df5e2ad268f3ad7035d3394f857ab3336bdc1d48b5487463d00da2f18ec0df11';
const URL = 'https://app.almassdm.pro/downloads/almas-sdm-dpc-1.8.1.apk';

describe('dpcUpdateOffer', () => {
  it('announces a fully configured update', () => {
    expect(dpcUpdateOffer({ apkUrl: URL, updateVersionCode: 15, updateSha256: SHA })).toEqual({
      versionCode: 15,
      url: URL,
      sha256: SHA,
    });
  });

  it('announces nothing when any part is missing or malformed', () => {
    expect(dpcUpdateOffer({ apkUrl: URL, updateVersionCode: 0, updateSha256: SHA })).toBeNull();
    expect(dpcUpdateOffer({ apkUrl: URL, updateVersionCode: 15, updateSha256: '' })).toBeNull();
    expect(dpcUpdateOffer({ apkUrl: URL, updateVersionCode: 15, updateSha256: 'xyz' })).toBeNull();
    expect(dpcUpdateOffer({ apkUrl: '', updateVersionCode: 15, updateSha256: SHA })).toBeNull();
    expect(dpcUpdateOffer({ apkUrl: 'http://insecure.example/a.apk', updateVersionCode: 15, updateSha256: SHA })).toBeNull();
  });
});
