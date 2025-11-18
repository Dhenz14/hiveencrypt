/**
 * Debug script to diagnose why curatorhulk doesn't see group messages
 * Run this in the browser console after logging in as curatorhulk
 */

import { hiveClient } from '@/lib/hiveClient';
import { parseGroupMessageMemo } from '@/lib/groupBlockchain';
import { getAllGroupMessages } from '@/lib/messageCache';

export async function debugCuratorhulk() {
  const username = 'curatorhulk';
  
  console.log('=== DEBUGGING CURATORHULK GROUP DISCOVERY ===');
  
  // Step 1: Check cached group messages
  console.log('\n1. Checking cached group messages...');
  try {
    const cachedMessages = await getAllGroupMessages(username);
    console.log(`Found ${cachedMessages.length} cached group messages:`, cachedMessages);
  } catch (error) {
    console.error('Error fetching cached messages:', error);
  }
  
  // Step 2: Fetch recent transfers from blockchain
  console.log('\n2. Fetching recent transfers from blockchain...');
  try {
    const history = await hiveClient.getAccountHistory(
      username,
      50, // Just check last 50 for now
      'transfers', // filter only transfer operations
      -1
    );
    
    console.log(`Found ${history.length} transfers`);
    
    // Step 3: Check each transfer for group messages
    console.log('\n3. Analyzing transfers for group message format...');
    const groupTransfers = [];
    const encryptedMemos = [];
    
    for (const [, operation] of history) {
      const op = operation[1].op;
      if (op[0] !== 'transfer') continue;
      
      const transfer = op[1];
      const memo = transfer.memo;
      const txId = operation[1].trx_id;
      
      // Check if incoming
      if (transfer.to === username) {
        console.log(`\nIncoming transfer from ${transfer.from}:`);
        console.log(`  TxID: ${txId}`);
        console.log(`  Memo: ${memo?.substring(0, 50)}...`);
        console.log(`  Encrypted: ${memo?.startsWith('#')}`);
        
        if (memo?.startsWith('#')) {
          encryptedMemos.push({
            from: transfer.from,
            txId,
            memo: memo.substring(0, 50) + '...',
          });
        }
      }
    }
    
    console.log(`\nFound ${encryptedMemos.length} encrypted incoming memos`);
    console.log('Encrypted memos:', encryptedMemos);
    
  } catch (error) {
    console.error('Error fetching blockchain history:', error);
  }
  
  console.log('\n=== DEBUG COMPLETE ===');
}

// Make it available in window for console access
if (typeof window !== 'undefined') {
  (window as any).debugCuratorhulk = debugCuratorhulk;
}
