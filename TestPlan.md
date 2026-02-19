# CertManager Test Plan

**Version:** 1.0
**Date:** 2026-02-19
**Environment:** Pre-production / Development

> Since testing will happen in the production environment, execute tests in the order listed.
> Infrastructure and auth must pass before moving to functional tests.

---

## Prerequisites

Before running any tests, verify:

- [ ] Node.js 18+ installed on the server
- [ ] MongoDB 7 running (via Docker or standalone)
- [ ] Active Directory accessible from the server
- [ ] AD groups created: `CertManager-Admins`, `CertManager-Operators`, `CertManager-Viewers`
- [ ] Three AD test accounts, one in each group
- [ ] `.env` file configured from `.env.example` with real values
- [ ] `JWT_SECRET` generated with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] `JWT_REFRESH_SECRET` generated separately
- [ ] `NODE_ENV=production` in `.env`
- [ ] `CORS_ORIGIN` set to the actual frontend URL
- [ ] SMTP server accessible for email tests
- [ ] At least one enterprise CA in the domain
- [ ] At least one Windows server with WinRM enabled for remote operations
- [ ] Application built and running (`npm run build && npm start`)

---

## 1. Infrastructure & Connectivity

### 1.1 Application Startup

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 1.1.1 | Server starts successfully | Run `npm start` in the server directory | Logs show "Connected to MongoDB", "Scheduler initialized", "Server running on port 3000" | [ ] |
| 1.1.2 | Startup fails without JWT_SECRET | Remove `JWT_SECRET` from `.env`, restart | Server exits with error "Missing required environment variables: JWT_SECRET" | [ ] |
| 1.1.3 | Startup fails with short JWT_SECRET | Set `JWT_SECRET=short`, restart | Server exits with "JWT_SECRET must be at least 32 characters" | [ ] |
| 1.1.4 | Health check endpoint | `GET /health` | Returns `{ "status": "ok", "timestamp": "..." }` | [ ] |
| 1.1.5 | Client loads in browser | Navigate to the frontend URL | Login page renders without console errors | [ ] |

### 1.2 MongoDB

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 1.2.1 | Database connection | Start server with valid `MONGODB_URI` | Log shows "MongoDB connection established" | [ ] |
| 1.2.2 | Auth rejection | Set wrong credentials in `MONGODB_URI`, restart | Server fails to start with connection error | [ ] |

### 1.3 LDAP / Active Directory

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 1.3.1 | AD authentication works | Log in with a valid AD account | Login succeeds, user redirected to dashboard | [ ] |
| 1.3.2 | Bad password rejected | Log in with valid username, wrong password | "Invalid credentials" error | [ ] |
| 1.3.3 | Nonexistent user rejected | Log in with a username that doesn't exist in AD | "Invalid credentials" error (no info leakage) | [ ] |

---

## 2. Authentication & Session Management

### 2.1 Login

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 2.1.1 | Successful login (admin) | Log in with AD account in `CertManager-Admins` | Dashboard loads; user menu shows "admin" role | [ ] |
| 2.1.2 | Successful login (operator) | Log in with AD account in `CertManager-Operators` | Dashboard loads; user menu shows "operator" role | [ ] |
| 2.1.3 | Successful login (viewer) | Log in with AD account in `CertManager-Viewers` | Dashboard loads; user menu shows "viewer" role | [ ] |
| 2.1.4 | Default role assignment | Log in with AD account in none of the CertManager groups | User is assigned "viewer" role | [ ] |
| 2.1.5 | Empty username/password | Submit login form with empty fields | Form validation prevents submission (required fields) | [ ] |
| 2.1.6 | Rate limiting | Submit 11 wrong passwords rapidly | After 10th attempt: "Too many login attempts. Please try again in 15 minutes." | [ ] |

### 2.2 Session

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 2.2.1 | Token refresh | Wait 15+ minutes (or set `JWT_EXPIRES_IN=30s` temporarily), then navigate | App silently refreshes token; no login redirect | [ ] |
| 2.2.2 | Logout | Click user menu > Logout | Redirected to login page; cannot access protected pages | [ ] |
| 2.2.3 | Logout invalidates tokens | After logout, manually call `POST /api/auth/refresh` with the old refresh token | Returns 401 "Invalid refresh token" | [ ] |
| 2.2.4 | Expired refresh token | Wait for refresh token to expire (or use a stale one) | Redirected to login page | [ ] |
| 2.2.5 | Refresh token reuse detection | Save a refresh token, use it to refresh, then try using the old token again | Second use returns 401; all tokens for user are revoked | [ ] |

---

## 3. Role-Based Access Control (RBAC)

### 3.1 Client Route Guards

| # | Test | Role | Steps | Expected Result | Pass |
|---|------|------|-------|-----------------|------|
| 3.1.1 | Settings page blocked for viewer | viewer | Navigate to `/settings` directly | Redirected to `/` | [ ] |
| 3.1.2 | Settings page blocked for operator | operator | Navigate to `/settings` directly | Redirected to `/` | [ ] |
| 3.1.3 | Settings page accessible for admin | admin | Navigate to `/settings` | Settings page loads | [ ] |
| 3.1.4 | CSR wizard blocked for viewer | viewer | Navigate to `/csr/new` directly | Redirected to `/` | [ ] |
| 3.1.5 | CSR wizard accessible for operator | operator | Navigate to `/csr/new` | CSR wizard loads | [ ] |
| 3.1.6 | Sidebar Settings link hidden | viewer | Check left sidebar | "Settings" link not visible | [ ] |

### 3.2 Server-Side RBAC

Test these via the UI or directly with curl/Postman using tokens from each role.

| # | Test | Role | Endpoint | Expected Result | Pass |
|---|------|------|----------|-----------------|------|
| 3.2.1 | Viewer cannot create CA | viewer | `POST /api/ca` | 403 Forbidden | [ ] |
| 3.2.2 | Viewer cannot delete certificate | viewer | `DELETE /api/certificates/:id` | 403 Forbidden | [ ] |
| 3.2.3 | Viewer cannot create server | viewer | `POST /api/servers` | 403 Forbidden | [ ] |
| 3.2.4 | Viewer cannot create CSR | viewer | `POST /api/csr` | 403 Forbidden | [ ] |
| 3.2.5 | Operator cannot create CA | operator | `POST /api/ca` | 403 Forbidden | [ ] |
| 3.2.6 | Operator cannot delete server | operator | `DELETE /api/servers/:id` | 403 Forbidden | [ ] |
| 3.2.7 | Operator cannot update settings | operator | `PUT /api/settings/notifications` | 403 Forbidden | [ ] |
| 3.2.8 | Viewer can list certificates | viewer | `GET /api/certificates` | 200 OK with data | [ ] |
| 3.2.9 | Operator can trigger sync | operator | `POST /api/certificates/sync` | 200 OK | [ ] |

---

## 4. Certificate Authority Management (Admin)

Log in as **admin** for all CA tests.

### 4.1 Add CA

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 4.1.1 | Add enterprise CA | Click "Add CA"; fill in Name, Display Name, Type=Issuing, Hostname, Config String (format: `hostname\CA-Name`) | CA appears in list with "Unknown" status | [ ] |
| 4.1.2 | Duplicate CA name rejected | Add another CA with the same name | Error: "Certificate authority with this name already exists" | [ ] |
| 4.1.3 | Missing required fields | Submit form with empty hostname | Error: "Missing required fields" | [ ] |

### 4.2 Sync CA

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 4.2.1 | Manual sync | Click Sync button on a CA card | Success message with count of certificates synced | [ ] |
| 4.2.2 | Certificates appear after sync | Navigate to Certificates page | Certificates from the CA are listed | [ ] |

### 4.3 CA Templates

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 4.3.1 | Templates load | Create a CSR and reach step 3 (or call `GET /api/ca/:id/templates`) | Templates returned from the CA | [ ] |

### 4.4 Delete CA

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 4.4.1 | Delete CA with no children | Click Delete on a CA with no subordinate CAs | CA removed from list | [ ] |
| 4.4.2 | Delete CA with children blocked | Click Delete on a root CA that has subordinates | Error: "Cannot delete CA with subordinate CAs" | [ ] |

---

## 5. Server Management (Admin)

Log in as **admin** for server creation/deletion, **operator** for connectivity tests.

### 5.1 Add Server

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 5.1.1 | Add Windows server | Click "Add Server"; fill in Hostname, FQDN, IP Address, select roles (e.g., IIS) | Server appears in list with "Unknown" status | [ ] |
| 5.1.2 | Duplicate FQDN rejected | Add server with same FQDN | Error: "Server with this FQDN already exists" | [ ] |
| 5.1.3 | Missing required fields | Submit with empty FQDN | Error: "Hostname, FQDN, and IP address are required" | [ ] |

### 5.2 Connectivity Testing

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 5.2.1 | Test reachable server | Click Test on a server that's online and has WinRM enabled | Status changes to "Online", WinRM shows "OK" | [ ] |
| 5.2.2 | Test unreachable server | Click Test on a server that's offline or firewall-blocked | Status changes to "Offline" | [ ] |
| 5.2.3 | Invalid hostname blocked | Add a server with FQDN containing special characters, then test | Validation error (hostname rejected) | [ ] |

### 5.3 Remote Certificates

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 5.3.1 | View server certificates | Click on a server, view certificates section (or `GET /api/servers/:id/certificates`) | Certificates from the remote machine's LocalMachine\My store are listed | [ ] |

### 5.4 Delete Server

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 5.4.1 | Delete server | Click Delete on a server, confirm | Server removed from list | [ ] |

---

## 6. CSR Workflow (Operator)

This is the core workflow. Test the full lifecycle end-to-end.

Log in as **operator** (or admin).

### 6.1 Create CSR

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 6.1.1 | Step 1: Subject info | Navigate to `/csr/new`; enter Common Name (e.g., `test.yourdomain.com`), add SANs | Fields accepted, can proceed to step 2 | [ ] |
| 6.1.2 | Step 2: Key options | Select Key Size 2048, SHA256, enter template name (e.g., WebServer) | Fields accepted, can proceed to step 3 | [ ] |
| 6.1.3 | Step 3: Target selection | Select target CA and target server from dropdowns | Review shows correct summary | [ ] |
| 6.1.4 | Submit CSR request | Click Create | CSR appears in CSR list with "draft" status | [ ] |

### 6.2 Generate CSR

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 6.2.1 | Generate CSR on target server | Via API: `POST /api/csr/:id/generate` | Status changes to "pending"; CSR PEM returned | [ ] |
| 6.2.2 | Invalid common name rejected | Create CSR with CN containing `"; malicious code` | Error: "Invalid common name: contains disallowed characters" | [ ] |
| 6.2.3 | Invalid hash algorithm rejected | Create CSR with hashAlgorithm set to `MD5` | Error: "Invalid hash algorithm" | [ ] |

### 6.3 Submit CSR to CA

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 6.3.1 | Submit to CA | `POST /api/csr/:id/submit` (after CSR is generated) | Status changes to "submitted"; certificate issued by CA | [ ] |
| 6.3.2 | Submit without generation | Try submitting a draft CSR that hasn't been generated | Error: "CSR must be generated first" | [ ] |

### 6.4 Certificate Deployment

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 6.4.1 | Deploy certificate to server | `POST /api/servers/:id/deploy` with certificatePath | Certificate installed on remote server | [ ] |
| 6.4.2 | Bind to IIS site | `POST /api/servers/:id/bind` with siteName and thumbprint | Certificate bound to IIS site; deployment recorded | [ ] |
| 6.4.3 | Bind to non-IIS server | Try binding to a server without IIS role | Error: "Server does not have IIS role" | [ ] |

### 6.5 Update & Delete CSR

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 6.5.1 | Update draft CSR | `PUT /api/csr/:id` with updated fields while status=draft | CSR updated successfully | [ ] |
| 6.5.2 | Update non-draft rejected | Try updating a CSR that's been submitted | Error: "Can only update draft CSR requests" | [ ] |
| 6.5.3 | Delete draft CSR | Delete a draft CSR | CSR removed | [ ] |
| 6.5.4 | Delete submitted CSR blocked | Try deleting a submitted CSR | Error: "Cannot delete submitted CSR" | [ ] |

---

## 7. Certificate Monitoring

### 7.1 Dashboard

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 7.1.1 | Stats display | Navigate to Dashboard | Stats cards show correct counts (Total, Active, Expiring, Critical) | [ ] |
| 7.1.2 | Pie chart renders | View Dashboard | Status distribution chart matches certificate data | [ ] |
| 7.1.3 | Expiring list | View "Expiring Soon" section | Shows up to 5 certificates with correct days remaining | [ ] |

### 7.2 Certificate List

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 7.2.1 | List loads | Navigate to Certificates | Table shows certificates with pagination | [ ] |
| 7.2.2 | Search works | Type a common name in search box | Table filters to matching certificates | [ ] |
| 7.2.3 | Status filter | Click "Expiring" status chip | Only expiring certificates shown | [ ] |
| 7.2.4 | Pagination | Navigate between pages | Data loads correctly for each page | [ ] |
| 7.2.5 | Click to detail | Click a certificate row | Certificate detail page loads | [ ] |

### 7.3 Certificate Detail

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 7.3.1 | Detail renders | Open a certificate | Subject info, SANs, issuer, deployment info all display correctly | [ ] |
| 7.3.2 | Delete certificate | Click Remove (as operator+), confirm | Certificate removed from tracking; returns to list | [ ] |

---

## 8. Notification System (Admin)

### 8.1 SMTP Configuration

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 8.1.1 | Settings load | Navigate to Settings | SMTP fields populated from server config; password shows as empty (not the actual password) | [ ] |
| 8.1.2 | Update SMTP settings | Change host/port, click Save | Success message; settings persist on page reload | [ ] |
| 8.1.3 | Password not leaked | Check browser DevTools Network tab when loading Settings | `encryptedPassword` field shows `"********"`, not the real password | [ ] |
| 8.1.4 | Change password | Enter new SMTP password, save | New password saved; subsequent loads show empty field again | [ ] |
| 8.1.5 | Keep existing password | Save settings without touching password field | Existing password is preserved (not overwritten with blank) | [ ] |

### 8.2 Test Email

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 8.2.1 | Send test email | Enter an email address, click Test | "Test email sent successfully"; email arrives | [ ] |
| 8.2.2 | Empty email rejected | Click Test with empty email field | Error or button disabled | [ ] |

### 8.3 Thresholds & Recipients

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 8.3.1 | Toggle thresholds | Click threshold chips to enable/disable, save | Thresholds persist on reload | [ ] |
| 8.3.2 | Add email recipient | Add type=email, value=user@example.com | Recipient appears in table | [ ] |
| 8.3.3 | Add role recipient | Add type=role, value=admin | Recipient appears in table | [ ] |
| 8.3.4 | Remove recipient | Click delete icon on a recipient, save | Recipient removed; persists on reload | [ ] |

---

## 9. Security Validation

These tests verify the security hardening is working correctly.

### 9.1 Input Sanitization

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 9.1.1 | LDAP injection blocked | Try logging in with username: `*)(objectClass=*)` | "Invalid credentials" (not a server error or data leak) | [ ] |
| 9.1.2 | PowerShell injection in hostname | Try adding server with FQDN: `server"; Remove-Item C:\ -Recurse` | Validation error (invalid hostname characters) | [ ] |
| 9.1.3 | PowerShell injection in configString | Try adding CA with configString: `host\CA"; malicious` | Validation error (invalid config string) | [ ] |
| 9.1.4 | ReDoS in search | Search certificates with: `(a+)+$` followed by a long string | Response returns within normal time (no hang) | [ ] |
| 9.1.5 | CSR subject injection | Create CSR with commonName containing `'@` or `";` | Error: "Invalid common name: contains disallowed characters" | [ ] |
| 9.1.6 | Mass assignment blocked | `PUT /api/ca/:id` with body `{"roles": ["admin"], "__proto__": {}}` | Only whitelisted fields updated; extra fields ignored | [ ] |

### 9.2 Authentication Security

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 9.2.1 | No token = 401 | `GET /api/certificates` without Authorization header | 401 "No token provided" | [ ] |
| 9.2.2 | Invalid token = 401 | Send request with `Authorization: Bearer garbage` | 401 "Invalid token" | [ ] |
| 9.2.3 | Expired token = 401 | Use an expired access token | 401 "Token expired" | [ ] |
| 9.2.4 | Refresh token cannot be used as access token | Use a refresh token in the Authorization header | 401 "Invalid token type" | [ ] |
| 9.2.5 | Error messages don't leak internals | Trigger a server error (e.g., invalid ObjectId format) | Response shows "Internal server error", no stack traces | [ ] |

### 9.3 Rate Limiting

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 9.3.1 | Login rate limit | Send 11+ `POST /api/auth/login` requests in 15 minutes | 429 after 10th attempt | [ ] |
| 9.3.2 | Refresh rate limit | Send 31+ `POST /api/auth/refresh` requests in 15 minutes | 429 after 30th attempt | [ ] |
| 9.3.3 | Rate limit headers | Check response headers after login attempt | `RateLimit-*` headers present | [ ] |

---

## 10. Edge Cases & Error Handling

| # | Test | Steps | Expected Result | Pass |
|---|------|-------|-----------------|------|
| 10.1 | Invalid ObjectId | `GET /api/certificates/not-a-valid-id` | 400 "Invalid id" | [ ] |
| 10.2 | Nonexistent resource | `GET /api/certificates/aaaaaaaaaaaaaaaaaaaaaaaa` | 404 "Certificate not found" | [ ] |
| 10.3 | Unknown route | `GET /api/unknown` | 404 "Not found" | [ ] |
| 10.4 | Large request body | Send a >1MB JSON body to any endpoint | 413 or 400 error (body too large) | [ ] |
| 10.5 | Browser back after logout | Log out, press browser back button | Login page shown (not cached protected content) | [ ] |
| 10.6 | Concurrent session | Log in from two browsers with the same account | Both sessions work independently | [ ] |
| 10.7 | Logout from one session | Log out from one browser | Other session eventually requires re-login (refresh tokens revoked) | [ ] |

---

## 11. End-to-End Workflow

Perform this full lifecycle test as the final validation.

| Step | Action | Role | Expected Result | Pass |
|------|--------|------|-----------------|------|
| 1 | Log in as admin | admin | Dashboard loads | [ ] |
| 2 | Add a Certificate Authority | admin | CA appears in CA list | [ ] |
| 3 | Sync the CA | admin | Certificates synced from CA | [ ] |
| 4 | Add a Windows server (with IIS role) | admin | Server appears in list | [ ] |
| 5 | Test server connectivity | admin | Status=Online, WinRM=OK | [ ] |
| 6 | Log out, log in as operator | operator | Dashboard loads | [ ] |
| 7 | Create a new CSR via wizard | operator | CSR in draft status | [ ] |
| 8 | Generate the CSR | operator | CSR PEM generated; status=pending | [ ] |
| 9 | Submit CSR to CA | operator | Status=submitted; certificate issued | [ ] |
| 10 | Deploy certificate to server | operator | Certificate installed on remote machine | [ ] |
| 11 | Bind certificate to IIS site | operator | Binding created; deployment tracked | [ ] |
| 12 | Verify certificate appears on Dashboard | operator | Dashboard stats updated; certificate in list | [ ] |
| 13 | Log out, log in as viewer | viewer | Dashboard loads | [ ] |
| 14 | Verify read-only access | viewer | Can view certificates, servers, CAs; cannot create/modify/delete | [ ] |
| 15 | Go to Settings page | admin | Configure email notifications | [ ] |
| 16 | Send test email | admin | Email received | [ ] |

---

## Sign-Off

| Role | Name | Date | Result |
|------|------|------|--------|
| Tester | | | |
| Reviewer | | | |

**Notes:**
- Document any failures with screenshots and browser console output
- For API-level tests, use Postman, curl, or the browser's Network tab
- After completing all tests, review server logs for any unexpected errors
