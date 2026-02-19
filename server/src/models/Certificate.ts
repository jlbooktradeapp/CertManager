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
  templateName?: string;
  status: 'active' | 'expiring' | 'expired' | 'revoked';
  deployedTo: IDeployment[];
  notificationsSent: INotificationSent[];
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
  templateName: String,
  status: {
    type: String,
    enum: ['active', 'expiring', 'expired', 'revoked'],
    default: 'active',
    index: true,
  },
  deployedTo: [DeploymentSchema],
  notificationsSent: [NotificationSentSchema],
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
