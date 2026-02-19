export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: ('admin' | 'operator' | 'viewer')[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Certificate {
  _id: string;
  serialNumber: string;
  thumbprint: string;
  commonName: string;
  subjectAlternativeNames: string[];
  issuer: {
    caId: string;
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
  validFrom: string;
  validTo: string;
  keyUsage: string[];
  extendedKeyUsage: string[];
  templateName?: string;
  status: 'active' | 'expiring' | 'expired' | 'revoked';
  deployedTo: {
    serverId: string;
    serverName: string;
    binding?: {
      type: 'IIS' | 'Service' | 'Other';
      siteName?: string;
      port?: number;
    };
    deployedAt: string;
  }[];
  metadata: {
    discoveredAt: string;
    lastSyncedAt: string;
    createdBy?: string;
  };
}

export interface CertificateAuthority {
  _id: string;
  name: string;
  displayName: string;
  type: 'root' | 'subordinate' | 'issuing';
  parentCAId?: string;
  hostname: string;
  configString: string;
  status: 'online' | 'offline' | 'unknown';
  certificates: {
    caCertThumbprint: string;
    validFrom: string;
    validTo: string;
  };
  templates: {
    name: string;
    displayName: string;
    oid: string;
  }[];
  lastSyncedAt: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
}

export interface Server {
  _id: string;
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
    lastChecked: string;
  };
  certificates: Certificate[];
  lastSyncedAt: string;
}

export interface CSRRequest {
  _id: string;
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
  targetCAId?: string;
  targetServerId?: string;
  status: 'draft' | 'pending' | 'submitted' | 'issued' | 'failed' | 'cancelled';
  csrPEM?: string;
  privateKeyLocation?: string;
  issuedCertificateId?: string;
  requestedBy: string;
  requestedAt: string;
  processedAt?: string;
  errorMessage?: string;
  workflowSteps: {
    step: string;
    status: 'pending' | 'completed' | 'failed';
    completedAt?: string;
    error?: string;
  }[];
}

export interface CertificateStats {
  total: number;
  active: number;
  expiring: number;
  expired: number;
  revoked: number;
  expiringIn30Days: number;
  expiringIn7Days: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
