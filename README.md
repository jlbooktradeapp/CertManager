# Certificate Manager

Enterprise-grade web application for managing SSL certificates across a Windows Active Directory domain.

## Features

- **Certificate Discovery**: Automatically sync certificates from Windows Certificate Authorities
- **Expiration Tracking**: Monitor certificate expiration with configurable alerts
- **CSR Management**: Create and submit Certificate Signing Requests
- **Deployment Automation**: Deploy and bind certificates to IIS websites
- **Email Notifications**: Configurable expiration warnings to administrators
- **Role-Based Access Control**: Admin, Operator, and Viewer roles via Active Directory

## Tech Stack

- **Frontend**: React 18, TypeScript, Material-UI, React Query
- **Backend**: Node.js, Express, TypeScript
- **Database**: MongoDB
- **Authentication**: Active Directory (LDAP)
- **Windows Integration**: PowerShell remoting

## Prerequisites

- Node.js 18+
- MongoDB 6+
- Windows Server with Active Directory
- Windows Certificate Authority
- Service account with appropriate permissions

## Quick Start

### 1. Install Dependencies

```bash
npm run install:all
```

### 2. Start MongoDB (Docker)

```bash
docker-compose up -d
```

### 3. Configure Environment

Copy `.env.example` to `server/.env` and configure:

```bash
cp .env.example server/.env
```

Edit `server/.env` with your settings:
- MongoDB connection string
- LDAP/Active Directory settings
- SMTP configuration
- JWT secret

### 4. Start Development Servers

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Production Deployment

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

## Project Structure

```
CertManager/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── context/        # React context
│   │   ├── services/       # API services
│   │   └── types/          # TypeScript types
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── config/         # Configuration
│   │   ├── controllers/    # Route handlers
│   │   ├── middleware/     # Express middleware
│   │   ├── models/         # MongoDB schemas
│   │   ├── routes/         # API routes
│   │   ├── scripts/        # PowerShell scripts
│   │   └── services/       # Business logic
│   └── package.json
├── Architecture.md         # Detailed architecture
└── docker-compose.yml      # MongoDB container
```

## API Endpoints

| Resource | Endpoints |
|----------|-----------|
| Auth | POST /login, /logout, /refresh, GET /me |
| Certificates | GET, POST /sync, DELETE /:id |
| CA | GET, POST, PUT, DELETE, POST /:id/sync |
| CSR | GET, POST, PUT, DELETE, POST /:id/generate, /:id/submit |
| Servers | GET, POST, PUT, DELETE, POST /:id/test, /:id/deploy, /:id/bind |
| Settings | GET/PUT /notifications, /sync |

## Service Account Requirements

The Windows service account needs:
- Read access to CA database
- Certificate enrollment permissions
- Admin rights on target servers
- WinRM/PSRemoting access

## License

Proprietary - Enterprise Use Only
