"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerFastPolling = exports.registerFastPollingTrigger = void 0;
exports.useBlockchainMessages = useBlockchainMessages;
exports.useConversationDiscovery = useConversationDiscovery;
var react_query_1 = require("@tanstack/react-query");
var AuthContext_1 = require("@/contexts/AuthContext");
var hive_1 = require("@/lib/hive");
var messageCache_1 = require("@/lib/messageCache");
var queryClient_1 = require("@/lib/queryClient");
var react_1 = require("react");
var logger_1 = require("@/lib/logger");
var accountMetadata_1 = require("@/lib/accountMetadata");
var useExceptionsList_1 = require("@/hooks/useExceptionsList");
function useBlockchainMessages(_a) {
    var _this = this;
    var partnerUsername = _a.partnerUsername, _b = _a.enabled, enabled = _b === void 0 ? true : _b;
    var user = (0, AuthContext_1.useAuth)().user;
    var isException = (0, useExceptionsList_1.useExceptionsList)().isException; // Check if contact is on exceptions list (from context)
    var _c = (0, react_1.useState)(true), isActive = _c[0], setIsActive = _c[1];
    var _d = (0, react_1.useState)(0), lastSendTime = _d[0], setLastSendTime = _d[1];
    var _e = (0, react_1.useState)(Date.now()), lastActivityTime = _e[0], setLastActivityTime = _e[1];
    // Listen for exceptions changes and invalidate query to trigger re-evaluation
    (0, react_1.useEffect)(function () {
        var handleExceptionsChanged = function (event) {
            var _a;
            if ((user === null || user === void 0 ? void 0 : user.username) && ((_a = event.detail) === null || _a === void 0 ? void 0 : _a.username) === user.username) {
                console.log('[useBlockchainMessages] Exceptions changed, invalidating query for re-evaluation');
                queryClient_1.queryClient.invalidateQueries({
                    queryKey: ['blockchain-messages', user.username, partnerUsername]
                });
            }
        };
        window.addEventListener('exceptionsChanged', handleExceptionsChanged);
        return function () {
            window.removeEventListener('exceptionsChanged', handleExceptionsChanged);
        };
    }, [user === null || user === void 0 ? void 0 : user.username, partnerUsername]);
    (0, react_1.useEffect)(function () {
        var handleVisibilityChange = function () {
            setIsActive(!document.hidden);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return function () {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);
    // Track user activity for adaptive polling
    (0, react_1.useEffect)(function () {
        var handleActivity = function () {
            setLastActivityTime(Date.now());
        };
        // Update activity time on mouse/keyboard events
        window.addEventListener('mousemove', handleActivity);
        window.addEventListener('keypress', handleActivity);
        return function () {
            window.removeEventListener('mousemove', handleActivity);
            window.removeEventListener('keypress', handleActivity);
        };
    }, []);
    // Register fast polling trigger for MessageComposer
    (0, react_1.useEffect)(function () {
        (0, exports.registerFastPollingTrigger)(function () { return setLastSendTime(Date.now()); });
        return function () { return (0, exports.registerFastPollingTrigger)(function () { }); };
    }, []);
    // TIER 1 OPTIMIZATION: Pre-populate React Query cache with cached messages for instant display
    // Removed immediate invalidation - let staleTime control when to refetch
    (0, react_1.useEffect)(function () {
        if ((user === null || user === void 0 ? void 0 : user.username) && partnerUsername && enabled) {
            (0, messageCache_1.getMessagesByConversation)(user.username, partnerUsername).then(function (cachedMessages) {
                if (cachedMessages.length > 0) {
                    // PHASE 4.1: Filter out hidden messages for instant display
                    var visibleCached = cachedMessages.filter(function (msg) { return !msg.hidden; });
                    var hiddenCachedCount = cachedMessages.length - visibleCached.length;
                    logger_1.logger.info('[MESSAGES] Pre-populating cache with', visibleCached.length, 'visible messages (', hiddenCachedCount, 'hidden)');
                    var queryKey = ['blockchain-messages', user.username, partnerUsername];
                    // Seed cache with cached data (shows instantly) - new format with hiddenCount
                    queryClient_1.queryClient.setQueryData(queryKey, {
                        messages: visibleCached,
                        hiddenCount: hiddenCachedCount,
                    });
                    // OPTIMIZATION: Don't immediately invalidate - let staleTime/refetchInterval handle it
                    // This prevents excessive refetches on tab switch / component remount
                }
            });
        }
    }, [user === null || user === void 0 ? void 0 : user.username, partnerUsername, enabled]);
    var query = (0, react_query_1.useQuery)({
        queryKey: ['blockchain-messages', user === null || user === void 0 ? void 0 : user.username, partnerUsername],
        queryFn: function () { return __awaiter(_this, void 0, void 0, function () {
            var userMinimumHBD, messagePrivacy, userFollowingList, metadata, getFollowingList, error_1, parseHBDAmount, userMinimumAmount, cachedMessages, mergedMessages, conversationKey, _a, getLastSyncedOpId, setLastSyncedOpId, lastSyncedOpId, blockchainMessages, newMessagesToCache_1, highestOpId, _i, blockchainMessages_1, msg, messageCache, messageAmount, senderIsException, shouldHide, recipientFollowsSender, messageCache, blockchainError_1, reEvaluatedCount, allMessages, visibleMessages, hiddenCount, lastMessage;
            var _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        logger_1.logger.info('[QUERY] Starting blockchain messages query for:', { username: user === null || user === void 0 ? void 0 : user.username, partner: partnerUsername });
                        if (!(user === null || user === void 0 ? void 0 : user.username)) {
                            throw new Error('User not authenticated');
                        }
                        userMinimumHBD = accountMetadata_1.DEFAULT_MINIMUM_HBD;
                        messagePrivacy = 'everyone';
                        userFollowingList = [];
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 6, , 7]);
                        return [4 /*yield*/, (0, accountMetadata_1.getAccountMetadata)(user.username)];
                    case 2:
                        metadata = _d.sent();
                        userMinimumHBD = (0, accountMetadata_1.parseMinimumHBD)(metadata);
                        messagePrivacy = ((_c = (_b = metadata.profile) === null || _b === void 0 ? void 0 : _b.hive_messenger) === null || _c === void 0 ? void 0 : _c.message_privacy) || 'everyone';
                        logger_1.logger.info('[FILTER] User minimum HBD:', userMinimumHBD, 'Message privacy:', messagePrivacy);
                        if (!(messagePrivacy === 'following')) return [3 /*break*/, 5];
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@/lib/hiveFollowing'); })];
                    case 3:
                        getFollowingList = (_d.sent()).getFollowingList;
                        return [4 /*yield*/, getFollowingList(user.username)];
                    case 4:
                        userFollowingList = _d.sent();
                        logger_1.logger.info('[FILTER] Loaded following list:', userFollowingList.length, 'accounts');
                        _d.label = 5;
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        error_1 = _d.sent();
                        logger_1.logger.warn('[FILTER] Failed to load user preferences, using defaults:', error_1);
                        return [3 /*break*/, 7];
                    case 7:
                        parseHBDAmount = function (amountString) {
                            // Amount format: "0.001 HBD" or "1.000 HBD"
                            var parts = amountString.trim().split(' ');
                            if (parts.length === 2 && parts[1] === 'HBD') {
                                return parseFloat(parts[0]);
                            }
                            return 0;
                        };
                        userMinimumAmount = parseHBDAmount(userMinimumHBD);
                        return [4 /*yield*/, (0, messageCache_1.getMessagesByConversation)(user.username, partnerUsername)];
                    case 8:
                        cachedMessages = _d.sent();
                        logger_1.logger.info('[QUERY] Retrieved cached messages:', cachedMessages.length);
                        cachedMessages.forEach(function (msg, idx) {
                            logger_1.logger.sensitive("[QUERY] Cached msg ".concat(idx, ":"), {
                                id: msg.id.substring(0, 15) + '...',
                                from: msg.from,
                                contentPreview: msg.content.substring(0, 50) + '...',
                                contentLength: msg.content.length
                            });
                        });
                        mergedMessages = new Map();
                        cachedMessages.forEach(function (msg) {
                            // Detect and fix corrupted messages where content contains encrypted data
                            // If message is marked as decrypted, trust it - user manually decrypted it
                            if (!msg.isDecrypted) {
                                var isCorrupted = false;
                                // Case 0: content starts with # (encrypted memo format) - THIS IS THE MOST OBVIOUS CASE!
                                if (msg.content && msg.content.startsWith('#')) {
                                    logger_1.logger.info('[QUERY] Corrupted (case 0): content starts with # (encrypted memo), msg:', msg.id.substring(0, 20));
                                    isCorrupted = true;
                                }
                                // Case 1: content exactly matches encryptedContent (most obvious corruption)
                                if (!isCorrupted && msg.content === msg.encryptedContent && msg.encryptedContent) {
                                    logger_1.logger.info('[QUERY] Corrupted (case 1): content === encryptedContent, msg:', msg.id.substring(0, 20));
                                    isCorrupted = true;
                                }
                                // Case 2: content looks like encrypted data (long gibberish without spaces)
                                // Encrypted memos are typically 100+ chars of base64-like data
                                if (!isCorrupted && msg.content && msg.content.length > 50) {
                                    var hasSpaces = msg.content.includes(' ');
                                    var hasCommonWords = /\b(the|is|are|was|were|hello|hi|you|me|we|they)\b/i.test(msg.content);
                                    var looksLikeEncrypted = !hasSpaces && !hasCommonWords && msg.content.length > 80;
                                    if (looksLikeEncrypted && msg.encryptedContent && msg.encryptedContent.length > 80) {
                                        logger_1.logger.info('[QUERY] Corrupted (case 2): content looks encrypted, msg:', msg.id.substring(0, 20));
                                        isCorrupted = true;
                                    }
                                }
                                // Case 3: content is encrypted placeholder but doesn't match our standard format
                                if (!isCorrupted && msg.content && msg.content.includes('[Encrypted') &&
                                    msg.content !== '[🔒 Encrypted - Click to decrypt]') {
                                    logger_1.logger.info('[QUERY] Corrupted (case 3): non-standard placeholder, msg:', msg.id.substring(0, 20));
                                    isCorrupted = true;
                                }
                                if (isCorrupted) {
                                    logger_1.logger.info('[QUERY] FIXING corrupted message, setting placeholder');
                                    msg.content = '[🔒 Encrypted - Click to decrypt]';
                                    (0, messageCache_1.cacheMessage)(msg, user.username).catch(function (err) { return logger_1.logger.error('[QUERY] Failed to fix message:', err); });
                                }
                            }
                            mergedMessages.set(msg.id, msg);
                        });
                        _d.label = 9;
                    case 9:
                        _d.trys.push([9, 17, , 18]);
                        conversationKey = (0, messageCache_1.getConversationKey)(user.username, partnerUsername);
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@/lib/messageCache'); })];
                    case 10:
                        _a = _d.sent(), getLastSyncedOpId = _a.getLastSyncedOpId, setLastSyncedOpId = _a.setLastSyncedOpId;
                        return [4 /*yield*/, getLastSyncedOpId(conversationKey, user.username)];
                    case 11:
                        lastSyncedOpId = _d.sent();
                        // CRITICAL FIX: If no cached messages exist, ignore lastSyncedOpId to fetch ALL messages
                        // This handles case where user cleared messages but metadata persisted
                        if (cachedMessages.length === 0) {
                            logger_1.logger.info('[QUERY] No cached messages - fetching ALL from blockchain (ignoring lastSyncedOpId)');
                            lastSyncedOpId = null;
                        }
                        return [4 /*yield*/, (0, hive_1.getConversationMessages)(user.username, partnerUsername, 200, // Always fetch last 200, filter for new ones
                            lastSyncedOpId)];
                    case 12:
                        blockchainMessages = _d.sent();
                        newMessagesToCache_1 = [];
                        highestOpId = lastSyncedOpId || 0;
                        for (_i = 0, blockchainMessages_1 = blockchainMessages; _i < blockchainMessages_1.length; _i++) {
                            msg = blockchainMessages_1[_i];
                            // TIER 2: Track highest operation ID for incremental sync
                            if (msg.index > highestOpId) {
                                highestOpId = msg.index;
                            }
                            if (mergedMessages.has(msg.trx_id)) {
                                continue;
                            }
                            // CRITICAL: Skip group messages - they should ONLY appear in group conversations
                            // Check if memo looks like a group message (will be handled by group discovery)
                            if (msg.memo && msg.memo.startsWith('#')) {
                                // This is an encrypted memo that MIGHT be a group message
                                // We can't check without decrypting, but group discovery will handle it
                                // For now, we cache it and the migration will move it if needed
                                logger_1.logger.info('[QUERY] Found encrypted memo, caching as placeholder (migration will fix if group message):', msg.trx_id.substring(0, 20));
                            }
                            if (msg.from === user.username) {
                                messageCache = {
                                    id: msg.trx_id,
                                    conversationKey: conversationKey,
                                    from: msg.from,
                                    to: msg.to,
                                    content: '[🔒 Encrypted - Click to decrypt]',
                                    encryptedContent: msg.memo,
                                    timestamp: msg.timestamp,
                                    txId: msg.trx_id,
                                    confirmed: true,
                                    amount: msg.amount, // Store HBD transfer amount
                                };
                                newMessagesToCache_1.push(messageCache);
                                mergedMessages.set(msg.trx_id, messageCache);
                            }
                            else {
                                messageAmount = parseHBDAmount(msg.amount || '0.000 HBD');
                                senderIsException = isException(msg.from);
                                shouldHide = !senderIsException && messageAmount < userMinimumAmount;
                                // Privacy filtering (only if not already hidden by HBD filter)
                                if (!shouldHide && messagePrivacy === 'disabled') {
                                    // Disabled: Hide all incoming messages (except exceptions)
                                    shouldHide = !senderIsException;
                                    if (shouldHide) {
                                        logger_1.logger.info('[PRIVACY] Hiding message (privacy=disabled):', {
                                            txId: msg.trx_id.substring(0, 20),
                                            from: msg.from
                                        });
                                    }
                                }
                                else if (!shouldHide && messagePrivacy === 'following') {
                                    recipientFollowsSender = userFollowingList.includes(msg.from.toLowerCase());
                                    shouldHide = !senderIsException && !recipientFollowsSender;
                                    if (shouldHide) {
                                        logger_1.logger.info('[PRIVACY] Hiding message (privacy=following, not followed):', {
                                            txId: msg.trx_id.substring(0, 20),
                                            from: msg.from
                                        });
                                    }
                                }
                                if (shouldHide && messageAmount < userMinimumAmount) {
                                    logger_1.logger.info('[FILTER] Hiding message below minimum:', {
                                        txId: msg.trx_id.substring(0, 20),
                                        from: msg.from,
                                        amount: msg.amount,
                                        minimum: userMinimumHBD
                                    });
                                }
                                else if (senderIsException && (messageAmount < userMinimumAmount || messagePrivacy !== 'everyone')) {
                                    logger_1.logger.info('[FILTER] Showing message from exception despite filters:', {
                                        txId: msg.trx_id.substring(0, 20),
                                        from: msg.from,
                                        amount: msg.amount,
                                        privacy: messagePrivacy
                                    });
                                }
                                messageCache = {
                                    id: msg.trx_id,
                                    conversationKey: conversationKey,
                                    from: msg.from,
                                    to: msg.to,
                                    content: '[🔒 Encrypted - Click to decrypt]',
                                    encryptedContent: msg.memo,
                                    timestamp: msg.timestamp,
                                    txId: msg.trx_id,
                                    confirmed: true,
                                    amount: msg.amount, // Store HBD transfer amount
                                    hidden: shouldHide, // Mark as hidden if below minimum AND not exception
                                };
                                newMessagesToCache_1.push(messageCache);
                                mergedMessages.set(msg.trx_id, messageCache);
                            }
                        }
                        if (!(newMessagesToCache_1.length > 0)) return [3 /*break*/, 14];
                        logger_1.logger.info('[QUERY] Batching', newMessagesToCache_1.length, 'new messages for single IndexedDB write');
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@/lib/messageCache'); }).then(function (_a) {
                                var cacheMessages = _a.cacheMessages;
                                return cacheMessages(newMessagesToCache_1, user.username);
                            })];
                    case 13:
                        _d.sent();
                        _d.label = 14;
                    case 14:
                        if (!(highestOpId > (lastSyncedOpId || 0))) return [3 /*break*/, 16];
                        return [4 /*yield*/, setLastSyncedOpId(conversationKey, highestOpId, user.username)];
                    case 15:
                        _d.sent();
                        _d.label = 16;
                    case 16: return [3 /*break*/, 18];
                    case 17:
                        blockchainError_1 = _d.sent();
                        logger_1.logger.error('Failed to fetch from blockchain, using cached data:', blockchainError_1);
                        return [3 /*break*/, 18];
                    case 18:
                        // PHASE 4 FIX + EXCEPTIONS: Re-evaluate ALL messages (cached + new) against current user minimum
                        // This ensures that when user changes their minimum threshold OR exceptions list, cached messages are updated
                        logger_1.logger.info('[PHASE4] Re-evaluating', mergedMessages.size, 'messages against current minimum:', userMinimumHBD);
                        reEvaluatedCount = 0;
                        mergedMessages.forEach(function (msg, id) {
                            if (msg.from !== user.username) {
                                // RECEIVED message: Re-evaluate against current minimum, exceptions AND privacy settings
                                var msgAmount = parseHBDAmount(msg.amount || '0.000 HBD');
                                var senderIsException = isException(msg.from);
                                // First check HBD minimum (unless exception)
                                var isHidden = !senderIsException && msgAmount < userMinimumAmount;
                                // Then apply privacy filters (only if not already hidden)
                                if (!isHidden && messagePrivacy === 'disabled') {
                                    // Disabled: Hide all incoming messages (except exceptions)
                                    isHidden = !senderIsException;
                                }
                                else if (!isHidden && messagePrivacy === 'following') {
                                    // Following-only: Hide if recipient doesn't follow sender (except exceptions)
                                    var recipientFollowsSender = userFollowingList.includes(msg.from.toLowerCase());
                                    isHidden = !senderIsException && !recipientFollowsSender;
                                }
                                // Only update if hidden state changed
                                if (msg.hidden !== isHidden) {
                                    mergedMessages.set(id, __assign(__assign({}, msg), { hidden: isHidden }));
                                    reEvaluatedCount++;
                                    logger_1.logger.info('[PHASE4] Updated hidden flag:', {
                                        txId: msg.id.substring(0, 20),
                                        from: msg.from,
                                        amount: msg.amount,
                                        isException: senderIsException,
                                        oldHidden: msg.hidden,
                                        newHidden: isHidden
                                    });
                                }
                            }
                            else {
                                // SENT message: Always visible (never hide sent messages)
                                if (msg.hidden !== false) {
                                    mergedMessages.set(id, __assign(__assign({}, msg), { hidden: false }));
                                    reEvaluatedCount++;
                                }
                            }
                        });
                        logger_1.logger.info('[PHASE4] Re-evaluated', reEvaluatedCount, 'messages with changed hidden state');
                        allMessages = Array.from(mergedMessages.values()).sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); });
                        visibleMessages = allMessages.filter(function (msg) { return !msg.hidden; });
                        hiddenCount = allMessages.length - visibleMessages.length;
                        logger_1.logger.info('[QUERY] Total messages:', allMessages.length, 'Visible:', visibleMessages.length, 'Hidden:', hiddenCount);
                        if (!(visibleMessages.length > 0)) return [3 /*break*/, 20];
                        lastMessage = visibleMessages[visibleMessages.length - 1];
                        return [4 /*yield*/, (0, messageCache_1.updateConversation)({
                                conversationKey: (0, messageCache_1.getConversationKey)(user.username, partnerUsername),
                                partnerUsername: partnerUsername,
                                lastMessage: lastMessage.content,
                                lastTimestamp: lastMessage.timestamp,
                                unreadCount: 0,
                                lastChecked: new Date().toISOString(),
                            }, user.username)];
                    case 19:
                        _d.sent();
                        _d.label = 20;
                    case 20: 
                    // PHASE 4.1: Return object with filtered messages and hidden count
                    return [2 /*return*/, {
                            messages: visibleMessages,
                            hiddenCount: hiddenCount,
                        }];
                }
            });
        }); },
        enabled: enabled && !!(user === null || user === void 0 ? void 0 : user.username) && !!partnerUsername,
        refetchInterval: function (data) {
            var now = Date.now();
            var timeSinceLastSend = now - lastSendTime;
            var timeSinceActivity = now - lastActivityTime;
            // Background tab: faster polling for better message delivery
            if (!isActive)
                return 20000; // 20 seconds (was 45s)
            // Burst mode: Fast polling for 15 seconds after sending a message
            if (timeSinceLastSend < 15000) {
                return 3000; // 3 seconds for instant feedback
            }
            // Active conversation: Recent activity (typing, viewing)
            if (timeSinceActivity < 60000) {
                return 4000; // 4 seconds (was 5s) - snappier experience
            }
            // Idle conversation: No recent activity
            return 10000; // 10 seconds (was 15s) - better responsiveness
        },
        staleTime: 6000, // 6 seconds (was 12s) - fresher data on each poll
        gcTime: 300000, // TIER 1 OPTIMIZATION: 5 minutes (was default) - keep in memory longer
        refetchOnWindowFocus: 'always', // Still refetch on focus for freshness
    });
    return query;
}
function useConversationDiscovery() {
    var _this = this;
    var user = (0, AuthContext_1.useAuth)().user;
    var _a = (0, react_1.useState)(true), isActive = _a[0], setIsActive = _a[1];
    var _b = (0, react_1.useState)([]), cachedConversations = _b[0], setCachedConversations = _b[1];
    (0, react_1.useEffect)(function () {
        var handleVisibilityChange = function () {
            setIsActive(!document.hidden);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return function () {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);
    // PERFORMANCE FIX: Load cached conversations immediately on mount
    (0, react_1.useEffect)(function () {
        if (user === null || user === void 0 ? void 0 : user.username) {
            Promise.resolve().then(function () { return require('@/lib/messageCache'); }).then(function (_a) {
                var getConversations = _a.getConversations;
                getConversations(user.username).then(function (cached) {
                    logger_1.logger.debug('[CONV DISCOVERY] Loaded', cached.length, 'cached conversations immediately');
                    setCachedConversations(cached);
                });
            });
        }
    }, [user === null || user === void 0 ? void 0 : user.username]);
    var query = (0, react_query_1.useQuery)({
        queryKey: ['blockchain-conversations', user === null || user === void 0 ? void 0 : user.username],
        // PERFORMANCE FIX: Return cached data immediately if available
        initialData: cachedConversations.length > 0 ? cachedConversations : undefined,
        queryFn: function () { return __awaiter(_this, void 0, void 0, function () {
            var phase1Start, phase1Partners, phase1Cached, phase1Uncached, phase1NewConversations, phase1Conversations;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(user === null || user === void 0 ? void 0 : user.username)) {
                            throw new Error('User not authenticated');
                        }
                        logger_1.logger.debug('[CONV DISCOVERY] Starting progressive discovery for user:', user.username);
                        // TIER 3 OPTIMIZATION: Progressive Loading - Two-phase discovery
                        // Phase 1: Quick scan of recent 50 operations (5-7 seconds)
                        // Phase 2: Full scan of 200 operations in background (runs after returning Phase 1 results)
                        // ========== PHASE 1: Quick Initial Scan (50 operations) ==========
                        logger_1.logger.debug('[PROGRESSIVE] Phase 1: Fetching recent 50 operations (quick scan)...');
                        phase1Start = performance.now();
                        return [4 /*yield*/, (0, hive_1.discoverConversations)(user.username, 50)];
                    case 1:
                        phase1Partners = _a.sent();
                        logger_1.logger.debug('[PROGRESSIVE] Phase 1 discovered', phase1Partners.length, 'partners in', Math.round(performance.now() - phase1Start), 'ms');
                        return [4 /*yield*/, Promise.all(phase1Partners.map(function (_a) {
                                var username = _a.username;
                                return (0, messageCache_1.getConversation)(user.username, username);
                            }))];
                    case 2:
                        phase1Cached = _a.sent();
                        phase1Uncached = phase1Partners.filter(function (_, index) { return !phase1Cached[index]; });
                        logger_1.logger.debug('[PROGRESSIVE] Phase 1 - Cached:', phase1Cached.filter(Boolean).length, 'Uncached:', phase1Uncached.length);
                        return [4 /*yield*/, Promise.all(phase1Uncached.map(function (_a) { return __awaiter(_this, [_a], void 0, function (_b) {
                                var newConversation;
                                var username = _b.username, lastTimestamp = _b.lastTimestamp;
                                return __generator(this, function (_c) {
                                    switch (_c.label) {
                                        case 0:
                                            newConversation = {
                                                conversationKey: (0, messageCache_1.getConversationKey)(user.username, username),
                                                partnerUsername: username,
                                                lastMessage: "New conversation with @".concat(username),
                                                lastTimestamp: lastTimestamp,
                                                unreadCount: 0,
                                                lastChecked: new Date().toISOString(),
                                            };
                                            return [4 /*yield*/, (0, messageCache_1.updateConversation)(newConversation, user.username)];
                                        case 1:
                                            _c.sent();
                                            return [2 /*return*/, newConversation];
                                    }
                                });
                            }); }))];
                    case 3:
                        phase1NewConversations = _a.sent();
                        phase1Conversations = __spreadArray(__spreadArray([], phase1Cached.filter(Boolean), true), phase1NewConversations.filter(Boolean), true);
                        logger_1.logger.debug('[PROGRESSIVE] Phase 1 complete:', phase1Conversations.length, 'conversations ready to display');
                        // ========== PHASE 2: Background Full Scan (200 operations) ==========
                        // Launch Phase 2 in background - don't await, let it run async
                        (function () { return __awaiter(_this, void 0, void 0, function () {
                            var phase2Start, queryKey, allPartners, phase1Usernames_1, newPartners, newCached_1, newUncached, newConversationsData, phase2NewConversations_1, error_2;
                            var _this = this;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 4, , 5]);
                                        logger_1.logger.debug('[PROGRESSIVE] Phase 2: Starting background scan of 200 operations...');
                                        phase2Start = performance.now();
                                        queryKey = ['blockchain-conversations', user.username];
                                        return [4 /*yield*/, (0, hive_1.discoverConversations)(user.username, 200)];
                                    case 1:
                                        allPartners = _a.sent();
                                        logger_1.logger.debug('[PROGRESSIVE] Phase 2 discovered', allPartners.length, 'total partners in', Math.round(performance.now() - phase2Start), 'ms');
                                        phase1Usernames_1 = new Set(phase1Partners.map(function (p) { return p.username; }));
                                        newPartners = allPartners.filter(function (p) { return !phase1Usernames_1.has(p.username); });
                                        if (newPartners.length === 0) {
                                            logger_1.logger.debug('[PROGRESSIVE] Phase 2: No additional partners found beyond Phase 1');
                                            return [2 /*return*/];
                                        }
                                        logger_1.logger.debug('[PROGRESSIVE] Phase 2: Found', newPartners.length, 'additional partners');
                                        return [4 /*yield*/, Promise.all(newPartners.map(function (_a) {
                                                var username = _a.username;
                                                return (0, messageCache_1.getConversation)(user.username, username);
                                            }))];
                                    case 2:
                                        newCached_1 = _a.sent();
                                        newUncached = newPartners.filter(function (_, index) { return !newCached_1[index]; });
                                        return [4 /*yield*/, Promise.all(newUncached.map(function (_a) { return __awaiter(_this, [_a], void 0, function (_b) {
                                                var newConversation;
                                                var username = _b.username, lastTimestamp = _b.lastTimestamp;
                                                return __generator(this, function (_c) {
                                                    switch (_c.label) {
                                                        case 0:
                                                            newConversation = {
                                                                conversationKey: (0, messageCache_1.getConversationKey)(user.username, username),
                                                                partnerUsername: username,
                                                                lastMessage: "New conversation with @".concat(username),
                                                                lastTimestamp: lastTimestamp,
                                                                unreadCount: 0,
                                                                lastChecked: new Date().toISOString(),
                                                            };
                                                            return [4 /*yield*/, (0, messageCache_1.updateConversation)(newConversation, user.username)];
                                                        case 1:
                                                            _c.sent();
                                                            return [2 /*return*/, newConversation];
                                                    }
                                                });
                                            }); }))];
                                    case 3:
                                        newConversationsData = _a.sent();
                                        phase2NewConversations_1 = __spreadArray(__spreadArray([], newCached_1.filter(Boolean), true), newConversationsData.filter(Boolean), true);
                                        logger_1.logger.debug('[PROGRESSIVE] Phase 2 complete: Found', phase2NewConversations_1.length, 'additional conversations');
                                        // RACE CONDITION FIX: Use functional setQueryData to merge with current cache
                                        // This prevents Phase 2 from overwriting newer refetch results
                                        queryClient_1.queryClient.setQueryData(queryKey, function (currentData) {
                                            if (!currentData) {
                                                logger_1.logger.warn('[PROGRESSIVE] Phase 2: Cache cleared, skipping update');
                                                return currentData;
                                            }
                                            // Build set of existing conversation keys to avoid duplicates
                                            var existingKeys = new Set(currentData.map(function (c) { return c.conversationKey; }));
                                            // Only add conversations that don't already exist in current cache
                                            var trulyNewConversations = phase2NewConversations_1.filter(function (c) { return c && !existingKeys.has(c.conversationKey); });
                                            if (trulyNewConversations.length === 0) {
                                                logger_1.logger.debug('[PROGRESSIVE] Phase 2: All conversations already in cache');
                                                return currentData;
                                            }
                                            logger_1.logger.debug('[PROGRESSIVE] Phase 2: Adding', trulyNewConversations.length, 'new conversations to cache');
                                            return __spreadArray(__spreadArray([], currentData, true), trulyNewConversations, true);
                                        });
                                        return [3 /*break*/, 5];
                                    case 4:
                                        error_2 = _a.sent();
                                        logger_1.logger.error('[PROGRESSIVE] Phase 2 error:', error_2);
                                        return [3 /*break*/, 5];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); })();
                        // Return Phase 1 results immediately (user sees conversations in 5-7 seconds)
                        return [2 /*return*/, phase1Conversations];
                }
            });
        }); },
        enabled: !!(user === null || user === void 0 ? void 0 : user.username),
        refetchInterval: function (data) {
            // Conversation list updates less frequently than messages
            if (!isActive)
                return 30000; // 30 seconds when hidden (was 90s)
            return 12000; // 12 seconds when active (was 20s)
        },
        staleTime: 10000, // 10 seconds (was 20s) - fresher conversation list
    });
    return query;
}
// Create a singleton ref to store the setLastSendTime function
var triggerFastPollingCallback = null;
var registerFastPollingTrigger = function (callback) {
    triggerFastPollingCallback = callback;
};
exports.registerFastPollingTrigger = registerFastPollingTrigger;
var triggerFastPolling = function () {
    if (triggerFastPollingCallback) {
        triggerFastPollingCallback();
    }
};
exports.triggerFastPolling = triggerFastPolling;
