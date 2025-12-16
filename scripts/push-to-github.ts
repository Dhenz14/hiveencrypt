// GitHub Push Script - Uses Replit's GitHub integration via Contents API
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken(): Promise<string> {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

// Get all files to push (respecting .gitignore)
function getFilesToPush(): string[] {
  try {
    const output = execSync('git ls-files', { encoding: 'utf-8' });
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch (error) {
    console.error('Error getting files:', error);
    return [];
  }
}

async function pushToGitHub() {
  const owner = 'Dhenz14';
  const repo = 'hiveencrypt';
  
  console.log('Getting GitHub access token...');
  const accessToken = await getAccessToken();
  console.log('Token obtained successfully');
  
  // Output the authenticated URL for the user to use
  const authUrl = `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`;
  
  console.log('\n📋 To push to GitHub, run this command in the Shell:');
  console.log('─'.repeat(60));
  console.log(`git push ${authUrl} main --force`);
  console.log('─'.repeat(60));
  console.log('\nThis command uses your authenticated GitHub connection.');
  console.log(`\nAfter pushing, view your repo at: https://github.com/${owner}/${repo}`);
}

pushToGitHub().catch(error => {
  console.error('Failed:', error.message);
  process.exit(1);
});
