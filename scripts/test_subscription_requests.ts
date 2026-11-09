async function runTests() {
  console.log('--- STARTING SUBSCRIPTION REQUESTS AUTOMATED TESTS ---');
  const baseUrl = 'http://localhost:3000/api';

  // 1. Register a fresh merchant via API
  const rand = Math.floor(100000 + Math.random() * 900000);
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Test Merchant ${rand}`,
      email: `merchant_${rand}@buyoll.test`,
      password: 'password123',
      phone: `07${rand}12`,
      role: 'merchant',
      shopName: `Auto Store ${rand}`,
    }),
  });

  const regData = await regRes.json();
  if (!regRes.ok || !regData.user) {
    throw new Error(`Failed to register merchant: ${JSON.stringify(regData)}`);
  }
  const merchant = regData.user;
  console.log(`Registered fresh merchant ID #${merchant.id} (${merchant.name})`);

  const merchantAuthHeader = {
    'Content-Type': 'application/json',
    'x-user-id': String(merchant.id),
  };

  const adminAuthHeader = {
    'Content-Type': 'application/json',
    'x-user-id': '1',
    'x-admin-key': process.env.ADMIN_SETUP_KEY || 'buyoll-admin-secret-dev',
  };

  // Test 1: Invalid code format (8 chars) -> 422
  console.log('\n[Test 1] Submitting invalid code format (8 characters)...');
  const res1 = await fetch(`${baseUrl}/subscriptions/requests`, {
    method: 'POST',
    headers: merchantAuthHeader,
    body: JSON.stringify({
      planId: 'pro',
      paymentMethod: 'mpesa',
      mpesaCode: 'SHORT88',
    }),
  });
  console.log('Status:', res1.status);
  const data1 = await res1.json();
  console.log('Response:', data1);
  if (res1.status !== 422) throw new Error(`Expected 422, got ${res1.status}`);

  // Test 2: Valid submission with 10-char uppercase code -> 201
  const testCode1 = `QG${rand}AB`; // Exactly 2 + 6 + 2 = 10 characters
  console.log(`\n[Test 2] Submitting valid code ${testCode1} for Pro Merchant...`);
  const res2 = await fetch(`${baseUrl}/subscriptions/requests`, {
    method: 'POST',
    headers: merchantAuthHeader,
    body: JSON.stringify({
      planId: 'pro',
      paymentMethod: 'mpesa',
      mpesaCode: testCode1.toLowerCase(), // testing auto-uppercase
    }),
  });
  console.log('Status:', res2.status);
  const data2 = await res2.json();
  console.log('Response:', data2);
  if (res2.status !== 201) throw new Error(`Expected 201, got ${res2.status}`);
  if (data2.request.mpesaCode !== testCode1) throw new Error('Code was not auto-uppercased!');
  if (data2.request.amountExpected !== 1500) throw new Error('Amount expected should be 1500 for Pro plan');
  const requestId = data2.request.id;

  // Test 3: Duplicate code -> 409
  console.log(`\n[Test 3] Submitting same code ${testCode1} again...`);
  const res3 = await fetch(`${baseUrl}/subscriptions/requests`, {
    method: 'POST',
    headers: merchantAuthHeader,
    body: JSON.stringify({
      planId: 'growing',
      paymentMethod: 'mpesa',
      mpesaCode: testCode1,
    }),
  });
  console.log('Status:', res3.status);
  const data3 = await res3.json();
  console.log('Response:', data3);
  if (res3.status !== 409) throw new Error(`Expected 409 Conflict, got ${res3.status}`);

  // Test 4: Merchant status me endpoint
  console.log('\n[Test 4] GET /subscriptions/requests/me...');
  const res4 = await fetch(`${baseUrl}/subscriptions/requests/me`, {
    headers: merchantAuthHeader,
  });
  console.log('Status:', res4.status);
  const data4 = await res4.json();
  console.log('Me response:', data4);
  if (!data4.hasPendingRequest) throw new Error('Should show hasPendingRequest = true');

  // Test 5: Admin rejection without reason -> 400
  console.log('\n[Test 5] Admin rejecting without reason...');
  const res5 = await fetch(`${baseUrl}/admin/subscriptions/requests/${requestId}/reject`, {
    method: 'POST',
    headers: adminAuthHeader,
    body: JSON.stringify({ reason: '' }),
  });
  console.log('Status:', res5.status);
  if (res5.status !== 400) throw new Error(`Expected 400, got ${res5.status}`);

  // Test 6: Admin rejection with reason -> 200
  console.log('\n[Test 6] Admin rejecting with valid reason...');
  const res6 = await fetch(`${baseUrl}/admin/subscriptions/requests/${requestId}/reject`, {
    method: 'POST',
    headers: adminAuthHeader,
    body: JSON.stringify({ reason: 'Code was not found in M-Pesa till statement.' }),
  });
  console.log('Status:', res6.status);
  const data6 = await res6.json();
  console.log('Reject response:', data6);
  if (res6.status !== 200) throw new Error(`Expected 200, got ${res6.status}`);

  // Test 7: New submission with different code -> 201
  const testCode2 = `XT${rand + 1}CD`; // Exactly 2 + 6 + 2 = 10 characters
  console.log(`\n[Test 7] Submitting new valid code ${testCode2}...`);
  const res7 = await fetch(`${baseUrl}/subscriptions/requests`, {
    method: 'POST',
    headers: merchantAuthHeader,
    body: JSON.stringify({
      planId: 'growing',
      paymentMethod: 'mpesa',
      mpesaCode: testCode2,
    }),
  });
  console.log('Status:', res7.status);
  const data7 = await res7.json();
  if (res7.status !== 201) throw new Error(`Expected 201, got ${res7.status}`);
  const requestId2 = data7.request.id;

  // Test 8: Admin approval -> 200, 30-day window
  console.log(`\n[Test 8] Admin approving request ${requestId2}...`);
  const res8 = await fetch(`${baseUrl}/admin/subscriptions/requests/${requestId2}/approve`, {
    method: 'POST',
    headers: adminAuthHeader,
  });
  console.log('Status:', res8.status);
  const data8 = await res8.json();
  console.log('Approve response:', data8);
  if (res8.status !== 200) throw new Error(`Expected 200, got ${res8.status}`);

  const activeUntil = new Date(data8.subscription.activeUntil).getTime();
  const days = Math.round((activeUntil - Date.now()) / (1000 * 60 * 60 * 24));
  console.log(`Active window days: ${days}`);
  if (days < 29 || days > 31) throw new Error(`Expected ~30 days, got ${days}`);

  // Test 9: Idempotent double approval -> 200
  console.log('\n[Test 9] Admin approving again (idempotency check)...');
  const res9 = await fetch(`${baseUrl}/admin/subscriptions/requests/${requestId2}/approve`, {
    method: 'POST',
    headers: adminAuthHeader,
  });
  console.log('Status:', res9.status);
  if (res9.status !== 200) throw new Error(`Expected 200, got ${res9.status}`);

  // Test 10: Submitting while active cycle exists -> 409
  console.log('\n[Test 10] Submitting while active subscription cycle is running...');
  const res10 = await fetch(`${baseUrl}/subscriptions/requests`, {
    method: 'POST',
    headers: merchantAuthHeader,
    body: JSON.stringify({
      planId: 'commercial',
      paymentMethod: 'mpesa',
      mpesaCode: 'NEWMPE1234',
    }),
  });
  console.log('Status:', res10.status);
  const data10 = await res10.json();
  console.log('Response:', data10);
  if (res10.status !== 409) throw new Error(`Expected 409 Conflict, got ${res10.status}`);

  console.log('\n=============================================');
  console.log('ALL 10 VERIFICATION TESTS PASSED PERFECTLY! 🎉');
  console.log('=============================================\n');
}

runTests().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
