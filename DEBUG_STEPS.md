# Debug Steps for Conversation Issue

## Problem
When logged in as `curatorhulk` and viewing conversations, the sidebar shows "@curatorhulk" as the contact instead of "@dandandan123" (the actual message sender).

## Root Cause Investigation

### What We Know:
1. Message sent from `dandandan123` → `curatorhulk` with content "yo"
2. Sidebar preview shows "yo" correctly  
3. But contact username shows "@curatorhulk" (wrong - should be "@dandandan123")
4. When clicking the conversation, query shows `{"username":"curatorhulk","partner":"curatorhulk"}`

### What This Tells Us:
- The conversation is being stored with `partnerUsername: "curatorhulk"` instead of `"dandandan123"`
- This causes `selectedPartner` to be set to "curatorhulk" when clicking the conversation
- Which makes the app query curatorhulk → curatorhulk (talking to yourself)

### Code Review Findings:
All `updateConversation` calls look correct:
- ✅ Line 225 in messageCache.ts: `partnerUsername: to` (recipient)
- ✅ Line 165 in Messages.tsx: `partnerUsername: username` (correct) 
- ✅ Line 165 in useBlockchainMessages.ts: `partnerUsername: partnerUsername` (correct)
- ✅ Line 246 in useBlockchainMessages.ts: `partnerUsername: partner` (from discovered partners)

### Hypothesis:
**Corrupted IndexedDB data from previous version**

The cache version was bumped to 6.0, but the clearing logic only runs once per browser. If there's corrupted data from testing before the cache clear, it would persist.

## Solution:

### Immediate Fix:
Clear browser cache and IndexedDB manually:
1. Open DevTools → Application → Storage
2. Clear "IndexedDB" → "hive-messenger-v3" → Delete database
3. Refresh page and log in again

### Code Fix:
Add better cache invalidation to ensure corrupted conversations are cleared.

## Testing Steps:
1. Clear IndexedDB completely  
2. Log in as curatorhulk
3. Wait for conversation discovery (should run automatically)
4. Check console logs for:
   - `[CONV DISCOVERY] Discovered partners:` - should show ["dandandan123"]
   - `[CONV DISCOVERY] Creating new conversation:` - partnerUsername should be "dandandan123"
5. Verify sidebar shows "@dandandan123" not "@curatorhulk"
6. Click conversation and verify messages load correctly
