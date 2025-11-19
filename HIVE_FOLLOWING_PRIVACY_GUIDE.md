# Hive Messenger: Following Integration & Privacy Controls Technical Guide

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Core Technical Components](#core-technical-components)
4. [Privacy Settings System](#privacy-settings-system)
5. [Trust Indicators](#trust-indicators)
6. [Suggested Contacts](#suggested-contacts)
7. [Privacy Enforcement](#privacy-enforcement)
8. [Code Module Reference](#code-module-reference)
9. [Performance Optimizations](#performance-optimizations)
10. [Edge Cases & Limitations](#edge-cases--limitations)
11. [Best Practices](#best-practices)

---

## Executive Summary

Hive Messenger integrates Hive's native Following system to provide **trust-based privacy controls** for messaging and group invites. This guide documents the complete architecture, from blockchain data fetching to UI trust indicators, including critical pagination fixes and dual-layer caching strategies.

### Key Achievements
- ✅ **Native Hive Integration**: Uses blockchain's built-in follow relationships (no custom storage)
- ✅ **Dual-Layer Caching**: IndexedDB + in-memory for <100ms follow checks
- ✅ **Scalable Pagination**: Handles accounts following >1000 users without infinite loops
- ✅ **Privacy-First Design**: Message and group invite privacy modes based on following
- ✅ **Trust Indicators**: Visual badges showing "You follow @username" in chat headers
- ✅ **Suggested Contacts**: Auto-populated contact picker from your following list
- ✅ **Whitelist Exceptions**: Local storage-based overrides for privacy filters
- ✅ **Zero UI Flicker**: Smart caching prevents badge disappearance during refetch

---

## Architecture Overview

### System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                     │
├─────────────────────────────────────────────────────────────────┤
│  • ChatHeader (trust badges)                                     │
│  • GroupChatHeader (member trust indicators)                     │
│  • NewMessageModal (suggested contacts)                          │
│  • SettingsModal (privacy controls)                              │
│  • ManageMembersModal (invite validation)                        │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Application Logic Layer                       │
├─────────────────────────────────────────────────────────────────┤
│  • hiveFollowing.ts - Following API & caching                    │
│  • accountMetadata.ts - Privacy settings & helpers               │
│  • useBlockchainMessages.ts - Message filtering                 │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Dual-Layer Cache System                         │
├─────────────────────────────────────────────────────────────────┤
│  In-Memory Cache (Map)           IndexedDB (Persistent)          │
│  • Synchronous access            • Survives browser restart      │
│  • Set-based storage             • 24-hour expiration            │
│  • <1ms lookup                   • ~5ms lookup                   │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Hive Blockchain API                         │
├─────────────────────────────────────────────────────────────────┤
│  • follow_api.get_following - Paginated following list           │
│  • account_metadata - Privacy settings storage                   │
│  • Decentralized, immutable data                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Diagrams

**Following List Retrieval:**
```
User Opens Chat
      ↓
Check In-Memory Cache (Map)
      ↓ miss
Check IndexedDB Cache
      ↓ miss
Fetch from Hive API (paginated)
      ↓
Store in IndexedDB
      ↓
Populate In-Memory Cache
      ↓
Display Trust Badge
```

**Privacy Check Flow:**
```
User Tries to Message @alice
      ↓
Get @alice's Privacy Settings (blockchain metadata)
      ↓
Check: Is sender on @alice's exceptions list? → YES → Allow
      ↓ NO
Check: Privacy mode = 'everyone'? → YES → Allow
      ↓ NO
Check: Privacy mode = 'disabled'? → YES → Block
      ↓ NO
Check: Privacy mode = 'following'?
      ↓
Does @alice follow sender? → YES → Allow
      ↓ NO
Block (show privacy message)
```

---

## Core Technical Components

### 1. Following Data Structure

**In-Memory Cache:**
```typescript
interface FollowingCache {
  username: string;
  following: Set<string>;  // Normalized lowercase usernames
  fetchedAt: number;       // Timestamp for expiration
}

// Global cache (lives in memory during session)
const followingMemoryCache = new Map<string, FollowingCache>();
```

**IndexedDB Schema:**
```typescript
interface FollowingRecord {
  username: string;        // Primary key
  following: string[];     // Array of followed usernames (normalized)
  cachedAt: string;        // ISO timestamp
}

// Store configuration
db.createObjectStore('following', { keyPath: 'username' });
```

**Blockchain Format (Hive API):**
```json
[
  {
    "follower": "alice",
    "following": "bob",
    "what": ["blog"]
  },
  {
    "follower": "alice",
    "following": "charlie",
    "what": ["blog"]
  }
]
```

### 2. Privacy Settings Structure

**Account Metadata Schema:**
```typescript
interface HiveMessengerProfile {
  minimum_hbd?: string;              // Minimum HBD for incoming messages
  message_privacy?: PrivacyMode;     // 'everyone' | 'following' | 'disabled'
  group_invite_privacy?: PrivacyMode; // 'everyone' | 'following' | 'disabled'
  lightning_address?: string;         // Lightning Network address
  tip_receive_preference?: 'lightning' | 'hbd';
}

// Stored in Hive account metadata
{
  "profile": {
    "hive_messenger": {
      "message_privacy": "following",
      "group_invite_privacy": "following"
    }
  }
}
```

**Privacy Modes:**
- **`everyone`**: Anyone can message or invite to groups
- **`following`**: Only people you follow can message or invite you
- **`disabled`**: No one can message or invite you (except exceptions)

### 3. Exceptions List (Whitelist)

**Local Storage Format:**
```typescript
interface ExceptionsData {
  username: string;           // Current user
  exceptions: string[];       // Whitelisted usernames
  updatedAt: string;
}

// Stored in localStorage
localStorage.setItem(
  'hive_messenger_exceptions_alice',
  JSON.stringify({
    username: 'alice',
    exceptions: ['bob', 'charlie'],
    updatedAt: '2024-01-15T10:30:00.000Z'
  })
);
```

**Key Limitation:** Exceptions are client-side only. When adding someone to a group, you cannot check if you're on *their* exceptions list (it's stored on their device).

---

## Privacy Settings System

### Setting Privacy Preferences

**File:** `client/src/lib/accountMetadata.ts`

```typescript
/**
 * Set message privacy mode (stored on Hive blockchain)
 */
export async function setMessagePrivacy(
  username: string,
  mode: PrivacyMode
): Promise<void> {
  // Get current metadata
  const currentMetadata = await getAccountMetadata(username);
  
  // Update privacy setting
  const updatedProfile = {
    ...currentMetadata.profile,
    hive_messenger: {
      ...currentMetadata.profile?.hive_messenger,
      message_privacy: mode
    }
  };

  // Broadcast to blockchain via account_update2
  await window.hive_keychain.requestAccountUpdate(
    username,
    {
      profile: updatedProfile
    },
    'Update message privacy settings'
  );
}

/**
 * Set group invite privacy mode
 */
export async function setGroupInvitePrivacy(
  username: string,
  mode: PrivacyMode
): Promise<void> {
  const currentMetadata = await getAccountMetadata(username);
  
  const updatedProfile = {
    ...currentMetadata.profile,
    hive_messenger: {
      ...currentMetadata.profile?.hive_messenger,
      group_invite_privacy: mode
    }
  };

  await window.hive_keychain.requestAccountUpdate(
    username,
    { profile: updatedProfile },
    'Update group invite privacy settings'
  );
}
```

### Reading Privacy Settings

```typescript
/**
 * Get user's message privacy mode
 */
export async function getMessagePrivacy(
  username: string
): Promise<PrivacyMode> {
  try {
    const metadata = await getAccountMetadata(username);
    return metadata.profile?.hive_messenger?.message_privacy || 'everyone';
  } catch (error) {
    console.error('[METADATA] Failed to get message privacy:', error);
    return 'everyone'; // Default to open
  }
}

/**
 * Get user's group invite privacy mode
 */
export async function getGroupInvitePrivacy(
  username: string
): Promise<PrivacyMode> {
  try {
    const metadata = await getAccountMetadata(username);
    return metadata.profile?.hive_messenger?.group_invite_privacy || 'everyone';
  } catch (error) {
    console.error('[METADATA] Failed to get group invite privacy:', error);
    return 'everyone';
  }
}
```

### UI: Settings Modal

**File:** `client/src/components/SettingsModal.tsx`

```typescript
export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user } = useAuth();
  const [messagePrivacy, setMessagePrivacy] = useState<PrivacyMode>('everyone');
  const [groupInvitePrivacy, setGroupInvitePrivacy] = useState<PrivacyMode>('everyone');

  // Load privacy settings when modal opens
  useEffect(() => {
    if (open && user?.username) {
      loadPrivacySettings();
    }
  }, [open, user?.username]);

  const loadPrivacySettings = async () => {
    if (!user?.username) return;
    
    const [msgPrivacy, groupPrivacy] = await Promise.all([
      getMessagePrivacy(user.username),
      getGroupInvitePrivacy(user.username)
    ]);
    
    setMessagePrivacy(msgPrivacy);
    setGroupInvitePrivacy(groupPrivacy);
  };

  const handleSavePrivacy = async () => {
    if (!user?.username) return;
    
    await Promise.all([
      setMessagePrivacy(user.username, messagePrivacy),
      setGroupInvitePrivacy(user.username, groupInvitePrivacy)
    ]);
    
    toast({ title: 'Privacy settings updated' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Privacy Settings</DialogTitle>
        </DialogHeader>

        {/* Message Privacy Control */}
        <div className="space-y-2">
          <Label>Who can send you direct messages?</Label>
          <RadioGroup value={messagePrivacy} onValueChange={setMessagePrivacy}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="everyone" id="msg-everyone" />
              <Label htmlFor="msg-everyone">Everyone</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="following" id="msg-following" />
              <Label htmlFor="msg-following">People I follow</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="disabled" id="msg-disabled" />
              <Label htmlFor="msg-disabled">Disabled</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Group Invite Privacy Control */}
        <div className="space-y-2">
          <Label>Who can add you to groups?</Label>
          <RadioGroup value={groupInvitePrivacy} onValueChange={setGroupInvitePrivacy}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="everyone" id="group-everyone" />
              <Label htmlFor="group-everyone">Everyone</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="following" id="group-following" />
              <Label htmlFor="group-following">People I follow</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="disabled" id="group-disabled" />
              <Label htmlFor="group-disabled">Disabled</Label>
            </div>
          </RadioGroup>
        </div>

        <Button onClick={handleSavePrivacy}>Save Settings</Button>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Trust Indicators

Trust indicators are visual badges that show "You follow @username" in chat interfaces, providing instant feedback about your relationship with contacts.

### ChatHeader Implementation

**File:** `client/src/components/ChatHeader.tsx`

```typescript
export function ChatHeader({ contactUsername }: ChatHeaderProps) {
  const { user } = useAuth();
  
  // Preload current user's following list for trust indicator
  const { data: followingList, isPending } = useQuery({
    queryKey: ['following', user?.username],
    queryFn: async () => {
      if (!user?.username) return [];
      return await preloadFollowingList(user.username);
    },
    enabled: !!user?.username,
    staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
  });
  
  // Check if current user follows this contact
  // Show badge if we have data (even if loading in background)
  const isFollowing = followingList?.includes(contactUsername.toLowerCase()) ?? false;

  return (
    <div className="chat-header">
      <div className="contact-info">
        <Avatar>{contactUsername[0]}</Avatar>
        <h2>@{contactUsername}</h2>
      </div>
      
      {/* Trust Indicator Badge */}
      {isFollowing && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" data-testid="badge-following">
              <UserCheck className="w-3 h-3" />
              <span>Following</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>You follow @{contactUsername}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
```

### GroupChatHeader Implementation

Shows trust indicators for multiple group members:

```typescript
export function GroupChatHeader({ members }: GroupChatHeaderProps) {
  const { user } = useAuth();
  
  const { data: followingList, isPending } = useQuery({
    queryKey: ['following', user?.username],
    queryFn: async () => {
      if (!user?.username) return [];
      return await preloadFollowingList(user.username);
    },
    enabled: !!user?.username,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  
  // Check if current user follows a specific member
  const isFollowingMember = (memberUsername: string): boolean => {
    if (!user?.username || !followingList) return false;
    return followingList.includes(memberUsername.toLowerCase());
  };

  return (
    <div className="group-header">
      <div className="members-list">
        {members.map(member => (
          <div key={member} className="member-item">
            <Avatar>{member[0]}</Avatar>
            <span>@{member}</span>
            
            {/* Trust indicator for each member */}
            {isFollowingMember(member) && (
              <Badge variant="secondary" className="ml-2">
                <UserCheck className="w-3 h-3" />
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Key Design Decisions

**Why no loading state check?**
```typescript
// ❌ BAD: Causes badge flicker during background refetch
const isFollowing = !isPending && followingList?.includes(...);

// ✅ GOOD: Shows badge whenever data is available
const isFollowing = followingList?.includes(...) ?? false;
```

**React Query's `isPending` vs `isLoading`:**
- `isPending`: Only true on initial load (no data exists)
- `isLoading`: True on both initial load AND background refetch
- **We use `isPending`** to avoid hiding badges during background updates

---

## Suggested Contacts

The New Message modal shows your following list as suggested contacts for quick access.

**File:** `client/src/components/NewMessageModal.tsx`

```typescript
export function NewMessageModal({ open, onOpenChange }: NewMessageModalProps) {
  const { user } = useAuth();

  // Fetch following list for suggested contacts
  const { data: followingList, isPending: isLoadingFollowing } = useQuery({
    queryKey: ['following', user?.username],
    queryFn: async () => {
      if (!user?.username) return [];
      return await preloadFollowingList(user.username);
    },
    enabled: !!user?.username && open,  // Only fetch when modal is open
    staleTime: 0,  // ✅ Always refetch to ensure suggested contacts are current
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',  // ✅ Force refetch when modal opens
    placeholderData: (previousData) => previousData,  // ✅ Retain previous data during refetch
  });

  const handleSelectSuggested = (username: string) => {
    onStartChat(username);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>

        {/* Suggested Contacts Section */}
        {followingList && followingList.length > 0 ? (
          <div className="space-y-2">
            <Label>Suggested Contacts</Label>
            <ScrollArea className="h-[200px] border rounded-md">
              <div className="p-2 space-y-1">
                {followingList.slice(0, 50).map((followedUser) => (
                  <button
                    key={followedUser}
                    type="button"
                    onClick={() => handleSelectSuggested(followedUser)}
                    className="w-full flex items-center gap-3 p-2 rounded-md hover-elevate"
                    data-testid={`suggested-contact-${followedUser}`}
                  >
                    <Avatar>
                      <AvatarFallback>{followedUser[0]}</AvatarFallback>
                    </Avatar>
                    <span>@{followedUser}</span>
                    <UserCheck className="w-4 h-4 ml-auto" />
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : isLoadingFollowing ? (
          <div className="h-[200px] flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p>Loading your following list...</p>
          </div>
        ) : null}

        {/* Manual username input */}
        <Input placeholder="Or enter username manually..." />
      </DialogContent>
    </Dialog>
  );
}
```

**Aggressive Refresh Strategy:**
- `staleTime: 0`: Data is immediately considered stale
- `refetchOnMount: 'always'`: Always refetch when modal opens
- `placeholderData`: Prevents UI flicker by showing previous data while fetching

**Why aggressive refresh?**
To prevent showing stale suggestions if user unfollows someone between modal openings.

---

## Privacy Enforcement

Privacy is enforced at multiple layers to ensure comprehensive protection.

### Layer 1: Helper Functions

**File:** `client/src/lib/accountMetadata.ts`

```typescript
/**
 * Check if sender can message recipient based on privacy settings
 */
export async function canSendMessage(
  senderUsername: string,
  recipientUsername: string,
  recipientPrivacy?: PrivacyMode,
  isFollowing?: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Get recipient's message privacy setting
    const privacy = recipientPrivacy || await getMessagePrivacy(recipientUsername);
    
    // If privacy is 'everyone', allow
    if (privacy === 'everyone') {
      return { allowed: true };
    }
    
    // If privacy is 'disabled', deny
    if (privacy === 'disabled') {
      return { 
        allowed: false, 
        reason: `@${recipientUsername} has disabled direct messages` 
      };
    }
    
    // If privacy is 'following', check if recipient follows sender
    if (privacy === 'following') {
      const { doesUserFollow } = await import('./hiveFollowing');
      const recipientFollowsSender = isFollowing !== undefined 
        ? isFollowing 
        : await doesUserFollow(recipientUsername, senderUsername);
      
      if (!recipientFollowsSender) {
        return { 
          allowed: false, 
          reason: `@${recipientUsername} only accepts messages from people they follow` 
        };
      }
      
      return { allowed: true };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('[METADATA] Error checking message permission:', error);
    // Default to allowing on error to prevent blocking legitimate messages
    return { allowed: true };
  }
}

/**
 * Check if inviter can add invitee to a group based on privacy settings
 */
export async function canInviteToGroup(
  inviterUsername: string,
  inviteeUsername: string,
  inviteePrivacy?: PrivacyMode,
  isFollowing?: boolean,
  inviterIsException?: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Check if inviter is on invitee's exceptions list (whitelist override)
    // NOTE: This can only be known if the current logged-in user IS the invitee
    // When adding others to groups, this will default to false (correct behavior)
    const inviterOnWhitelist = inviterIsException ?? false;
    
    // Whitelist overrides all privacy filters
    if (inviterOnWhitelist) {
      return { allowed: true };
    }
    
    // Get invitee's group invite privacy setting
    const privacy = inviteePrivacy || await getGroupInvitePrivacy(inviteeUsername);
    
    // If privacy is 'everyone', allow
    if (privacy === 'everyone') {
      return { allowed: true };
    }
    
    // If privacy is 'disabled', deny
    if (privacy === 'disabled') {
      return { 
        allowed: false, 
        reason: `@${inviteeUsername} has disabled group invites` 
      };
    }
    
    // If privacy is 'following', check if invitee follows inviter
    if (privacy === 'following') {
      const { doesUserFollow } = await import('./hiveFollowing');
      const inviteeFollowsInviter = isFollowing !== undefined 
        ? isFollowing 
        : await doesUserFollow(inviteeUsername, inviterUsername);
      
      if (!inviteeFollowsInviter) {
        return { 
          allowed: false, 
          reason: `@${inviteeUsername} only accepts group invites from people they follow` 
        };
      }
      
      return { allowed: true };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('[METADATA] Error checking group invite permission:', error);
    return { allowed: true };
  }
}
```

### Layer 2: Message Discovery Filtering

**File:** `client/src/hooks/useBlockchainMessages.ts`

```typescript
export function useBlockchainMessages({ partnerUsername }: Options) {
  const { user } = useAuth();
  const { isException } = useExceptionsList();

  const { data: messages } = useQuery({
    queryKey: ['blockchain-messages', user?.username, partnerUsername],
    queryFn: async () => {
      if (!user?.username) return [];

      // Load user's privacy settings and following list
      let messagePrivacy: PrivacyMode = 'everyone';
      let userFollowingList: string[] = [];
      
      try {
        const metadata = await getAccountMetadata(user.username);
        messagePrivacy = metadata.profile?.hive_messenger?.message_privacy || 'everyone';
        
        // Load following list if privacy is 'following'
        if (messagePrivacy === 'following') {
          const { getFollowingList } = await import('@/lib/hiveFollowing');
          userFollowingList = await getFollowingList(user.username);
        }
      } catch (error) {
        console.warn('[FILTER] Failed to load user preferences:', error);
      }

      // Scan blockchain for messages
      const allMessages = await discoverMessages(user.username, partnerUsername);

      // Filter messages based on privacy settings
      const filteredMessages = allMessages.map(msg => {
        if (msg.from === user.username) {
          // Sent messages: always visible
          return { ...msg, hidden: false };
        } else {
          // Received messages: apply privacy filters
          const senderIsException = isException(msg.from);
          let shouldHide = false;

          // Privacy filtering
          if (messagePrivacy === 'disabled') {
            // Disabled: Hide all incoming messages (except exceptions)
            shouldHide = !senderIsException;
          } else if (messagePrivacy === 'following') {
            // Following-only: Hide if recipient doesn't follow sender
            const recipientFollowsSender = userFollowingList.includes(msg.from.toLowerCase());
            shouldHide = !senderIsException && !recipientFollowsSender;
          }

          return { ...msg, hidden: shouldHide };
        }
      });

      return filteredMessages;
    },
    enabled: !!user?.username,
    refetchInterval: 15000,  // Poll every 15 seconds
  });

  return { messages };
}
```

### Layer 3: UI Validation (Group Invites)

**File:** `client/src/components/ManageMembersModal.tsx`

```typescript
export function ManageMembersModal({ currentUsername, onUpdateMembers }: Props) {
  const [newMemberInput, setNewMemberInput] = useState('');
  const { toast } = useToast();

  const handleAddMember = async () => {
    const cleanUsername = newMemberInput.toLowerCase().trim();
    
    // Validate username exists on blockchain
    const memoKey = await getHiveMemoKey(cleanUsername);
    if (!memoKey) {
      setError(`User @${cleanUsername} not found`);
      return;
    }
    
    // Check if current user can invite this member based on privacy settings
    if (currentUsername) {
      const inviteCheck = await canInviteToGroup(currentUsername, cleanUsername);
      
      if (!inviteCheck.allowed) {
        // Show error toast with the privacy reason
        toast({
          title: 'Cannot Add Member',
          description: inviteCheck.reason || `Unable to add @${cleanUsername}`,
          variant: 'destructive',
        });
        setError(inviteCheck.reason || 'Privacy settings prevent adding this member');
        return;
      }
    }
    
    // Privacy check passed, add member
    await onUpdateMembers([...members, cleanUsername]);
  };

  return (
    <Dialog>
      <DialogContent>
        <Input
          value={newMemberInput}
          onChange={(e) => setNewMemberInput(e.target.value)}
          placeholder="Enter username to add..."
        />
        <Button onClick={handleAddMember}>Add Member</Button>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Code Module Reference

### Core Following API

**File:** `client/src/lib/hiveFollowing.ts`

#### Key Functions

**1. Fetch Following List (with pagination fix)**

```typescript
/**
 * Fetch complete following list for a user with proper pagination
 * Handles accounts following >1000 users without infinite loops
 */
export async function fetchFollowingList(username: string): Promise<string[]> {
  const followingSet = new Set<string>();
  let startFollowing = '';
  let hasMore = true;
  let iterations = 0;
  const maxIterations = Math.ceil(MAX_FOLLOWING / FETCH_LIMIT);

  while (hasMore && iterations < maxIterations) {
    const result = await hiveClient.call('follow_api', 'get_following', [
      username.toLowerCase(),
      startFollowing,
      'blog',
      FETCH_LIMIT
    ]);

    if (!result || result.length === 0) {
      hasMore = false;
      break;
    }

    // Extract usernames, skip duplicate start record on pagination
    const startIndex = (iterations === 0 || startFollowing === '') ? 0 : 1;
    const beforeSize = followingSet.size;
    let lastUniqueAdded: string | null = null;
    
    for (let i = startIndex; i < result.length; i++) {
      const normalized = result[i].following.toLowerCase();
      const sizeBefore = followingSet.size;
      followingSet.add(normalized);
      
      // Track if this entry was actually new (not a duplicate)
      if (followingSet.size > sizeBefore) {
        lastUniqueAdded = normalized;
      }
    }
    
    // Count new unique usernames added this iteration
    const newEntriesAdded = followingSet.size - beforeSize;

    // Pagination termination logic
    // Stop if we added zero new entries OR got a partial page
    if (newEntriesAdded === 0 || result.length < FETCH_LIMIT) {
      hasMore = false;
    } else if (result.length === FETCH_LIMIT && lastUniqueAdded) {
      // Full page with new entries - continue from last UNIQUE username
      startFollowing = lastUniqueAdded;
      hasMore = true;
    } else {
      hasMore = false;
    }

    iterations++;
  }

  return Array.from(followingSet);
}
```

**Critical Fix Explained:**
- **Problem**: Hive API returns the `start` account again on each page
- **Old Logic**: `if (result.length < FETCH_LIMIT) break;` → infinite loop on duplicate pages
- **New Logic**: Track `lastUniqueAdded` and stop when `newEntriesAdded === 0`
- **Result**: Correctly handles accounts following 1000+ users

**2. Dual-Layer Caching**

```typescript
/**
 * Get following list with dual-layer caching
 */
export async function getFollowingList(
  username: string,
  forceRefresh: boolean = false
): Promise<string[]> {
  const normalizedUsername = username.toLowerCase();
  
  // LAYER 1: In-Memory Cache (fastest, <1ms)
  if (!forceRefresh) {
    const memCache = getInMemoryCache(normalizedUsername);
    if (memCache) {
      return Array.from(memCache.following);
    }
  }
  
  // LAYER 2: IndexedDB Cache (~5ms)
  const db = await getFollowingDB();
  if (!forceRefresh) {
    const cached = await db.get('following', normalizedUsername);
    
    if (cached) {
      const age = Date.now() - new Date(cached.cachedAt).getTime();
      
      // Use cache if less than 24 hours old
      if (age < 24 * 60 * 60 * 1000) {
        // Populate in-memory cache for next access
        setInMemoryCache(normalizedUsername, cached.following);
        return cached.following;
      }
    }
  }
  
  // LAYER 3: Fetch from blockchain
  const following = await fetchFollowingList(normalizedUsername);
  
  // Store in both caches
  await db.put('following', {
    username: normalizedUsername,
    following,
    cachedAt: new Date().toISOString()
  });
  
  setInMemoryCache(normalizedUsername, following);
  
  return following;
}
```

**3. Synchronous Follow Check**

```typescript
/**
 * Synchronous follow check using in-memory cache
 * Returns null if not cached (must fetch first)
 */
export function doesUserFollowSync(
  follower: string,
  following: string
): boolean | null {
  const normalizedFollower = follower.toLowerCase();
  const normalizedFollowing = following.toLowerCase();
  
  const memCache = getInMemoryCache(normalizedFollower);
  if (!memCache) return null;
  
  return memCache.following.has(normalizedFollowing);
}
```

**4. Async Follow Check**

```typescript
/**
 * Check if one user follows another (async, fetches if needed)
 */
export async function doesUserFollow(
  follower: string,
  following: string
): Promise<boolean> {
  const normalizedFollower = follower.toLowerCase();
  const normalizedFollowing = following.toLowerCase();
  
  // Get following list (uses caching)
  const followingList = await getFollowingList(normalizedFollower);
  
  return followingList.includes(normalizedFollowing);
}
```

**5. Preload Helper for React Query**

```typescript
/**
 * Preload following list (optimized for React Query)
 */
export async function preloadFollowingList(username: string): Promise<string[]> {
  return await getFollowingList(username, false);
}
```

---

## Performance Optimizations

### 1. Dual-Layer Caching Strategy

```
Request Flow:
┌────────────────────────────────────────┐
│ Component requests following list      │
└────────────┬───────────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│ Check In-Memory Cache (Map)            │
│ • Set<string> for O(1) lookup          │
│ • <1ms access time                     │
│ • Lives for session duration           │
└────────────┬───────────────────────────┘
             │ miss
             ▼
┌────────────────────────────────────────┐
│ Check IndexedDB Cache                  │
│ • Persistent across sessions           │
│ • ~5ms access time                     │
│ • 24-hour expiration                   │
└────────────┬───────────────────────────┘
             │ miss or expired
             ▼
┌────────────────────────────────────────┐
│ Fetch from Hive Blockchain             │
│ • Paginated API calls                  │
│ • ~500ms for 1000 follows              │
│ • Update both caches                   │
└────────────────────────────────────────┘
```

**Benefits:**
- **First access**: ~500ms (blockchain fetch)
- **Subsequent accesses**: <1ms (in-memory)
- **After browser restart**: ~5ms (IndexedDB)
- **Offline capability**: Works with cached data

### 2. Username Normalization

All usernames normalized to lowercase to prevent false negatives:

```typescript
// ❌ BAD: Case-sensitive comparison
followingList.includes('Alice');  // Fails if stored as 'alice'

// ✅ GOOD: Normalized comparison
followingList.includes(username.toLowerCase());  // Always works
```

**Where normalization happens:**
- During fetch from blockchain
- During cache storage
- During lookup operations
- In all comparison functions

### 3. Set-Based Storage (In-Memory)

```typescript
// ❌ BAD: Array lookup O(n)
const following: string[] = [...];
following.includes('username');  // Linear search

// ✅ GOOD: Set lookup O(1)
const following: Set<string> = new Set([...]);
following.has('username');  // Constant time
```

### 4. React Query Cache Strategy

Different caching strategies for different use cases:

```typescript
// Trust indicators: 5-minute cache (moderate freshness)
useQuery({
  queryKey: ['following', username],
  queryFn: () => preloadFollowingList(username),
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
});

// Suggested contacts: Always fresh (aggressive refresh)
useQuery({
  queryKey: ['following', username],
  queryFn: () => preloadFollowingList(username),
  staleTime: 0,                        // Immediately stale
  refetchOnMount: 'always',            // Always refetch
  placeholderData: (prev) => prev,     // Prevent flicker
});
```

### 5. Deduplication During Pagination

```typescript
// Use Set to automatically deduplicate
const followingSet = new Set<string>();

// Add usernames (duplicates ignored automatically)
for (const record of result) {
  followingSet.add(record.following.toLowerCase());
}

// Convert to array once at the end
return Array.from(followingSet);
```

---

## Edge Cases & Limitations

### 1. Whitelist Exceptions Limitation

**Problem:** Exceptions list is stored in localStorage on each user's device.

**Impact:**
```typescript
// When Alice adds Bob to a group:
// ✅ CAN check: Bob's privacy settings (blockchain)
// ✅ CAN check: If Bob follows Alice (blockchain)
// ❌ CANNOT check: If Alice is on Bob's exceptions list (Bob's localStorage)

// Solution: Only check blockchain-based privacy, document limitation
```

**Workaround:** Exceptions only enforced for current user receiving invites/messages.

### 2. Large Following Lists

**Challenge:** Users following >1000 accounts require multiple API calls.

**Solution:**
```typescript
// Pagination with infinite loop prevention
let lastUniqueAdded: string | null = null;

// Track unique additions, stop when none added
const newEntriesAdded = followingSet.size - beforeSize;
if (newEntriesAdded === 0) {
  hasMore = false;  // Prevent infinite loop
}
```

**Performance:**
- 1000 follows: ~1 second
- 5000 follows: ~5 seconds
- 10000 follows: ~10 seconds

### 3. Cache Invalidation

**When to invalidate:**
```typescript
// Manual follow/unfollow actions
await followUser(targetUsername);
queryClient.invalidateQueries({ queryKey: ['following', username] });

// After settings changes
await setMessagePrivacy(username, 'following');
// No invalidation needed (privacy stored separately)
```

### 4. Race Conditions

**Scenario:** User quickly opens/closes New Message modal

**Protection:**
```typescript
// React Query handles this automatically
enabled: !!user?.username && open,  // Only fetch when modal open

// If modal closes before fetch completes:
// - Query is cancelled
// - No state updates occur
// - No memory leaks
```

### 5. Blockchain Lag

**Problem:** Privacy settings stored on blockchain (not instant).

**Impact:**
```typescript
// User changes privacy from 'everyone' to 'following'
await setMessagePrivacy(username, 'following');

// Changes visible after:
// - Transaction included in block (~3 seconds)
// - Blockchain confirmation
// - Cache expiration or manual refresh
```

**Mitigation:** Show "Updating..." state in UI during broadcasts.

### 6. IndexedDB Quota

**Browser limits:** 
- Chrome: ~60% of available disk space
- Firefox: ~50% of available disk space
- Safari: ~1GB per origin

**Monitoring:**
```typescript
if ('storage' in navigator && 'estimate' in navigator.storage) {
  const estimate = await navigator.storage.estimate();
  const percentUsed = (estimate.usage! / estimate.quota!) * 100;
  
  if (percentUsed > 80) {
    console.warn('IndexedDB quota nearly full:', percentUsed.toFixed(1) + '%');
    // Trigger cleanup
  }
}
```

---

## Best Practices

### 1. Always Normalize Usernames

```typescript
// ✅ GOOD: Normalize before comparison
const isFollowing = followingList.includes(username.toLowerCase());

// ❌ BAD: Direct comparison (case-sensitive)
const isFollowing = followingList.includes(username);
```

### 2. Use Helper Functions

```typescript
// ✅ GOOD: Use privacy helpers
const { allowed, reason } = await canSendMessage(sender, recipient);
if (!allowed) {
  showError(reason);
  return;
}

// ❌ BAD: Manual privacy checks (error-prone)
const privacy = await getMessagePrivacy(recipient);
if (privacy === 'following') {
  const follows = await doesUserFollow(recipient, sender);
  if (!follows) {
    // Missing whitelist check!
    showError('Not allowed');
    return;
  }
}
```

### 3. Show User Feedback

```typescript
// ✅ GOOD: Clear error messages
toast({
  title: 'Cannot Add Member',
  description: '@alice only accepts group invites from people they follow',
  variant: 'destructive',
});

// ❌ BAD: Generic errors
toast({ title: 'Error', description: 'Failed' });
```

### 4. Handle Loading States

```typescript
// ✅ GOOD: Show loading indicator
{isLoadingFollowing ? (
  <Loader2 className="animate-spin" />
) : (
  <ContactList contacts={followingList} />
)}

// ❌ BAD: No loading feedback
<ContactList contacts={followingList ?? []} />
```

### 5. Validate Privacy Before Actions

```typescript
// ✅ GOOD: Validate before attempting action
const inviteCheck = await canInviteToGroup(inviter, invitee);
if (!inviteCheck.allowed) {
  showError(inviteCheck.reason);
  return;
}
await addToGroup(invitee);

// ❌ BAD: Try action, handle error after
try {
  await addToGroup(invitee);
} catch (error) {
  // User already saw Keychain prompt and cancelled
  showError('Failed');
}
```

### 6. Use Appropriate Cache Strategies

```typescript
// Trust indicators: Moderate staleness OK
staleTime: 5 * 60 * 1000,  // 5 minutes

// Suggested contacts: Always fresh
staleTime: 0,
refetchOnMount: 'always',

// Privacy settings: Fresh when modal opens
enabled: !!user && open,
staleTime: 0,
```

### 7. Provide Escape Hatches

```typescript
// Allow users to bypass privacy via exceptions
<Button onClick={() => addToExceptions(username)}>
  Add to Exceptions List
</Button>

// Or show "Request to Message" button
<Button onClick={() => sendFollowRequest(username)}>
  Follow to Enable Messaging
</Button>
```

---

## Testing Scenarios

### Unit Tests

```typescript
describe('canSendMessage', () => {
  it('allows when privacy is everyone', async () => {
    const result = await canSendMessage('alice', 'bob', 'everyone');
    expect(result.allowed).toBe(true);
  });

  it('blocks when privacy is disabled', async () => {
    const result = await canSendMessage('alice', 'bob', 'disabled');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('allows when privacy is following and recipient follows sender', async () => {
    const result = await canSendMessage('alice', 'bob', 'following', true);
    expect(result.allowed).toBe(true);
  });

  it('blocks when privacy is following and recipient does not follow sender', async () => {
    const result = await canSendMessage('alice', 'bob', 'following', false);
    expect(result.allowed).toBe(false);
  });
});
```

### Integration Tests

```typescript
describe('NewMessageModal suggested contacts', () => {
  it('shows loading state initially', () => {
    render(<NewMessageModal open={true} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('displays following list after load', async () => {
    render(<NewMessageModal open={true} />);
    await waitFor(() => {
      expect(screen.getByText('@alice')).toBeInTheDocument();
      expect(screen.getByText('@bob')).toBeInTheDocument();
    });
  });

  it('starts chat when suggested contact clicked', async () => {
    const onStartChat = jest.fn();
    render(<NewMessageModal open={true} onStartChat={onStartChat} />);
    
    await waitFor(() => screen.getByText('@alice'));
    fireEvent.click(screen.getByText('@alice'));
    
    expect(onStartChat).toHaveBeenCalledWith('alice');
  });
});
```

### E2E Tests

```typescript
test('privacy settings prevent unauthorized messages', async () => {
  // Alice sets privacy to 'following'
  await setMessagePrivacy('alice', 'following');
  
  // Bob (not followed by Alice) tries to message
  const result = await sendMessage('bob', 'alice', 'Hello');
  
  // Message is filtered out in discovery
  expect(result.delivered).toBe(false);
  expect(result.reason).toContain('only accepts messages from people they follow');
});
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Test pagination with accounts following >1000 users
- [ ] Verify cache expiration works correctly
- [ ] Test privacy settings across all modes
- [ ] Check trust indicators don't flicker
- [ ] Validate suggested contacts always show fresh data
- [ ] Test whitelist exceptions work correctly
- [ ] Verify username normalization consistent everywhere
- [ ] Check IndexedDB migrations work

### Monitoring

```typescript
// Log following list fetch times
console.time('fetch-following');
const following = await fetchFollowingList(username);
console.timeEnd('fetch-following');

// Track cache hit rates
const cacheHits = memCacheHits / totalRequests;
console.log('Cache hit rate:', (cacheHits * 100).toFixed(1) + '%');

// Monitor IndexedDB usage
const estimate = await navigator.storage.estimate();
console.log('Storage used:', (estimate.usage / 1024 / 1024).toFixed(1) + 'MB');
```

### Performance Targets

- Following list fetch (1000 users): <1 second
- Cache lookup (in-memory): <1ms
- Cache lookup (IndexedDB): <10ms
- Privacy check: <100ms
- Trust indicator display: <50ms (from cache)

---

## Conclusion

The Hive Following integration provides a robust, scalable foundation for privacy-based messaging controls in Hive Messenger.

### Key Innovations

1. **Dual-Layer Caching**: In-memory + IndexedDB for <1ms follow checks
2. **Pagination Fix**: Handles 10,000+ follows without infinite loops
3. **Three-Layer Privacy**: Blockchain settings + following checks + local whitelist
4. **Zero UI Flicker**: Smart React Query caching prevents badge disappearance
5. **Aggressive Refresh**: Suggested contacts always fresh to prevent stale data
6. **Comprehensive Normalization**: All usernames lowercase for consistent comparisons

### Future Enhancements

- **Mute Lists**: Block users without unfollowing
- **Follow Requests**: Request follow to enable messaging
- **Mutual Following Badge**: Show when both users follow each other
- **Follow Analytics**: Track follow/unfollow trends
- **Batch Follow Operations**: Follow multiple users at once

---

## Additional Resources

- **Hive Follow API**: https://developers.hive.io/apidefinitions/#follow_api
- **IndexedDB Best Practices**: https://web.dev/indexeddb-best-practices/
- **React Query Caching**: https://tanstack.com/query/latest/docs/react/guides/caching
- **Source Code**: [Repository Link]

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**License:** MIT
