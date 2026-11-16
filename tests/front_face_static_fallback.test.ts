import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, resolveImageUrl } from '../src/api.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockHtmlResponse(status = 200): typeof fetch {
  return (async () =>
    new Response('<!doctype html><html><body>SPA Shell</body></html>', {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })) as typeof fetch;
}

function mockJsonErrorResponse(status: number, code: string, message: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('Static deployment fallback for public front-face sections', () => {
  it('resolves local, logo, upload, and external image URLs cleanly', () => {
    assert.equal(resolveImageUrl('./images/solar_power.jpg'), '/images/solar_power.jpg');
    assert.equal(resolveImageUrl('./buyoll_logo.png'), '/buyoll_logo.png');
    assert.equal(
      resolveImageUrl('assets/aistudio/Buyoll_Shopping_Cart_Logo_23c2cc30.png'),
      '/assets/aistudio/Buyoll_Shopping_Cart_Logo_23c2cc30.png'
    );
    assert.equal(resolveImageUrl('uploads/banner.png'), '/uploads/banner.png');
    assert.equal(resolveImageUrl('https://cdn.example.com/item.jpg'), 'https://cdn.example.com/item.jpg');
  });

  it('populates Featured Deals, Newly Posted items, Live Product Announcements, and Admin Announcements when Vercel returns HTML shell (200 text/html)', async () => {
    globalThis.fetch = mockHtmlResponse(200);

    const { products } = await api.getProducts();
    assert.ok(products.length >= 7, 'Expected seeded fallback products');
    const featured = products.filter((p) => p.isFeatured);
    assert.ok(featured.length >= 6, 'Expected Featured Deals to be populated');

    const oneWeekMs = 7 * 86400000;
    const now = Date.now();
    const recent = products.filter((p) => now - (p.createdAt || 0) <= oneWeekMs + 60000);
    assert.ok(recent.length >= 6, 'Expected Newly Posted Announcements within 7 days');

    const liveItems = products.filter((p) => p.live);
    assert.ok(liveItems.length >= 6, 'Expected Live Product Announcements');

    const { groups } = await api.getGroups();
    assert.ok(groups.length >= 1, 'Expected fallback chama groups');

    const { cards } = await api.getHeroAnnouncementCards();
    assert.equal(cards.length, 3, 'Expected 3 published hero announcement cards');
    assert.ok(cards.every((c) => c.status === 'published' && c.isPublished === true));

    const { announcements } = await api.getAnnouncements();
    assert.ok(announcements.length >= 2, 'Expected published announcements and notices');
    assert.ok(announcements.every((a) => a.status === 'PUBLISHED'));
  });

  it('populates public detail, search, merchant, and subscription tiers when GitHub Pages returns 404 HTML', async () => {
    globalThis.fetch = mockHtmlResponse(404);

    const detail = await api.getProduct(1);
    assert.equal(detail.product.id, 1);
    assert.ok(Array.isArray(detail.groups));

    const searchRes = await api.searchProducts('Solar');
    assert.ok(searchRes.products.length >= 1);

    const merchantRes = await api.getMerchant(2);
    assert.equal(merchantRes.merchant.id, 2);

    const tiersRes = await api.getSubscriptionTiers();
    assert.ok(tiersRes.tiers.length >= 4);
  });

  it('also falls back cleanly on network TypeError while offline', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const { products } = await api.getProducts();
    const { cards } = await api.getHeroAnnouncementCards();
    assert.ok(products.length > 0);
    assert.equal(cards.length, 3);
  });

  it('never swallows real backend JSON errors', async () => {
    globalThis.fetch = mockJsonErrorResponse(404, 'NOT_FOUND', 'Product does not exist');
    await assert.rejects(() => api.getProduct(999999), (err: any) => {
      assert.equal(err.status, 404);
      assert.equal(err.message, 'Product does not exist');
      return true;
    });

    globalThis.fetch = mockJsonErrorResponse(403, 'FORBIDDEN', 'Access denied');
    await assert.rejects(() => api.getMerchant(2), (err: any) => {
      assert.equal(err.status, 403);
      return true;
    });
  });
});
