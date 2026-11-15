import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { startTestServer, TestHarness } from './test_server.js';
import { SUPPORT_EMAIL } from '../server/config.js';

const ROOT_DIR = path.resolve(process.cwd());

async function collectFiles(dir: string, exts: string[]): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      results.push(...(await collectFiles(full, exts)));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

describe('Items 3 & 4: Remove Admin Outline Toggle, Cleanup Footer, & Centralize Support Email', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('removes "Show admin-managed areas", data-admin, body.adm, "Transparent Manual Payments", and legacy support email from src & active HTML', async () => {
    const srcFiles = await collectFiles(path.join(ROOT_DIR, 'src'), ['.ts', '.tsx', '.css', '.html']);
    const staticHtmlFiles = [
      path.join(ROOT_DIR, 'public/assets/aistudio/Buyoll_header__1__159624e8.html'),
      path.join(ROOT_DIR, 'public/assets/aistudio/Buyoll_Footer_60796a07.html'),
    ];
    const filesToScan = [...srcFiles, ...staticHtmlFiles];

    for (const filePath of filesToScan) {
      const content = await fs.readFile(filePath, 'utf-8');
      assert.ok(
        !/Show admin-managed areas/i.test(content),
        `Found "Show admin-managed areas" in ${filePath}`
      );
      assert.ok(!/data-admin\b/.test(content), `Found data-admin in ${filePath}`);
      assert.ok(!/body\.adm\b/.test(content), `Found body.adm in ${filePath}`);
      assert.ok(
        !/Transparent Manual Payments/i.test(content),
        `Found "Transparent Manual Payments" in ${filePath}`
      );
      assert.ok(
        !/cityandcountyre@gmail\.com/i.test(content),
        `Found legacy email in ${filePath}`
      );
    }

    // Verify centralized SUPPORT_EMAIL is used in Footer and support config
    const footerContent = await fs.readFile(path.join(ROOT_DIR, 'src/components/Footer.tsx'), 'utf-8');
    assert.ok(footerContent.includes('SUPPORT_EMAIL'), 'Footer should import SUPPORT_EMAIL');
    const supportConfig = await fs.readFile(path.join(ROOT_DIR, 'src/config/support.ts'), 'utf-8');
    assert.ok(supportConfig.includes('buyoll@customerservive.com'), 'Support config must define buyoll@customerservive.com');
  });

  it('serves admin auth session and API responses without legacy support email', async () => {
    assert.equal(SUPPORT_EMAIL, 'buyoll@customerservive.com');

    const { accessToken } = await harness.loginAdmin();
    const meRes = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.role, 'admin');
    assert.equal(meJson.user.email, harness.adminCredentials.email);

    const cardsRes = await fetch(`${harness.baseUrl}/api/announcement-cards`);
    assert.equal(cardsRes.status, 200);
    const cardsJson = await cardsRes.json();
    assert.ok(!JSON.stringify(cardsJson).includes('cityandcountyre@gmail.com'), 'Announcement cards should not expose legacy email');

    const annRes = await fetch(`${harness.baseUrl}/api/announcements`);
    assert.equal(annRes.status, 200);
    const annJson = await annRes.json();
    assert.ok(!JSON.stringify(annJson).includes('cityandcountyre@gmail.com'), 'Announcements should not expose legacy email');
  });
});
