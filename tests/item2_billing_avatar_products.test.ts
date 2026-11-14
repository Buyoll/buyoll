import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { startTestServer, TestHarness } from './test_server.js';
import { PUBLIC_DIR } from '../server/config.js';
import { getDatabase, saveDatabase } from '../server/db.js';

describe('Item 2: Yearly Billing, Avatars, Profile Sync, Draft Isolation & Group Products', () => {
  let harness: TestHarness;
  const uploadedFiles: string[] = [];

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    for (const rel of uploadedFiles) {
      await fs.rm(path.join(PUBLIC_DIR, rel.replace(/^\/+/, '')), { force: true }).catch(() => {});
    }
    await harness.close();
  });

  it('computes yearly discount pricing on subscription tiers, lets admin update tiers, and handles merchant interval switch & cancel', async () => {
    // 1. Public tiers endpoint includes yearlyFee & yearlyDiscountPercent
    const tiersRes = await fetch(`${harness.baseUrl}/api/subscription-tiers`);
    assert.equal(tiersRes.status, 200);
    const tiersBody = await tiersRes.json();
    assert.ok(Array.isArray(tiersBody.tiers) && tiersBody.tiers.length === 6);
    const tier500 = tiersBody.tiers.find((t: any) => t.id === 'tier_500');
    assert.equal(tier500.monthlyFee, 500);
    assert.equal(tier500.yearlyFee, 5000);
    assert.equal(tier500.yearlyDiscountPercent, 17);

    // 2. Non-admin cannot override tier pricing
    const forbiddenOverride = await fetch(`${harness.baseUrl}/api/admin/subscription-tiers/tier_500`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '2' },
      body: JSON.stringify({ yearlyDiscountPercent: 25 }),
    });
    assert.equal(forbiddenOverride.status, 403);

    // 3. Admin overrides yearly discount percent -> recomputes yearlyFee dynamically
    const adminOverride = await fetch(`${harness.baseUrl}/api/admin/subscription-tiers/tier_500`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '1' },
      body: JSON.stringify({ monthlyFee: 500, yearlyDiscountPercent: 25 }),
    });
    assert.equal(adminOverride.status, 200);
    const overrideJson = await adminOverride.json();
    const updated500 = overrideJson.tiers.find((t: any) => t.id === 'tier_500');
    assert.equal(updated500.yearlyFee, 4500); // 500 * 12 * 0.75 = 4500
    assert.equal(updated500.yearlyDiscountPercent, 25);

    // Reset tier_500 back to default and ensure merchant 2 has enough wallet balance for yearly sub test
    const db = await getDatabase();
    const merchant = db.users.find((u) => u.id === 2)!;
    merchant.credit = 20000;
    if (!merchant.roleWallets) merchant.roleWallets = {};
    merchant.roleWallets.merchant = { credit: 20000, coins: 1000, points: 0 };
    merchant.merchantSubscriptionStatus = 'inactive';
    merchant.merchantSubscriptionExpiresAt = undefined;
    db.merchantSubscriptions = [];
    await saveDatabase(db);

    // 4. Merchant subscribes yearly using wallet
    const createSubRes = await fetch(`${harness.baseUrl}/api/merchant/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '2' },
      body: JSON.stringify({ tierId: 'tier_500', billingPeriod: 'yearly', paymentMethod: 'wallet' }),
    });
    assert.equal(createSubRes.status, 201);
    const createSubJson = await createSubRes.json();
    assert.equal(createSubJson.subscription.billingPeriod, 'yearly');
    assert.equal(createSubJson.subscription.billingInterval, 'YEARLY');
    assert.equal(createSubJson.subscription.amount, 4500);
    assert.equal(createSubJson.subscription.autoRenew, true);

    // 5. Switch interval from YEARLY -> MONTHLY for next renewal
    const switchRes = await fetch(`${harness.baseUrl}/api/merchant/subscription/change-interval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '2' },
      body: JSON.stringify({ billingPeriod: 'monthly' }),
    });
    assert.equal(switchRes.status, 200);
    const switchJson = await switchRes.json();
    assert.equal(switchJson.billingInterval, 'MONTHLY');
    assert.equal(switchJson.nextRenewalRate, 500);

    // 6. Cancel auto-renew preserves currentPeriodEnd / active access
    const cancelRes = await fetch(`${harness.baseUrl}/api/merchant/subscription/cancel`, {
      method: 'POST',
      headers: { 'x-user-id': '2' },
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.equal(cancelJson.autoRenew, false);
    assert.ok(cancelJson.activeUntil > Date.now());
  });

  it('validates, uploads, and deletes user avatars and supports PATCH /api/users/me', async () => {
    // Unauthenticated rejected
    const unauth = await fetch(`${harness.baseUrl}/api/users/me/avatar`, { method: 'POST' });
    assert.equal(unauth.status, 401);

    // Invalid fake image rejected
    const badAvatar = await fetch(`${harness.baseUrl}/api/users/me/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '3' },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${Buffer.from('fake-image-payload').toString('base64')}`,
      }),
    });
    assert.equal(badAvatar.status, 400);
    const badJson = await badAvatar.json();
    assert.equal(badJson.error.code, 'INVALID_IMAGE');

    // Valid PNG multipart upload
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const form = new FormData();
    form.append('avatar', new Blob([validPng], { type: 'image/png' }), 'user3.png');
    const uploadRes = await fetch(`${harness.baseUrl}/api/users/me/avatar`, {
      method: 'POST',
      headers: { 'x-user-id': '3' },
      body: form,
    });
    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.match(uploadJson.avatarUrl, /^\/uploads\/avatars\/avatar_3_.*\.png$/);
    assert.equal(uploadJson.user.avatarUrl, uploadJson.avatarUrl);
    assert.ok(uploadJson.user.avatarUpdatedAt);
    uploadedFiles.push(uploadJson.avatarUrl);

    // PATCH /api/users/me validates email uniqueness and updates name
    const dupEmailRes = await fetch(`${harness.baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '3' },
      body: JSON.stringify({ email: 'direct@buyoll.com' }),
    });
    assert.equal(dupEmailRes.status, 409);

    const patchRes = await fetch(`${harness.baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '3' },
      body: JSON.stringify({ name: 'Samuel Updated' }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.user.name, 'Samuel Updated');
    assert.equal(patchJson.user.avatarUrl, uploadJson.avatarUrl);

    // DELETE /api/users/me/avatar clears avatarUrl
    const delRes = await fetch(`${harness.baseUrl}/api/users/me/avatar`, {
      method: 'DELETE',
      headers: { 'x-user-id': '3' },
    });
    assert.equal(delRes.status, 200);
    const delJson = await delRes.json();
    assert.equal(delJson.user.avatarUrl, undefined);
  });

  it('enforces draft isolation on GET /api/products and group-scoped RBAC on /api/groups/:groupId/products', async () => {
    // Ensure merchant 2 has an active subscription regardless of earlier subtest ordering
    const db = await getDatabase();
    const merchant = db.users.find((u) => u.id === 2)!;
    merchant.merchantSubscriptionStatus = 'active';
    merchant.merchantSubscriptionPlan = 'tier_500';
    merchant.merchantSubscriptionExpiresAt = Date.now() + 30 * 86400000;
    await saveDatabase(db);

    // Merchant 2 creates a draft product
    const createProdRes = await fetch(`${harness.baseUrl}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '2' },
      body: JSON.stringify({
        title: 'Secret Prototype Solar Kit',
        description: 'Unpublished draft product for testing draft visibility',
        category: 'Energy',
        price: 12000,
        stockQuantity: 5,
      }),
    });
    assert.equal(createProdRes.status, 201);
    const { product: draftProduct } = await createProdRes.json();
    assert.equal(draftProduct.publicationStatus, 'draft');

    // Anonymous caller requesting includeDrafts=true NEVER sees the draft
    const anonRes = await fetch(`${harness.baseUrl}/api/products?includeDrafts=true`);
    assert.equal(anonRes.status, 200);
    const anonJson = await anonRes.json();
    assert.equal(anonJson.products.some((p: any) => p.id === draftProduct.id), false);

    // Member (id: 3) requesting status=draft&vendorId=2 NEVER sees the draft
    const memberRes = await fetch(`${harness.baseUrl}/api/products?status=draft&vendorId=2`, {
      headers: { 'x-user-id': '3' },
    });
    assert.equal(memberRes.status, 200);
    const memberJson = await memberRes.json();
    assert.equal(memberJson.products.some((p: any) => p.id === draftProduct.id), false);

    // Owning Merchant (id: 2) requesting includeDrafts=true DOES see their draft
    const ownerRes = await fetch(`${harness.baseUrl}/api/products?includeDrafts=true&merchantId=2`, {
      headers: { 'x-user-id': '2' },
    });
    assert.equal(ownerRes.status, 200);
    const ownerJson = await ownerRes.json();
    assert.equal(ownerJson.products.some((p: any) => p.id === draftProduct.id), true);

    // Group products management: non-manager member (id: 4) gets 403
    const forbidAdd = await fetch(`${harness.baseUrl}/api/groups/101/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '4' },
      body: JSON.stringify({ productId: draftProduct.id }),
    });
    assert.equal(forbidAdd.status, 403);

    // Group moderator (id: 3, adminId of group 101) can add, feature/reorder, and remove secondary product
    const addRes = await fetch(`${harness.baseUrl}/api/groups/101/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '3' },
      body: JSON.stringify({ productId: draftProduct.id, featured: false }),
    });
    assert.equal(addRes.status, 201);

    const patchRes = await fetch(`${harness.baseUrl}/api/groups/101/products/${draftProduct.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': '3' },
      body: JSON.stringify({ featured: true, order: 1 }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.entry.featured, true);

    // Cannot remove primary product #1 when active member payments exist
    const delPrimaryRes = await fetch(`${harness.baseUrl}/api/groups/101/products/1`, {
      method: 'DELETE',
      headers: { 'x-user-id': '3' },
    });
    assert.equal(delPrimaryRes.status, 409);

    // Can remove secondary product cleanly
    const delSecondaryRes = await fetch(`${harness.baseUrl}/api/groups/101/products/${draftProduct.id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': '3' },
    });
    assert.equal(delSecondaryRes.status, 200);
  });
});
