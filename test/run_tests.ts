import { spawnSync } from 'child_process';
import path from 'path';

console.log('🚀 fetchrss-clone Test Süreci Başlatılıyor...\n');

const tsxBin = path.join(__dirname, '../node_modules/.bin/tsx');

console.log('--- 1. Temel Birim ve SSRF / Playwright Testleri ---');
const test1 = spawnSync(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), path.join(__dirname, 'test_all.ts')], {
  stdio: 'inherit',
});

if (test1.status !== 0) {
  console.error('❌ Test 1 Başarısız!');
  process.exit(test1.status || 1);
}

console.log('\n--- 2. REST API ve Entegrasyon Testleri ---');
const test2 = spawnSync(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), path.join(__dirname, 'test_api.ts')], {
  stdio: 'inherit',
});

if (test2.status !== 0) {
  console.error('❌ Test 2 Başarısız!');
  process.exit(test2.status || 1);
}

console.log('\n🌟 TÜM TESTLER BAŞARIYLA TAMAMLANDI!');
process.exit(0);
