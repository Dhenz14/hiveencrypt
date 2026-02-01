# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Hive Messenger, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please report security issues by:

1. **Hive Direct Message**: Send an encrypted message to [@dhenz14](https://peakd.com/@dhenz14) on Hive
2. **GitHub Private Advisory**: Use GitHub's private vulnerability reporting feature

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix Development**: Depends on severity
- **Public Disclosure**: After fix is deployed

---

## Security Model

### What We Protect

| Asset | Protection |
|-------|------------|
| Message Content | End-to-end encryption (AES-256-CBC) |
| Private Keys | Never transmitted, Keychain-only access |
| User Identity | Hive account public/private key pair |
| Message Metadata | Stored on public blockchain |

### What We DON'T Control

| Risk | Responsibility |
|------|----------------|
| Hive Keychain security | Keychain developers |
| RPC node reliability | Node operators |
| Blockchain consensus | Hive witnesses |
| Browser security | Browser vendors |
| Device security | User |

---

## Security Architecture

### Encryption

Hive Messenger uses Hive's native memo encryption:

```
Algorithm: ECDH + AES-256-CBC
Key Exchange: Elliptic Curve Diffie-Hellman
Key Derivation: SHA-512
Integrity: Checksum verification
```

### Key Management

- **Private keys** NEVER leave Hive Keychain
- **Signing** happens exclusively in Keychain
- **Decryption** happens exclusively in Keychain
- **No key storage** in the application

### Client-Side Only

- No backend servers storing data
- No analytics or tracking
- No centralized databases
- All logic runs in browser

---

## Known Limitations

### Metadata Visibility

While message content is encrypted, some metadata is publicly visible on the blockchain:

- Sender account
- Recipient account
- Transaction timestamp
- Transfer amount
- Transaction ID

### Blockchain Permanence

- Messages cannot be deleted from the blockchain
- Encrypted content remains forever
- Future quantum computing could theoretically break encryption

### RPC Node Trust

- RPC nodes see transaction data (not decrypted content)
- Multiple nodes used for redundancy
- No single node has special access

---

## Best Practices for Users

### Protect Your Keys

1. Use a strong Hive master password
2. Keep your private keys secure
3. Use Hive Keychain for all operations
4. Never share your private keys

### Verify the App

1. Access only via official URL
2. Check for HTTPS connection
3. Verify you're on the correct domain
4. Consider running locally for maximum security

### Message Privacy

1. Verify recipient before sending sensitive info
2. Be aware metadata is public
3. Consider the permanence of blockchain data

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (GitHub Pages) | Yes |
| Local builds | Yes |
| Older deployments | Best effort |

---

## Security Updates

Security updates are deployed to GitHub Pages immediately upon fix completion.

To get updates:
1. Hard refresh the page (Ctrl+Shift+R)
2. Clear service worker cache if needed
3. Check the service worker version in console

---

## Acknowledgments

We appreciate responsible security researchers who help keep Hive Messenger secure.

Contributors who report valid security issues will be acknowledged (with permission) in our changelog.
