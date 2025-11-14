# Bug Analysis Report: Bidirectional Tipping Implementation

**Analysis Date:** November 14, 2025  
**Analyzed Files:**
- `client/src/components/lightning/LightningTipDialog.tsx`
- `client/src/components/MessageBubble.tsx`
- `client/src/components/SettingsModal.tsx`
- `client/src/lib/lightning.ts`
- `client/src/lib/accountMetadata.ts`

---

## 1. CRITICAL BUGS (Breaks Functionality)

### 🔴 BUG-001: WebLN HBD Notification Missing Transaction URL
**File:** `LightningTipDialog.tsx`  
**Line:** 165  
**Severity:** CRITICAL

**Issue:**
```typescript
// WebLN HBD notification (Line 165)
const notificationMessage = `Tip Received: ${totalHBDCost.toFixed(3)} HBD\n\nSent via Lightning by @${user.username}`;
```

The WebLN HBD notification format does NOT include a transaction URL, but the parser in `MessageBubble.tsx` REQUIRES it:

```typescript
// MessageBubble.tsx Line 39-52
if (content.startsWith('Tip Received:')) {
  const hbdMatch = content.match(/Tip Received:\s*([0-9.]+)\s*HBD/);
  const txMatch = content.match(/https:\/\/hiveblocks\.com\/tx\/([a-fA-F0-9]+)/);
  
  if (hbdMatch && txMatch) {  // ❌ Both required
    return { amount: hbdMatch[1], currency: 'hbd', txId: txMatch[1] };
  }
}
return null;  // ❌ Returns null if no txMatch
```

**Impact:**
- WebLN HBD tip notifications will NOT render as tip cards
- They will display as plain text messages
- Users won't get the special Lightning tip UI for WebLN payments

**Root Cause:**
V4V.app handles the HBD transfer asynchronously, so we don't have the Hive transaction ID at the time of sending the notification.

**Fix Required:**
Either:
1. Change notification format to exclude transaction link for WebLN payments
2. Update parser to make txMatch optional for HBD tips
3. Poll/wait for V4V.app transaction to complete before sending notification

---

### 🔴 BUG-002: User Can Remove Lightning Address While Preference is 'lightning'
**File:** `SettingsModal.tsx`  
**Line:** 552-562  
**Severity:** CRITICAL

**Issue:**
Users can click "Remove" button on Lightning Address without any validation of their current tip receive preference:

```typescript
// Line 552-562
<Button
  onClick={async () => {
    await removeAddress();  // ❌ No validation of tip_receive_preference
    setLightningInput('');
  }}
  disabled={isUpdatingLightning || !currentAddress}
>
  Remove
</Button>
```

Meanwhile, `accountMetadata.ts` validates SETTING preference='lightning':

```typescript
// accountMetadata.ts Line 592-594
if (preference === 'lightning' && !existingMessengerData.lightning_address) {
  throw new Error('Cannot set preference to Lightning without a Lightning Address.');
}
```

**Impact:**
- User ends up in invalid state: `tip_receive_preference='lightning'` but no `lightning_address`
- Tippers will try to generate Lightning invoices but fail (no address available)
- User cannot receive tips in either format

**Fix Required:**
Add validation in `updateLightningAddress()` to prevent removal if `tip_receive_preference === 'lightning'`:

```typescript
// Before removing, check current preference
const metadata = await getAccountMetadata(username, true);
if (metadata.profile?.hive_messenger?.tip_receive_preference === 'lightning' && !lightningAddress) {
  throw new Error('Cannot remove Lightning Address while preference is set to Lightning. Change preference to HBD first.');
}
```

---

### 🔴 BUG-003: Exchange Rate Fallback is Never Used
**File:** `lightning.ts`  
**Line:** 587-598  
**Severity:** CRITICAL

**Issue:**
The code logs a fallback rate but then throws an error, making the fallback unreachable:

```typescript
// Line 587-598
} catch (error) {
  console.error('[LIGHTNING] Failed to fetch BTC/HBD rate:', error);
  
  // Fallback: Use approximate market rate as of last known value
  const fallbackRate = 100000; // ~$100k BTC
  console.warn('[LIGHTNING] Using fallback rate:', fallbackRate);  // ❌ Logged
  
  throw new Error(  // ❌ Then immediately throws, fallback never returned
    'Failed to fetch current Bitcoin price. Please check your connection and try again.'
  );
}
```

**Impact:**
- Tip dialog becomes completely unusable if CoinGecko API is down
- Users cannot generate invoices at all
- False impression that fallback exists

**Fix Required:**
Either:
1. Actually USE the fallback rate:
```typescript
console.warn('[LIGHTNING] Using fallback rate:', fallbackRate);
return fallbackRate;
```

2. Or REMOVE the fallback code entirely:
```typescript
} catch (error) {
  console.error('[LIGHTNING] Failed to fetch BTC/HBD rate:', error);
  throw new Error('Failed to fetch current Bitcoin price. Please check your connection and try again.');
}
```

---

## 2. EDGE CASE BUGS

### 🟡 BUG-004: Tip Preference Change Not Reflected While Dialog is Open
**File:** `LightningTipDialog.tsx`  
**Line:** 66-83  
**Severity:** MEDIUM

**Issue:**
The `activeTab` state is only synced with `recipientTipPreference` when dialog closes:

```typescript
// Line 66-83
useEffect(() => {
  if (!isOpen) {  // ❌ Only updates when dialog CLOSES
    setActiveTab(recipientTipPreference === 'hbd' ? 'wallet' : 'v4v');
  }
}, [isOpen, recipientTipPreference]);
```

**Scenario:**
1. User A opens tip dialog for User B (preference: 'lightning')
2. User B changes preference to 'hbd' in another tab
3. User A is still on 'v4v' tab with stale data

**Impact:**
- UI shows wrong tab for current preference
- User might send wrong type of tip
- Confusion about recipient's preference

**Fix Required:**
```typescript
useEffect(() => {
  if (!isOpen) {
    // Reset on close
    setActiveTab(recipientTipPreference === 'hbd' ? 'wallet' : 'v4v');
  } else {
    // Also sync when preference changes while open
    setActiveTab(recipientTipPreference === 'hbd' ? 'wallet' : 'v4v');
  }
}, [isOpen, recipientTipPreference]);
```

---

### 🟡 BUG-005: No Validation of Lightning Address Format When Setting Preference
**File:** `accountMetadata.ts`  
**Line:** 591-594  
**Severity:** MEDIUM

**Issue:**
When setting `tip_receive_preference='lightning'`, code checks if `lightning_address` EXISTS but not if it's VALID:

```typescript
// Line 591-594
if (preference === 'lightning' && !existingMessengerData.lightning_address) {
  throw new Error('Cannot set preference to Lightning without a Lightning Address.');
}
```

**Scenario:**
1. User manually corrupts their metadata with invalid lightning_address: `"invalid@@format"`
2. User can still set preference='lightning' (address exists)
3. Tippers cannot generate invoices (address is invalid)

**Impact:**
- User appears to accept Lightning tips but actually cannot receive them
- Tippers get cryptic LNURL errors

**Fix Required:**
```typescript
if (preference === 'lightning') {
  if (!existingMessengerData.lightning_address) {
    throw new Error('Cannot set preference to Lightning without a Lightning Address.');
  }
  if (!isValidLightningAddress(existingMessengerData.lightning_address)) {
    throw new Error('Cannot set preference to Lightning with invalid Lightning Address format.');
  }
}
```

---

### 🟡 BUG-006: Invoice Expiry Not Shown to User
**File:** `LightningTipDialog.tsx`  
**Lines:** 546-717  
**Severity:** MEDIUM

**Issue:**
Invoices expire after 15 minutes (Lightning) or 10 minutes (V4V reverse bridge), but:
- No countdown timer displayed
- No expiry warning
- No auto-refresh on expiry

**Impact:**
- User generates invoice, waits too long deciding, invoice expires
- User clicks "Send Tip" → gets error "Invoice has expired"
- Poor UX, user has to regenerate manually

**Fix Required:**
Add expiry countdown:
```typescript
// Calculate expiry time
const expiryTime = decoded.timestamp + decoded.expiry;
const now = Math.floor(Date.now() / 1000);
const remainingSeconds = expiryTime - now;

// Display countdown
<p className="text-caption text-yellow-600">
  Invoice expires in: {formatTime(remainingSeconds)}
</p>

// Auto-regenerate on expiry
useEffect(() => {
  if (remainingSeconds <= 0) {
    toast({ title: 'Invoice Expired', description: 'Please generate a new invoice' });
    setLightningInvoiceData(null);
  }
}, [remainingSeconds]);
```

---

### 🟡 BUG-007: No Pre-flight HBD Balance Check
**File:** `LightningTipDialog.tsx`  
**Line:** 393-467  
**Severity:** MEDIUM

**Issue:**
`handleSendTip()` does not check user's HBD balance before requesting Keychain transfer:

```typescript
// Line 393-467
const handleSendTip = async () => {
  // ❌ No balance check
  
  const txId = await sendV4VTransfer(
    user.username,
    lightningInvoiceData.invoice,
    totalHBDCost,
    invoiceAmountSats
  );
}
```

**Impact:**
- User clicks "Send Tip", Keychain popup appears
- User approves, then gets "Insufficient funds" error from blockchain
- Poor UX - should validate BEFORE Keychain popup

**Fix Required:**
```typescript
// Fetch user's HBD balance
const client = new Client(['https://api.hive.blog']);
const accounts = await client.database.getAccounts([user.username]);
const hbdBalance = parseFloat(accounts[0].hbd_balance.split(' ')[0]);

if (hbdBalance < totalHBDCost) {
  throw new Error(`Insufficient HBD balance. You have ${hbdBalance.toFixed(3)} HBD but need ${totalHBDCost.toFixed(3)} HBD.`);
}
```

---

### 🟡 BUG-008: V4V.app API Errors Not User-Friendly
**File:** `lightning.ts`  
**Line:** 697-701  
**Severity:** MEDIUM

**Issue:**
V4V.app API errors show raw HTTP status codes:

```typescript
// Line 697-701
if (!response.ok) {
  const errorText = await response.text();
  console.error('[V4V REVERSE BRIDGE] API error:', response.status, errorText);
  throw new Error(`V4V.app API error: ${response.status} ${response.statusText}`);
}
```

**Impact:**
- User sees: "V4V.app API error: 503 Service Unavailable"
- Not user-friendly, doesn't explain what to do

**Fix Required:**
```typescript
if (!response.ok) {
  const errorText = await response.text();
  console.error('[V4V REVERSE BRIDGE] API error:', response.status, errorText);
  
  // User-friendly error messages
  if (response.status >= 500) {
    throw new Error('V4V.app service is temporarily unavailable. Please try again in a few minutes.');
  } else if (response.status === 429) {
    throw new Error('Rate limit exceeded. Please wait a moment and try again.');
  } else if (response.status === 400) {
    throw new Error('Invalid request. Please check the amount and try again.');
  } else {
    throw new Error(`Unable to generate invoice (${response.status}). Please try again.`);
  }
}
```

---

## 3. MEMORY LEAKS

### 🟠 BUG-009: QR Code Promise Not Cleaned Up
**File:** `LightningTipDialog.tsx`  
**Line:** 86-101  
**Severity:** LOW

**Issue:**
QR code generation is async but has no cleanup:

```typescript
// Line 86-101
useEffect(() => {
  if (lightningInvoiceData?.invoice) {
    QRCode.toDataURL(lightningInvoiceData.invoice, {
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 2,
    })
      .then(setQrDataUrl)  // ❌ No cleanup
      .catch(err => {
        console.error('[LIGHTNING TIP] Failed to generate QR code:', err);
        setQrDataUrl(null);
      });
  }
}, [lightningInvoiceData]);
```

**Scenario:**
1. Invoice changes rapidly or component unmounts
2. Promise completes after unmount
3. `setQrDataUrl` called on unmounted component

**Impact:**
- React warning: "Can't perform state update on unmounted component"
- Potential memory leak

**Fix Required:**
```typescript
useEffect(() => {
  let cancelled = false;
  
  if (lightningInvoiceData?.invoice) {
    QRCode.toDataURL(lightningInvoiceData.invoice, {
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 2,
    })
      .then(url => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[LIGHTNING TIP] Failed to generate QR code:', err);
          setQrDataUrl(null);
        }
      });
  } else {
    setQrDataUrl(null);
  }
  
  return () => { cancelled = true; };
}, [lightningInvoiceData]);
```

---

### 🟠 BUG-010: setTimeout Not Cleaned Up
**File:** `LightningTipDialog.tsx`  
**Line:** 117-118  
**Severity:** LOW

**Issue:**
```typescript
// Line 117-118
setIsCopied(true);
setTimeout(() => setIsCopied(false), 2000);  // ❌ No cleanup
```

**Scenario:**
1. User copies invoice
2. User immediately closes dialog
3. setTimeout fires 2 seconds later on unmounted component

**Impact:**
- React warning: "Can't perform state update on unmounted component"
- Minor memory leak

**Fix Required:**
```typescript
const handleCopyInvoice = async () => {
  if (!lightningInvoiceData?.invoice) return;
  
  try {
    await navigator.clipboard.writeText(lightningInvoiceData.invoice);
    setIsCopied(true);
    
    // Store timeout ID for cleanup
    const timeoutId = setTimeout(() => setIsCopied(false), 2000);
    
    // Clear timeout on unmount (need useEffect or cleanup)
    return () => clearTimeout(timeoutId);
  } catch (error) {
    // ... error handling
  }
};
```

Better approach - use ref:
```typescript
const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

const handleCopyInvoice = async () => {
  // Clear existing timeout
  if (copyTimeoutRef.current) {
    clearTimeout(copyTimeoutRef.current);
  }
  
  await navigator.clipboard.writeText(lightningInvoiceData.invoice);
  setIsCopied(true);
  copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
};

// Cleanup on unmount
useEffect(() => {
  return () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
  };
}, []);
```

---

### 🟠 BUG-011: Settings Modal Async Race Condition
**File:** `SettingsModal.tsx`  
**Line:** 99-118  
**Severity:** LOW

**Issue:**
Loading tip preference has no cleanup if dialog closes:

```typescript
// Line 99-118
useEffect(() => {
  if (!user?.username || !open) return;
  
  const loadPreference = async () => {
    setIsLoadingPreference(true);
    try {
      const { getAccountMetadata, inferTipReceivePreference } = await import('@/lib/accountMetadata');
      const metadata = await getAccountMetadata(user.username);
      const preference = inferTipReceivePreference(metadata.profile?.hive_messenger);
      setTipReceivePreference(preference);  // ❌ No check if still mounted
    } catch (error) {
      // ...
    }
  };
  
  loadPreference();
}, [user?.username, open]);
```

**Scenario:**
1. User opens settings (starts async load)
2. User immediately closes settings
3. Async load completes, calls `setTipReceivePreference` on closed dialog

**Impact:**
- Unnecessary state updates
- Potential memory leak

**Fix Required:**
```typescript
useEffect(() => {
  if (!user?.username || !open) return;
  
  let cancelled = false;
  
  const loadPreference = async () => {
    setIsLoadingPreference(true);
    try {
      const { getAccountMetadata, inferTipReceivePreference } = await import('@/lib/accountMetadata');
      const metadata = await getAccountMetadata(user.username);
      const preference = inferTipReceivePreference(metadata.profile?.hive_messenger);
      
      if (!cancelled) {
        setTipReceivePreference(preference);
      }
    } catch (error) {
      console.error('[SETTINGS] Failed to load tip receive preference:', error);
      if (!cancelled) {
        setTipReceivePreference('hbd');
      }
    } finally {
      if (!cancelled) {
        setIsLoadingPreference(false);
      }
    }
  };
  
  loadPreference();
  
  return () => { cancelled = true; };
}, [user?.username, open]);
```

---

## 4. PERFORMANCE ISSUES

### 🔵 PERF-001: parseTipNotification Called on Every Render
**File:** `MessageBubble.tsx`  
**Line:** 76  
**Severity:** LOW

**Issue:**
```typescript
// Line 76
const tipNotification = !isEncryptedPlaceholder ? parseTipNotification(message.content) : null;
```

`parseTipNotification()` is called on EVERY render even though message content doesn't change.

**Impact:**
- Unnecessary regex parsing on every render
- Minor performance overhead

**Fix Required:**
```typescript
const tipNotification = useMemo(
  () => !isEncryptedPlaceholder ? parseTipNotification(message.content) : null,
  [isEncryptedPlaceholder, message.content]
);
```

---

### 🔵 PERF-002: QR Code Generation Not Memoized
**File:** `LightningTipDialog.tsx`  
**Line:** 86-101  
**Severity:** LOW

**Issue:**
QR code is regenerated on every `lightningInvoiceData` change, even if invoice string is the same.

**Fix Required:**
```typescript
const qrDataUrl = useMemo(() => {
  if (!lightningInvoiceData?.invoice) return null;
  
  let cancelled = false;
  
  QRCode.toDataURL(lightningInvoiceData.invoice, {
    errorCorrectionLevel: 'M',
    width: 300,
    margin: 2,
  }).then(url => {
    if (!cancelled) setQrDataUrl(url);
  });
  
  return () => { cancelled = true; };
}, [lightningInvoiceData?.invoice]);
```

---

### 🔵 PERF-003: No Debouncing on Input Validation
**File:** `SettingsModal.tsx`  
**Line:** 147-164  
**Severity:** LOW

**Issue:**
Lightning Address validation runs on EVERY keystroke:

```typescript
// Line 147-164
const handleLightningInputChange = (value: string) => {
  setLightningInput(value);
  
  if (!value.trim()) {
    return;
  }
  
  // ❌ Validates on every keystroke
  if (!isValidLightningAddress(value)) {
    setLightningError('Invalid format. Use: user@domain.com');
  }
};
```

**Impact:**
- Unnecessary regex checks while user is typing
- Minor performance overhead

**Fix Required:**
```typescript
const [lightningInput, setLightningInput] = useState('');
const debouncedInput = useDebounce(lightningInput, 500);

useEffect(() => {
  if (!debouncedInput.trim()) {
    setLightningError(null);
    return;
  }
  
  if (!isValidLightningAddress(debouncedInput)) {
    setLightningError('Invalid format. Use: user@domain.com');
  } else {
    setLightningError(null);
  }
}, [debouncedInput]);
```

---

## 5. VALIDATION GAPS

### 🟣 VAL-001: parseInt Silently Truncates Decimals
**File:** `LightningTipDialog.tsx`  
**Line:** 215, 731  
**Severity:** MEDIUM

**Issue:**
```typescript
// Line 215
const amount = parseInt(satsAmount);

// Line 731
disabled={isGeneratingInvoice || !satsAmount || parseInt(satsAmount) < 1}
```

`parseInt("1000.5")` returns `1000` - silently truncates decimals.

**Impact:**
- User enters "1000.5 sats" → becomes 1000 sats
- No error, user doesn't know their input was modified

**Fix Required:**
```typescript
const amount = parseInt(satsAmount);

// Validate it's an integer
if (satsAmount.includes('.')) {
  setInvoiceError('Satoshis must be whole numbers (no decimals)');
  return;
}

// Or validate with regex
if (!/^\d+$/.test(satsAmount)) {
  setInvoiceError('Please enter a valid whole number');
  return;
}
```

---

### 🟣 VAL-002: No Input Sanitization on Amount Fields
**File:** `LightningTipDialog.tsx`, `SettingsModal.tsx`  
**Lines:** LightningTipDialog.tsx:501, SettingsModal.tsx:360  
**Severity:** MEDIUM

**Issue:**
HTML5 `type="number"` validation is not enforced programmatically:

```typescript
// LightningTipDialog.tsx Line 501
<Input
  type="number"
  value={satsAmount}
  onChange={(e) => setSatsAmount(e.target.value)}  // ❌ No validation
  min="1"
  max="100000000"
/>

// SettingsModal.tsx Line 360
<Input
  type="number"
  step="0.001"
  min={MIN_MINIMUM_HBD}
  max={MAX_MINIMUM_HBD}
  value={minHBDInput}
  onChange={(e) => setMinHBDInput(e.target.value)}  // ❌ No validation
/>
```

**Impact:**
- Browsers may allow invalid inputs (e.g., negative numbers, non-numbers)
- State contains invalid values

**Fix Required:**
```typescript
// For sats (integers only)
onChange={(e) => {
  const value = e.target.value;
  // Only allow positive integers
  if (value === '' || /^\d+$/.test(value)) {
    setSatsAmount(value);
  }
}}

// For HBD (3 decimal places)
onChange={(e) => {
  const value = e.target.value;
  // Allow empty or valid decimal with max 3 places
  if (value === '' || /^\d*\.?\d{0,3}$/.test(value)) {
    setMinHBDInput(value);
  }
}}
```

---

### 🟣 VAL-003: Type Safety Bypassed with 'as any'
**File:** `lightning.ts`  
**Lines:** 129, 255, 269  
**Severity:** LOW

**Issue:**
```typescript
// Line 129
tokens: testAmountSats as any,

// Line 255
tokens: amountSats as any,

// Line 269
const params = result.params as any;
```

**Impact:**
- Bypasses TypeScript type checking
- Could cause runtime errors if library expects specific type
- Unsafe access to params.min and params.max (could be undefined)

**Fix Required:**
```typescript
// Use proper type from lnurl-pay library
import { Satoshi } from 'lnurl-pay';

tokens: testAmountSats as Satoshi,

// Validate params before accessing
const params = result.params;
if (!params || typeof params.min !== 'number' || typeof params.max !== 'number') {
  throw new Error('Invalid LNURL params received');
}

return {
  invoice: result.invoice,
  params,
  minSendable: params.min / 1000,
  maxSendable: params.max / 1000,
};
```

---

## 6. SECURITY CONCERNS

### 🔒 SEC-001: No CSRF Protection on Metadata Updates
**File:** `accountMetadata.ts`  
**Line:** 336-375  
**Severity:** LOW

**Issue:**
Blockchain updates are signed via Keychain, which provides authentication, but no additional CSRF protection.

**Note:** This is actually acceptable because:
- Hive Keychain provides cryptographic signing
- User must approve each operation
- Operations are recorded on blockchain

**No fix required** - This is the standard Hive security model.

---

### 🔒 SEC-002: Exchange Rate Not Cached (Potential Rate Manipulation)
**File:** `LightningTipDialog.tsx`  
**Lines:** 249, 309  
**Severity:** LOW

**Issue:**
Exchange rate is fetched when generating invoice but not stored with the invoice:

```typescript
// Line 249
fetchedRate = await getBTCtoHBDRate();

// Later, rate could change before payment
```

**Scenario:**
1. User generates invoice at rate 100,000 HBD/BTC
2. Rate changes to 50,000 HBD/BTC (unlikely but possible)
3. User sends payment at old rate

**Impact:**
- Minor price discrepancy (user pays based on cached calculation)
- V4V.app uses current rate, not cached rate

**Note:** This is acceptable because:
- Exchange rates don't fluctuate that rapidly (seconds)
- Invoice expires in 10-15 minutes
- V4V.app handles conversion at time of payment

**No fix required** - Working as designed.

---

## 7. SUMMARY

### Critical Issues (Fix Immediately)
1. **BUG-001:** WebLN HBD notification won't display as tip card
2. **BUG-002:** Users can create invalid state (Lightning preference without address)
3. **BUG-003:** Exchange rate fallback is dead code

### High Priority (Fix Soon)
4. **BUG-004:** Tip preference changes not reflected in open dialog
5. **BUG-005:** No validation of Lightning address format when setting preference
6. **BUG-007:** No pre-flight HBD balance check
7. **VAL-001:** parseInt silently truncates decimals
8. **VAL-002:** No input sanitization on amount fields

### Medium Priority (Fix When Time Allows)
9. **BUG-006:** No invoice expiry countdown
10. **BUG-008:** V4V.app errors not user-friendly
11. **BUG-009:** QR code promise cleanup
12. **BUG-010:** setTimeout cleanup
13. **BUG-011:** Settings modal race condition

### Low Priority (Nice to Have)
14. **PERF-001:** parseTipNotification not memoized
15. **PERF-002:** QR code generation not memoized
16. **PERF-003:** No debouncing on input validation
17. **VAL-003:** Type safety bypassed with 'as any'

---

## Recommended Fixes Priority Order

1. **BUG-001** - WebLN notification format (breaks tip cards)
2. **BUG-002** - Lightning address removal validation (corrupts user state)
3. **BUG-003** - Exchange rate fallback (remove dead code)
4. **VAL-001** - parseInt truncation (data loss)
5. **VAL-002** - Input sanitization (prevents invalid data)
6. **BUG-007** - Balance check (better UX)
7. **BUG-004** - Preference sync (prevents wrong tips)
8. **BUG-005** - Lightning address format validation (prevents invalid state)

All other bugs are lower priority and can be addressed in subsequent iterations.

---

**End of Report**
