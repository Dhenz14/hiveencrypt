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
  const commitMessage = process.argv[2] || 'Update from Replit';
  
  console.log('Getting GitHub access token...');
  const accessToken = await getAccessToken();
  console.log('Token obtained successfully');
  
  const authUrl = `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`;
  
  try {
    // Stage all changes
    console.log('Staging changes...');
    execSync('git add -A', { stdio: 'inherit' });
    
    // Commit with message
    console.log(`Committing: "${commitMessage}"`);
    try {
      execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
    } catch (e) {
      console.log('Nothing to commit or already committed');
    }
    
    // Push to GitHub
    console.log('Pushing to GitHub...');
    execSync(`git push ${authUrl} main --force`, { stdio: 'pipe' });
    console.log('✅ Successfully pushed to GitHub!');
    console.log(`View at: https://github.com/${owner}/${repo}`);
  } catch (error: any) {
    console.error('Push failed:', error.message);
    process.exit(1);
  }
}

pushToGitHub().catch(error => {
  console.error('Failed:', error.message);
  process.exit(1);
});
