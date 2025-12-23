// GitHub Push Script - Uses Replit's GitHub connection token
// Usage: npx tsx scripts/push-to-github.ts "Your commit message"

import { execSync } from 'child_process';

async function getAccessToken(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken || !hostname) {
    throw new Error('Replit connection environment not available');
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=github`,
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  const data = await response.json();
  const settings = data.items?.[0]?.settings;
  const token = settings?.access_token || settings?.oauth?.credentials?.access_token;

  if (!token) {
    throw new Error('GitHub not connected - please connect GitHub in Replit');
  }
  return token;
}

async function pushToGitHub() {
  const owner = 'Dhenz14';
  const repo = 'hiveencrypt';
  const commitMessage = process.argv[2] || 'Update from Replit';
  
  console.log('🔑 Getting GitHub access token...');
  const token = await getAccessToken();
  
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  
  try {
    // Stage all changes
    console.log('📦 Staging changes...');
    execSync('git add -A', { stdio: 'inherit' });
    
    // Commit
    console.log(`📝 Committing: "${commitMessage}"`);
    try {
      execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
    } catch {
      console.log('ℹ️  Nothing new to commit');
    }
    
    // Push
    console.log('🚀 Pushing to GitHub...');
    execSync(`git push ${authUrl} main`, { stdio: 'pipe' });
    
    console.log('✅ Successfully pushed to GitHub!');
    console.log(`🔗 https://github.com/${owner}/${repo}`);
  } catch (error: any) {
    // Don't show token in error
    console.error('❌ Push failed:', error.message?.replace(token, '***'));
    process.exit(1);
  }
}

pushToGitHub().catch(error => {
  console.error('❌ Failed:', error.message);
  process.exit(1);
});
