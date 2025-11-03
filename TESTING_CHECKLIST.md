# Testing Checklist: Sent Message Decryption

## Pre-Test Checklist
- [ ] App is running (workflow shows RUNNING status)
- [ ] You have Hive Keychain installed
- [ ] You are logged into the app
- [ ] You have at least 0.001 HBD for sending messages
- [ ] You have a conversation partner to test with

## Critical Tests

### ✅ Test 1: Send a Message and Decrypt It
**Purpose:** Verify sent messages can be decrypted using your memo key

**Steps:**
1. Navigate to a conversation with another user
2. Type a test message: "Testing sent message decryption - [timestamp]"
3. Click Send
4. **Expected:** Message appears immediately with plaintext (optimistic update)
5. **Expected:** Keychain prompts for MEMO key permission (encryption)
6. Click Approve in Keychain
7. **Expected:** Keychain prompts for ACTIVE key permission (blockchain transfer)
8. Click Approve in Keychain
9. **Expected:** Toast notification: "Message Sent"
10. Wait 3-5 seconds for blockchain confirmation
11. Refresh the page (F5)
12. **Expected:** Message now shows as: "🔒 Encrypted Message (Sent)" with "Decrypt Message" button
13. Click "Decrypt Message" button
14. **Expected:** Keychain prompts for MEMO key permission
15. Click Approve in Keychain
16. **Expected:** Message decrypts and shows your original text
17. **Expected:** No more decrypt button (already decrypted)

**Success Criteria:**
- ✅ Sent message can be decrypted with your memo key
- ✅ Keychain only prompts once for decryption
- ✅ Decrypted content matches original message
- ✅ Decrypt button disappears after successful decryption

---

### ✅ Test 2: Receive and Decrypt a Message
**Purpose:** Verify received messages work as before

**Steps:**
1. Have another user send you a message
2. Wait 15-30 seconds for polling to fetch it
3. **Expected:** Message appears as: "🔒 Encrypted Message" with "Decrypt Message" button
4. Click "Decrypt Message" button
5. **Expected:** Keychain prompts for MEMO key permission
6. Click Approve in Keychain
7. **Expected:** Message decrypts successfully
8. **Expected:** Content is readable and correct

**Success Criteria:**
- ✅ Received messages show encrypted placeholder
- ✅ Decrypt button appears
- ✅ Decryption works with your memo key
- ✅ Content is correct

---

### ✅ Test 3: Conversation Discovery (No Popup Spam)
**Purpose:** Verify sidebar doesn't trigger multiple Keychain prompts

**Steps:**
1. Ensure you have multiple conversations with encrypted messages
2. Refresh the page (F5) or restart the app
3. Wait for conversations to load in sidebar
4. **Expected:** Sidebar shows conversation list
5. **Expected:** NO Keychain popups appear automatically
6. **Expected:** Last message shows as "[Encrypted message sent by you]" or "[Encrypted message]"
7. Click into a conversation
8. **Expected:** Messages show with decrypt buttons
9. Click decrypt on individual messages
10. **Expected:** Only those specific messages trigger Keychain prompts

**Success Criteria:**
- ✅ No automatic Keychain promups on page load
- ✅ Conversation list loads without prompts
- ✅ Placeholders show in sidebar
- ✅ Individual message decryption works as expected

---

### ✅ Test 4: Cache Persistence After Refresh
**Purpose:** Verify encrypted content persists and can be re-decrypted

**Steps:**
1. Send a message and decrypt it (see Test 1)
2. Verify message shows decrypted plaintext
3. Open browser DevTools → Application → IndexedDB → hive-messenger-v3 → messages
4. Find your message entry
5. **Expected:** Both `content` (plaintext) AND `encryptedContent` (encrypted memo) are present
6. Refresh the page (F5)
7. **Expected:** Message shows as decrypted plaintext (loaded from cache)
8. Clear browser cache OR open in incognito window
9. Log in again
10. Navigate to the conversation
11. **Expected:** Message shows as encrypted placeholder
12. Click "Decrypt Message"
13. **Expected:** Decryption works successfully

**Success Criteria:**
- ✅ Encrypted content is stored in IndexedDB
- ✅ Decrypted messages persist across refreshes
- ✅ Messages can be re-decrypted after cache clear
- ✅ Works on different devices (same account)

---

### ✅ Test 5: Optimistic Update Flow
**Purpose:** Verify smooth UX for sending messages

**Steps:**
1. Type a message: "Testing optimistic update"
2. Click Send
3. **Expected:** Input clears immediately
4. **Expected:** Message appears at bottom of chat with plaintext
5. **Expected:** Message shows status icon (clock → check → double-check)
6. Cancel the Keychain encryption prompt (click Cancel)
7. **Expected:** Message stays in "sending" state
8. Send another message and approve both Keychain prompts
9. **Expected:** First message stays pending, second message confirms
10. Refresh the page
11. **Expected:** Pending message removed (not on blockchain)
12. **Expected:** Confirmed message shows encrypted placeholder

**Success Criteria:**
- ✅ Instant feedback when sending
- ✅ Optimistic update shows plaintext
- ✅ Cancelled messages stay pending
- ✅ Confirmed messages can be decrypted later

---

## Edge Case Tests

### 🔧 Test 6: Missing Encrypted Content
**Steps:**
1. Check IndexedDB for old messages without `encryptedContent`
2. Try to decrypt them
3. **Expected:** Decrypt button may not work OR shows error
4. **Note:** This is expected for old data

### 🔧 Test 7: Corrupted Message Auto-Fix
**Steps:**
1. If you have messages showing base64-like content (corrupted)
2. Refresh the page
3. **Expected:** Corruption detection fixes them automatically
4. **Expected:** Messages show encrypted placeholder
5. **Expected:** Can decrypt if encryptedContent exists

### 🔧 Test 8: Multiple Conversations
**Steps:**
1. Send messages to 3+ different users
2. Decrypt some messages in each conversation
3. Switch between conversations
4. **Expected:** Each conversation remembers which messages are decrypted
5. **Expected:** Query invalidation works per-conversation

---

## Known Limitations

### ❌ Old Sent Messages (Before This Fix)
- **Issue:** Messages sent before this update were stored WITHOUT encrypted content
- **Impact:** You cannot decrypt old sent messages you've already sent
- **Workaround:** All NEW sent messages will be decryptable
- **Reason:** Old confirmMessage() didn't store encryptedContent

### ✅ Old Received Messages
- **Impact:** All received messages (old and new) can be decrypted
- **Reason:** Encrypted content fetched from blockchain

---

## Quick Verification Script

```javascript
// Run in browser console to check IndexedDB structure
const req = indexedDB.open('hive-messenger-v3');
req.onsuccess = function() {
  const db = req.result;
  const tx = db.transaction('messages', 'readonly');
  const store = tx.objectStore('messages');
  const getAllReq = store.getAll();
  
  getAllReq.onsuccess = function() {
    const messages = getAllReq.result;
    console.log('Total messages:', messages.length);
    
    const withEncrypted = messages.filter(m => m.encryptedContent);
    console.log('Messages with encryptedContent:', withEncrypted.length);
    
    const sent = messages.filter(m => m.from === 'YOUR_USERNAME');
    console.log('Sent messages:', sent.length);
    
    const sentWithEncrypted = sent.filter(m => m.encryptedContent);
    console.log('Sent messages with encryptedContent:', sentWithEncrypted.length);
    
    // Show sample message structure
    if (messages.length > 0) {
      console.log('Sample message:', {
        id: messages[0].id,
        from: messages[0].from,
        to: messages[0].to,
        contentPreview: messages[0].content.substring(0, 50),
        hasEncryptedContent: !!messages[0].encryptedContent,
        encryptedContentPreview: messages[0].encryptedContent?.substring(0, 50)
      });
    }
  };
};
```

---

## Success Summary

All tests pass = ✅ Ready for production use!

### What's Working:
- ✅ Sent messages can be decrypted with your memo key
- ✅ Received messages can be decrypted with your memo key
- ✅ Both use Hive Keychain's requestVerifyKey (same as PeakD)
- ✅ Optimistic updates provide instant feedback
- ✅ Cache persistence enables offline access
- ✅ Conversation discovery doesn't spam popups
- ✅ Corruption auto-detection and auto-fix

### What Changed:
- Universal encrypted placeholder: `[🔒 Encrypted - Click to decrypt]`
- Decrypt button shows for BOTH sent and received messages
- confirmMessage() now stores encrypted content
- ECDH encryption reality documented in code comments
