# Contributing to Hive Messenger

Thank you for your interest in contributing to Hive Messenger! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Be kind, constructive, and professional in all interactions.

---

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up the development environment** (see below)
4. **Create a branch** for your work
5. **Make your changes** with clear commits
6. **Submit a pull request**

---

## How to Contribute

### Types of Contributions

| Contribution | Description |
|--------------|-------------|
| Bug Fixes | Fix issues and improve stability |
| Features | Add new functionality |
| Documentation | Improve README, comments, guides |
| Testing | Add or improve test coverage |
| Performance | Optimize speed and efficiency |
| Accessibility | Improve a11y compliance |
| Translations | Add language support |

### What We're Looking For

- Clean, readable code
- Well-tested changes
- Documentation for new features
- Backward compatibility when possible
- Alignment with project goals (decentralization, privacy, security)

---

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git
- Hive Keychain browser extension (for testing)
- A Hive account (for testing)

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/hiveencrypt.git
cd hiveencrypt

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5000`

### Project Structure

```
hiveencrypt/
├── client/                 # Frontend React app
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── lib/            # Utility libraries
│   │   ├── pages/          # Page components
│   │   └── App.tsx         # Main app component
│   └── public/             # Static assets
├── server/                 # Express server (minimal)
├── shared/                 # Shared types/schemas
└── README.md
```

### Key Files

| File | Purpose |
|------|---------|
| `client/src/lib/hive.ts` | Hive blockchain interactions |
| `client/src/lib/hiveClient.ts` | RPC client with failover |
| `client/src/lib/encryption.ts` | Memo encryption utilities |
| `client/src/lib/messageCache.ts` | IndexedDB caching |
| `client/src/hooks/useBlockchainMessages.ts` | Message fetching |
| `client/src/hooks/useGroupMessages.ts` | Group chat logic |

---

## Code Style

### TypeScript

- Use TypeScript for all new code
- Define proper types/interfaces
- Avoid `any` types when possible
- Use descriptive variable names

```typescript
// Good
interface MessageData {
  id: string;
  content: string;
  timestamp: Date;
  sender: string;
}

// Avoid
const data: any = fetchData();
```

### React

- Use functional components with hooks
- Keep components focused and small
- Extract logic into custom hooks
- Use proper dependency arrays in useEffect

```typescript
// Good
function MessageList({ conversationId }: { conversationId: string }) {
  const { messages, isLoading } = useMessages(conversationId);
  
  if (isLoading) return <Skeleton />;
  
  return (
    <div>
      {messages.map(msg => <Message key={msg.id} data={msg} />)}
    </div>
  );
}
```

### Styling

- Use Tailwind CSS utility classes
- Use Shadcn UI components when available
- Keep responsive design in mind
- Support dark mode

```typescript
// Good - uses Tailwind and is responsive
<div className="flex flex-col gap-4 p-4 md:flex-row md:p-6">

// Avoid - inline styles
<div style={{ display: 'flex', padding: '16px' }}>
```

### Comments

- Comment complex logic
- Use JSDoc for functions
- Explain "why" not just "what"

```typescript
/**
 * Decrypts a Hive memo using the user's memo key
 * @param encryptedMemo - The memo starting with #
 * @param privateKey - User's memo private key
 * @returns Decrypted message content
 */
function decryptMemo(encryptedMemo: string, privateKey: string): string {
  // Memos starting with # are encrypted, otherwise plain text
  if (!encryptedMemo.startsWith('#')) {
    return encryptedMemo;
  }
  // ...
}
```

---

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add group broadcast messaging

- Add broadcast button to group chat header
- Implement batch message sending
- Add confirmation dialog for broadcasts
```

### Format

```
type: short description

[optional body with more details]

[optional footer with references]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting) |
| `refactor` | Code restructuring |
| `perf` | Performance improvements |
| `test` | Adding/updating tests |
| `chore` | Maintenance tasks |

---

## Pull Request Process

1. **Update your fork** with the latest main branch
2. **Create a feature branch** from main
3. **Make your changes** with clear commits
4. **Test thoroughly** in different browsers
5. **Update documentation** if needed
6. **Submit PR** with clear description

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Changes are tested and working
- [ ] Documentation updated if needed
- [ ] No console errors or warnings
- [ ] Responsive design works on mobile
- [ ] Dark mode works correctly
- [ ] No security vulnerabilities introduced

### PR Description Template

```markdown
## Description
[What does this PR do?]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Other: [describe]

## Testing
[How did you test this?]

## Screenshots (if applicable)
[Add screenshots for UI changes]
```

---

## Reporting Bugs

### Before Reporting

1. Check existing issues for duplicates
2. Try to reproduce the bug
3. Test on latest version
4. Gather relevant information

### Bug Report Template

```markdown
## Bug Description
[Clear description of the bug]

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. See error

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- Browser: [e.g., Chrome 120]
- OS: [e.g., Windows 11]
- Keychain Version: [e.g., 1.0.0]

## Screenshots
[If applicable]

## Console Errors
[Any error messages from browser console]
```

---

## Suggesting Features

### Feature Request Template

```markdown
## Feature Description
[Clear description of the feature]

## Problem It Solves
[Why is this feature needed?]

## Proposed Solution
[How should it work?]

## Alternatives Considered
[Other approaches considered]

## Additional Context
[Any other relevant information]
```

---

## Security

If you discover a security vulnerability, please do NOT open a public issue. Instead, report it privately to the maintainers.

See [SECURITY.md](SECURITY.md) for details.

---

## Questions?

- Open an issue for questions
- Reach out on Hive: [@dhenz14](https://peakd.com/@dhenz14)

---

Thank you for contributing to decentralized, private communication!
