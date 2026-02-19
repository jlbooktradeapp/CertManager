# Certificate Manager - Architecture Plan

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CERTIFICATE MANAGER                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   Frontend  │◄──►│  Express API    │◄──►│        MongoDB              │ │
│  │   (React)   │    │  (Node.js)      │    │                             │ │
│  └─────────────┘    └────────┬────────┘    └─────────────────────────────┘ │
│                              │                                              │
│                              ▼                                              │
│                    ┌─────────────────┐                                      │
│                    │  Windows Services│                                     │
│                    │  Integration     │                                     │
│                    └────────┬────────┘                                      │
│                              │                                              │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Root CA     │    │    Sub CAs      │    │ Windows Servers │
│               │    │                 │    │ (IIS/Services)  │
└───────────────┘    └─────────────────┘    └─────────────────┘
```

## 2. Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React + TypeScript | Admin dashboard UI |
| Backend | Node.js + Express + TypeScript | REST API server |
| Database | MongoDB | Certificate & configuration storage |
| Windows Integration | PowerShell + node-powershell | CA/AD/IIS interaction |
| Authentication | Active Directory (LDAP) | Enterprise SSO |
| Scheduling | node-cron | Expiration checks & alerts |
| Email | Nodemailer | Expiration notifications |

## 3. Project Structure

```
CertManager/
├── client/                     # React Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard/
│   │   │   ├── Certificates/
│   │   │   ├── CSRGenerator/
│   │   │   ├── CAManagement/
│   │   │   ├── ServerManagement/
│   │   │   └── Settings/
│   │   ├── services/           # API client services
│   │   ├── hooks/              # Custom React hooks
│   │   ├── context/            # Auth & app state
│   │   ├── types/              # TypeScript interfaces
│   │   └── utils/
│   └── package.json
│
├── server/                     # Express Backend
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.ts     # MongoDB connection
│   │   │   ├── ldap.ts         # AD configuration
│   │   │   └── mail.ts         # SMTP settings
│   │   ├── controllers/
│   │   │   ├── authController.ts
│   │   │   ├── certificateController.ts
│   │   │   ├── csrController.ts
│   │   │   ├── caController.ts
│   │   │   └── serverController.ts
│   │   ├── models/
│   │   │   ├── Certificate.ts
│   │   │   ├── CertificateAuthority.ts
│   │   │   ├── Server.ts
│   │   │   ├── CSRRequest.ts
│   │   │   └── User.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── certificates.ts
│   │   │   ├── csr.ts
│   │   │   ├── ca.ts
│   │   │   └── servers.ts
│   │   ├── services/
│   │   │   ├── caService.ts          # CA interaction logic
│   │   │   ├── certificateService.ts # Cert operations
│   │   │   ├── powershellService.ts  # PS execution wrapper
│   │   │   ├── notificationService.ts# Email alerts
│   │   │   └── schedulerService.ts   # Cron jobs
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rbac.ts               # Role-based access
│   │   │   └── validation.ts
│   │   ├── scripts/                  # PowerShell scripts
│   │   │   ├── Get-IssuedCertificates.ps1
│   │   │   ├── Get-CAInfo.ps1
│   │   │   ├── New-CertificateRequest.ps1
│   │   │   ├── Submit-CertificateRequest.ps1
│   │   │   ├── Install-Certificate.ps1
│   │   │   └── Bind-IISCertificate.ps1
│   │   └── utils/
│   │       ├── logger.ts
│   │       ├── crypto.ts
│   │       └── dateUtils.ts
│   └── package.json
│
├── shared/                     # Shared types/utilities
│   └── types/
│
├── docker-compose.yml          # MongoDB container (dev)
├── .env.example
└── README.md
```

## 4. Data Models (MongoDB Schemas)

### 4.1 Certificate
```typescript
interface Certificate {
  _id: ObjectId;
  serialNumber: string;
  thumbprint: string;
  commonName: string;
  subjectAlternativeNames: string[];
  issuer: {
    caId: ObjectId;
    commonName: string;
  };
  subject: {
    commonName: string;
    organization?: string;
    organizationalUnit?: string;
    locality?: string;
    state?: string;
    country?: string;
  };
  validFrom: Date;
  validTo: Date;
  keyUsage: string[];
  extendedKeyUsage: string[];
  templateName?: string;
  status: 'active' | 'expiring' | 'expired' | 'revoked';
  deployedTo: [{
    serverId: ObjectId;
    serverName: string;
    binding?: {
      type: 'IIS' | 'Service' | 'Other';
      siteName?: string;
      port?: number;
    };
    deployedAt: Date;
  }];
  notificationsSent: [{
    type: '90day' | '60day' | '30day' | '14day' | '7day' | '1day';
    sentAt: Date;
    recipients: string[];
  }];
  metadata: {
    discoveredAt: Date;
    lastSyncedAt: Date;
    createdBy?: string;
  };
}
```

### 4.2 Certificate Authority
```typescript
interface CertificateAuthority {
  _id: ObjectId;
  name: string;
  displayName: string;
  type: 'root' | 'subordinate' | 'issuing';
  parentCAId?: ObjectId;
  hostname: string;
  configString: string;        // CA config string for certutil
  status: 'online' | 'offline' | 'unknown';
  certificates: {
    caCertThumbprint: string;
    validFrom: Date;
    validTo: Date;
  };
  templates: [{
    name: string;
    displayName: string;
    oid: string;
  }];
  lastSyncedAt: Date;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
}
```

### 4.3 Server
```typescript
interface Server {
  _id: ObjectId;
  hostname: string;
  fqdn: string;
  ipAddress: string;
  operatingSystem: string;
  roles: ('IIS' | 'Exchange' | 'ADFS' | 'RDS' | 'SQL' | 'Other')[];
  domainJoined: boolean;
  domain?: string;
  ou?: string;
  status: 'online' | 'offline' | 'unknown';
  remoteManagement: {
    winRMEnabled: boolean;
    psRemotingEnabled: boolean;
    lastChecked: Date;
  };
  certificates: ObjectId[];     // Deployed certificate IDs
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.4 CSR Request
```typescript
interface CSRRequest {
  _id: ObjectId;
  commonName: string;
  subjectAlternativeNames: string[];
  subject: {
    organization?: string;
    organizationalUnit?: string;
    locality?: string;
    state?: string;
    country?: string;
  };
  keySize: 2048 | 4096;
  keyAlgorithm: 'RSA' | 'ECDSA';
  hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
  templateName?: string;
  targetCAId?: ObjectId;
  targetServerId?: ObjectId;
  status: 'draft' | 'pending' | 'submitted' | 'issued' | 'failed' | 'cancelled';
  csrPEM?: string;
  privateKeyLocation?: string;  // Path on target server
  issuedCertificateId?: ObjectId;
  requestedBy: string;
  requestedAt: Date;
  processedAt?: Date;
  errorMessage?: string;
  workflowSteps: [{
    step: string;
    status: 'pending' | 'completed' | 'failed';
    completedAt?: Date;
    error?: string;
  }];
}
```

### 4.5 User
```typescript
interface User {
  _id: ObjectId;
  username: string;             // sAMAccountName
  email: string;
  displayName: string;
  distinguishedName: string;
  roles: ('admin' | 'operator' | 'viewer')[];
  preferences: {
    emailNotifications: boolean;
    dashboardLayout?: object;
  };
  lastLogin: Date;
  createdAt: Date;
}
```

### 4.6 Notification Settings
```typescript
interface NotificationSettings {
  _id: ObjectId;
  enabled: boolean;
  smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      encryptedPassword: string;
    };
    from: string;
  };
  thresholds: {
    days: number;
    enabled: boolean;
  }[];                          // e.g., [90, 60, 30, 14, 7, 1]
  recipients: {
    type: 'role' | 'user' | 'email';
    value: string;
  }[];
  scheduleHour: number;         // Hour of day to run check (0-23)
}
```

## 5. API Endpoints

### 5.1 Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | AD authentication |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/me` | Current user info |

### 5.2 Certificates
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/certificates` | List all certificates (paginated, filterable) |
| GET | `/api/certificates/:id` | Get certificate details |
| GET | `/api/certificates/expiring` | Get expiring certificates |
| GET | `/api/certificates/stats` | Dashboard statistics |
| POST | `/api/certificates/sync` | Trigger CA sync |
| DELETE | `/api/certificates/:id` | Remove from tracking |

### 5.3 Certificate Authorities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ca` | List all CAs |
| POST | `/api/ca` | Add CA to management |
| GET | `/api/ca/:id` | Get CA details |
| PUT | `/api/ca/:id` | Update CA settings |
| DELETE | `/api/ca/:id` | Remove CA |
| POST | `/api/ca/:id/sync` | Sync certificates from CA |
| GET | `/api/ca/:id/templates` | Get available templates |

### 5.4 CSR Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/csr` | List CSR requests |
| POST | `/api/csr` | Create new CSR request |
| GET | `/api/csr/:id` | Get CSR details |
| PUT | `/api/csr/:id` | Update CSR |
| POST | `/api/csr/:id/generate` | Generate CSR on target |
| POST | `/api/csr/:id/submit` | Submit to CA |
| DELETE | `/api/csr/:id` | Cancel/delete CSR |

### 5.5 Servers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List managed servers |
| POST | `/api/servers` | Add server |
| GET | `/api/servers/:id` | Get server details |
| PUT | `/api/servers/:id` | Update server |
| DELETE | `/api/servers/:id` | Remove server |
| POST | `/api/servers/:id/test` | Test connectivity |
| GET | `/api/servers/:id/certificates` | Get server certificates |
| POST | `/api/servers/:id/deploy` | Deploy certificate |
| POST | `/api/servers/:id/bind` | Bind certificate to site |

### 5.6 Settings & Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/notifications` | Get notification config |
| PUT | `/api/settings/notifications` | Update notification config |
| POST | `/api/settings/notifications/test` | Send test email |
| GET | `/api/settings/sync` | Get sync settings |
| PUT | `/api/settings/sync` | Update sync settings |

## 6. Windows Integration Architecture

### 6.1 PowerShell Execution Flow
```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Node.js API    │────►│  PowerShell Service │────►│  Windows CA/AD  │
│                 │◄────│  (node-powershell)  │◄────│                 │
└─────────────────┘     └─────────────────────┘     └─────────────────┘
```

### 6.2 Key PowerShell Operations

**Certificate Discovery (from CA):**
```powershell
# Get-IssuedCertificates.ps1
certutil -config "CAServer\CAName" -view -out "SerialNumber,CommonName,NotAfter,NotBefore" csv
```

**CSR Generation (on target server):**
```powershell
# New-CertificateRequest.ps1
$INF = @"
[NewRequest]
Subject = "CN=$CommonName"
KeyLength = $KeySize
Exportable = TRUE
...
"@
certreq -new request.inf request.csr
```

**Certificate Submission:**
```powershell
# Submit-CertificateRequest.ps1
certreq -submit -config "CAServer\CAName" -attrib "CertificateTemplate:$Template" request.csr
```

**Certificate Installation & Binding:**
```powershell
# Install-Certificate.ps1
Import-Certificate -FilePath $CertPath -CertStoreLocation Cert:\LocalMachine\My

# Bind-IISCertificate.ps1
Import-Module WebAdministration
New-WebBinding -Name $SiteName -Protocol https -Port $Port
$binding = Get-WebBinding -Name $SiteName -Protocol https
$binding.AddSslCertificate($Thumbprint, "My")
```

### 6.3 Service Account Requirements
- Domain service account with:
  - Certificate enrollment permissions on CAs
  - Read access to CA database
  - Admin rights on managed servers (for deployment)
  - WinRM/PSRemoting access to servers

## 7. Security Considerations

### 7.1 Authentication & Authorization
- **Authentication:** LDAP bind against Active Directory
- **Session Management:** JWT tokens with short expiry + refresh tokens
- **RBAC Roles:**
  - `admin`: Full access, configuration changes
  - `operator`: Certificate operations, CSR management
  - `viewer`: Read-only dashboard access

### 7.2 Data Protection
- Private keys never stored in MongoDB
- Sensitive configs encrypted at rest (e.g., SMTP passwords)
- All API traffic over HTTPS
- PowerShell credential handling via secure strings

### 7.3 Audit Logging
- All certificate operations logged
- User actions tracked with timestamps
- Integration with Windows Event Log (optional)

## 8. Notification System

### 8.1 Expiration Check Flow
```
┌────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Scheduler     │────►│  Check Expiring │────►│  Send Emails    │
│  (Daily Cron)  │     │  Certificates   │     │  (Nodemailer)   │
└────────────────┘     └─────────────────┘     └─────────────────┘
```

### 8.2 Notification Thresholds
| Days Before Expiry | Alert Level |
|--------------------|-------------|
| 90 | Info |
| 60 | Info |
| 30 | Warning |
| 14 | Warning |
| 7 | Critical |
| 1 | Critical |

## 9. Frontend Components

### 9.1 Dashboard
- Certificate health summary (pie chart)
- Expiring soon list (next 30 days)
- Recent activity feed
- CA status indicators
- Quick actions panel

### 9.2 Certificate List View
- Sortable/filterable data grid
- Status badges (active/expiring/expired)
- Bulk selection
- Export functionality (CSV)

### 9.3 CSR Wizard
- Step-by-step form
- Template selection
- Target server selection
- SAN entry interface
- Review & submit

### 9.4 Server Management
- Server inventory grid
- Connectivity status
- Deployed certificates
- One-click deployment

## 10. Implementation Phases

### Phase 1: Foundation
- [ ] Project setup (Node.js, Express, TypeScript, React)
- [ ] MongoDB connection and schemas
- [ ] Basic authentication (AD/LDAP)
- [ ] Core API structure

### Phase 2: Certificate Discovery
- [ ] PowerShell service wrapper
- [ ] CA connection and sync
- [ ] Certificate listing and details
- [ ] Basic dashboard

### Phase 3: CSR Management
- [ ] CSR creation workflow
- [ ] Template integration
- [ ] Submission to CA
- [ ] Status tracking

### Phase 4: Deployment Automation
- [ ] Server management
- [ ] Certificate deployment
- [ ] IIS binding automation
- [ ] Connectivity testing

### Phase 5: Notifications & Polish
- [ ] Email notification system
- [ ] Expiration scheduler
- [ ] Audit logging
- [ ] UI refinements

### Phase 6: Production Hardening
- [ ] Security review
- [ ] Performance optimization
- [ ] Documentation
- [ ] Deployment guides

## 11. Environment Configuration

```env
# Server
NODE_ENV=production
PORT=3000
API_PREFIX=/api

# MongoDB
MONGODB_URI=mongodb://localhost:27017/certmanager

# Active Directory
LDAP_URL=ldap://dc.domain.local
LDAP_BASE_DN=DC=domain,DC=local
LDAP_BIND_DN=CN=svc_certmgr,OU=Service Accounts,DC=domain,DC=local
LDAP_BIND_PASSWORD=<encrypted>

# JWT
JWT_SECRET=<generated-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# SMTP
SMTP_HOST=smtp.domain.local
SMTP_PORT=587
SMTP_USER=certmanager@domain.local
SMTP_PASSWORD=<encrypted>
SMTP_FROM=Certificate Manager <certmanager@domain.local>

# Service Account (for PowerShell operations)
SERVICE_ACCOUNT_USER=DOMAIN\svc_certmgr
SERVICE_ACCOUNT_PASSWORD=<encrypted>
```

## 12. Dependencies

### Backend (server/package.json)
```json
{
  "dependencies": {
    "express": "^4.18.x",
    "mongoose": "^8.x",
    "ldapjs": "^3.x",
    "jsonwebtoken": "^9.x",
    "bcryptjs": "^2.x",
    "node-powershell": "^5.x",
    "nodemailer": "^6.x",
    "node-cron": "^3.x",
    "helmet": "^7.x",
    "cors": "^2.x",
    "express-validator": "^7.x",
    "winston": "^3.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "@types/express": "^4.x",
    "ts-node-dev": "^2.x",
    "jest": "^29.x"
  }
}
```

### Frontend (client/package.json)
```json
{
  "dependencies": {
    "react": "^18.x",
    "react-router-dom": "^6.x",
    "axios": "^1.x",
    "@tanstack/react-query": "^5.x",
    "@mui/material": "^5.x",
    "@mui/x-data-grid": "^7.x",
    "recharts": "^2.x",
    "react-hook-form": "^7.x",
    "date-fns": "^3.x"
  }
}
```
