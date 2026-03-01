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

export interface DeployedLocation {
  hostname: string;
  resolvedIP?: string;
  networkLabel?: string;
  port: number;
  servedThumbprint?: string;
  matchStatus?: 'match' | 'mismatch' | 'unknown' | 'error';
  source: 'manual' | 'discovery';
  lastProbeAt?: string;
}

export interface AutoRenew {
  enabled: boolean;
  daysBeforeExpiry: number;
  lastRenewalAt?: string;
  targetServerId?: string;
  deliveryEmails: string[];
  targetCAId?: string;
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
  keySize?: number;
  encryptionType?: string;
  templateName?: string;
  serverType?: 'apache' | 'iis';
  status: 'active' | 'expiring' | 'expired' | 'revoked' | 'reissued' | 'rebound';
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
  deployedLocations: DeployedLocation[];
  autoRenew: AutoRenew;
  metadata: {
    discoveredAt: string;
    lastSyncedAt: string;
    createdBy?: string;
  };
  notificationRecipients?: string[];
  applicationId?: string | Application;
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
  issuanceEnabled: boolean;
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

export interface ApplicationOwner {
  name: string;
  email: string;
  role?: string;
}

export interface Application {
  _id: string;
  name: string;
  description?: string;
  owners: ApplicationOwner[];
  vendor?: {
    name: string;
    contactName?: string;
    contactEmail?: string;
  };
  status: 'active' | 'inactive' | 'retired';
  certificates: Certificate[];
  certificateCount?: number;
  createdAt: string;
  updatedAt: string;
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
  serverType: 'apache' | 'iis';
  keySize: 2048 | 4096;
  keyAlgorithm: 'RSA' | 'ECDSA';
  hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
  templateName?: string;
  targetCAId?: string;
  targetServerId?: string;
  applicationId?: string;
  deliveryEmails: string[];
  status: 'draft' | 'generating' | 'pending' | 'submitted' | 'issued' | 'delivering' | 'completed' | 'failed' | 'cancelled';
  csrPEM?: string;
  privateKeyLocation?: string;
  issuedCertificateId?: string;
  issuedCertPEM?: string;
  deliveredAt?: string;
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
  reissued: number;
  rebound: number;
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