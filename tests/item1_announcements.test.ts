import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { startTestServer, TestHarness } from './test_server.js';
import { PUBLIC_DIR } from '../server/config.js';

describe('Item 1: Admin-Only Announcements, Notices & Promotional Banners', () => {
  let harness: TestHarness;
  let adminToken = '';
  let merchantToken = '';
  let memberToken = '';
  const uploadedFiles: string[] = [];

  before(async () => {
    harness = await startTestServer();
    adminToken = (await harness.loginAdmin()).accessToken;
    merchantToken = await harness.issueToken(2, 'merchant');
    memberToken = await harness.issueToken(3, 'member');
  });

  after(async () => {
    for (const rel of uploadedFiles) {
      await fs.rm(path.join(PUBLIC_DIR, rel.replace(/^\/+/, '')), { force: true }).catch(() => {});
    }
    await harness.close();
  });

  it('rejects non-admin users from admin announcement CRUD and image uploads with 401/403', async () => {
    // Unauthenticated
    const unauth = await fetch(`${harness.baseUrl}/api/admin/announcements`);
    assert.equal(unauth.status, 401);

    // Member (id: 3)
    const memberCreate = await fetch(`${harness.baseUrl}/api/admin/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ title: 'Hack', body: 'Member post attempt' }),
    });
    assert.equal(memberCreate.status, 403);
    const errBody = await memberCreate.json();
    assert.equal(errBody.error.code, 'FORBIDDEN');

    // Merchant (id: 2)
    const merchantUpload = await fetch(`${harness.baseUrl}/api/admin/uploads/announcement-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${merchantToken}` },
      body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
    });
    assert.equal(merchantUpload.status, 403);
  });

  it('rejects invalid image magic bytes and accepts valid PNG upload, then publishes, pulls down, schedules, filters audience, dismisses, and soft-archives', async () => {
    // Invalid fake PNG (bad magic bytes)
    const badUpload = await fetch(`${harness.baseUrl}/api/admin/uploads/announcement-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${Buffer.from('not-a-real-png-at-all').toString('base64')}`,
      }),
    });
    assert.equal(badUpload.status, 400);

    // Valid minimal PNG header + bytes
    const validPngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const form = new FormData();
    form.append('image', new Blob([validPngBytes], { type: 'image/png' }), 'promo.png');
    const goodUpload = await fetch(`${harness.baseUrl}/api/admin/uploads/announcement-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    assert.equal(goodUpload.status, 201);
    const uploadJson = await goodUpload.json();
    assert.match(uploadJson.url, /^\/uploads\/announcements\/ann_.*\.png$/);
    uploadedFiles.push(uploadJson.url);

    // Create promotional announcement as admin
    const createRes = await fetch(`${harness.baseUrl}/api/admin/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'Mega Festive Sale',
        body: 'Save up to 30% on Solar Kits.',
        type: 'PROMOTION',
        audience: 'MEMBERS',
        pinned: true,
        imageUrl: uploadJson.url,
        ctaLabel: 'Explore',
        ctaUrl: '/groups',
        publishNow: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const { announcement: promo } = await createRes.json();
    assert.equal(promo.status, 'PUBLISHED');
    assert.equal(promo.imageUrl, uploadJson.url);

    // Create expired notice (endsAt in past) -> should be hidden automatically on public feed
    const expiredRes = await fetch(`${harness.baseUrl}/api/admin/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'Old Expired Notice',
        body: 'Should not appear',
        type: 'NOTICE',
        audience: 'ALL',
        endsAt: Date.now() - 60000,
        publishNow: true,
      }),
    });
    assert.equal(expiredRes.status, 201);

    // Public/Member sees promo (and NOT expired notice), Merchant does NOT see MEMBERS-only promo
    const memberFeed = await fetch(`${harness.baseUrl}/api/announcements`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    }).then((r) => r.json());
    assert.ok(memberFeed.announcements.some((a: any) => a.id === promo.id));
    assert.ok(!memberFeed.announcements.some((a: any) => a.title === 'Old Expired Notice'));

    const merchantFeed = await fetch(`${harness.baseUrl}/api/announcements`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    }).then((r) => r.json());
    assert.ok(!merchantFeed.announcements.some((a: any) => a.id === promo.id));

    // Member dismisses promo -> hidden on subsequent fetch
    const dismissRes = await fetch(`${harness.baseUrl}/api/announcements/${promo.id}/dismiss`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(dismissRes.status, 200);

    const memberFeedAfterDismiss = await fetch(`${harness.baseUrl}/api/announcements`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    }).then((r) => r.json());
    assert.ok(!memberFeedAfterDismiss.announcements.some((a: any) => a.id === promo.id));

    // Pull down / unpublish -> hidden even for public visitors
    const pullDown = await fetch(`${harness.baseUrl}/api/admin/announcements/${promo.id}/unpublish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(pullDown.status, 200);
    const publicFeedAfterPullDown = await fetch(`${harness.baseUrl}/api/announcements`).then((r) => r.json());
    assert.ok(!publicFeedAfterPullDown.announcements.some((a: any) => a.id === promo.id));

    // Re-publish, edit & check revision, then soft-archive
    await fetch(`${harness.baseUrl}/api/admin/announcements/${promo.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await fetch(`${harness.baseUrl}/api/admin/announcements/${promo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: 'Updated Festive Sale', audience: 'ALL' }),
    });
    const revisions = await fetch(`${harness.baseUrl}/api/admin/announcements/${promo.id}/revisions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    assert.equal(revisions.revisions.length, 1);

    const archiveRes = await fetch(`${harness.baseUrl}/api/admin/announcements/${promo.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(archiveRes.status, 200);
    const archivedData = await archiveRes.json();
    assert.equal(archivedData.announcement.status, 'ARCHIVED');

    // Public feed must not include archived announcement
    const publicFeedAfterArchive = await fetch(`${harness.baseUrl}/api/announcements`).then((r) => r.json());
    assert.ok(!publicFeedAfterArchive.announcements.some((a: any) => a.id === promo.id));
  });
});
