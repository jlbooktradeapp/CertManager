import mongoose, { Schema, Document } from 'mongoose';

export interface IDeployment {
  serverId: mongoose.Types.ObjectId;
  serverName: string;
  binding?: {
    type: 'IIS' | 'Service' | 'Other';
    siteName?: string;
    port?: number;
  };
  deployedAt: Date;
}

export interface INotificationSent {
  type: '90day' | '60day' | '30day' | '14day' | '7day' | '1day';
  sentAt: Date;
  recipients: string[];
}

export interface IDeployedLocation {
  hostname: string;
  resolvedIP?: string;
  networkLabel?: string;
  port: number;
  servedThumbprint?: string;
  matchStatus?: 'match' | 'mismatch' | 'unknown' | 'error';
  source: 'manual' | 'discovery';
  lastProbeAt?: Date;
}

export interface IAutoRenew {
  enabled: boolean;
  daysBeforeExpiry: number;
  lastRenewalAt?: Date;
  targetServerId?: mongoose.Types.ObjectId;
  deliveryEmails: string[];
  targetCAId?: mongoose.Types.ObjectId;
}

export interface ICertificate extends Document {
  serialNumber: string;
  thumbprint: string;
  commonName: string;
  subjectAlternativeNames: string[];
  issuer: {
    caId: mongoose.Types.ObjectId;
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
  keySize?: number;
  encryptionType?: string;
  templateName?: string;
  templateRawValue?: string;
  templateCN?: string;
  serverType?: 'apache' | 'iis';
  status: 'active' | 'expiring' | 'expired' | 'revoked' | 'reissued' | 'rebound';
  deployedTo: IDeployment[];
  deployedLocations: IDeployedLocation[];
  autoRenew: IAutoRenew;
  notificationsSent: INotificationSent[];
  notificationRecipients: string[];
  applicationId?: mongoose.Types.ObjectId;
  metadata: {
    discoveredAt: Date;
    lastSyncedAt: Date;
    createdBy?: string;
  };
}

const DeploymentSchema = new Schema<IDeployment>({
  serverId: { type: Schema.Types.ObjectId, ref: 'Server', required: true },
  serverName: { type: String, required: true },
  binding: {
    type: {
      type: String,
      enum: ['IIS', 'Service', 'Other'],
    },
    siteName: String,
    port: Number,
  },
  deployedAt: { type: Date, default: Date.now },
}, { _id: false });

const NotificationSentSchema = new Schema<INotificationSent>({
  type: {
    type: String,
    enum: ['90day', '60day', '30day', '14day', '7day', '1day'],
    required: true,
  },
  sentAt: { type: Date, required: true },
  recipients: [{ type: String }],
}, { _id: false });

const DeployedLocationSchema = new Schema<IDeployedLocation>({
  hostname: { type: String, required: true },
  resolvedIP: String,
  networkLabel: String,
  port: { type: Number, default: 443 },
  servedThumbprint: String,
  matchStatus: {
    type: String,
    enum: ['match', 'mismatch', 'unknown', 'error'],
    default: 'unknown',
  },
  source: {
    type: String,
    enum: ['manual', 'discovery'],
    default: 'manual',
  },
  lastProbeAt: Date,
}, { _id: false });

const AutoRenewSchema = new Schema<IAutoRenew>({
  enabled: { type: Boolean, default: false },
  daysBeforeExpiry: { type: Number, default: 30, min: 7, max: 90 },
  lastRenewalAt: Date,
  targetServerId: { type: Schema.Types.ObjectId, ref: 'Server' },
  deliveryEmails: [{ type: String }],
  targetCAId: { type: Schema.Types.ObjectId, ref: 'CertificateAuthority' },
}, { _id: false });

const CertificateSchema = new Schema<ICertificate>({
  serialNumber: { type: String, required: true, unique: true, index: true },
  thumbprint: { type: String, required: true, unique: true, index: true },
  commonName: { type: String, required: true, index: true },
  subjectAlternativeNames: [{ type: String }],
  issuer: {
    caId: { type: Schema.Types.ObjectId, ref: 'CertificateAuthority' },
    commonName: { type: String, required: true },
  },
  subject: {
    commonName: { type: String, required: true },
    organization: String,
    organizationalUnit: String,
    locality: String,
    state: String,
    country: String,
  },
  validFrom: { type: Date, required: true },
  validTo: { type: Date, required: true, index: true },
  keyUsage: [{ type: String }],
  extendedKeyUsage: [{ type: String }],
  keySize: Number,
  encryptionType: String,
  templateName: String,
  templateRawValue: String,
  templateCN: String,
  serverType: {
    type: String,
    enum: ['apache', 'iis'],
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'expiring', 'expired', 'revoked', 'reissued', 'rebound'],
    default: 'active',
    index: true,
  },
  deployedTo: [DeploymentSchema],
  deployedLocations: [DeployedLocationSchema],
  autoRenew: {
    type: AutoRenewSchema,
    default: () => ({ enabled: false, daysBeforeExpiry: 30, deliveryEmails: [] }),
  },
  notificationsSent: [NotificationSentSchema],
  notificationRecipients: [{ type: String }],
  applicationId: { type: Schema.Types.ObjectId, ref: 'Application', index: true },
  metadata: {
    discoveredAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date, default: Date.now },
    createdBy: String,
  },
}, {
  timestamps: true,
});

// Index for expiration queries
CertificateSchema.index({ validTo: 1, status: 1 });

// Virtual for days until expiration
CertificateSchema.virtual('daysUntilExpiration').get(function() {
  const now = new Date();
  const diffTime = this.validTo.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

export const Certificate = mongoose.model<ICertificate>('Certificate', CertificateSchema);