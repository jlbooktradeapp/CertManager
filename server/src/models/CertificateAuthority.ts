import mongoose, { Schema, Document } from 'mongoose';

export interface ITemplate {
  name: string;
  displayName: string;
  oid: string;
}

export interface ICertificateAuthority extends Document {
  name: string;
  displayName: string;
  type: 'root' | 'subordinate' | 'issuing';
  parentCAId?: mongoose.Types.ObjectId;
  hostname: string;
  configString: string;
  status: 'online' | 'offline' | 'unknown';
  certificates: {
    caCertThumbprint: string;
    validFrom: Date;
    validTo: Date;
  };
  templates: ITemplate[];
  lastSyncedAt: Date;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
}

const TemplateSchema = new Schema<ITemplate>({
  name: { type: String, required: true },
  displayName: { type: String, required: true },
  oid: { type: String, required: true },
}, { _id: false });

const CertificateAuthoritySchema = new Schema<ICertificateAuthority>({
  name: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true },
  type: {
    type: String,
    enum: ['root', 'subordinate', 'issuing'],
    required: true,
  },
  parentCAId: { type: Schema.Types.ObjectId, ref: 'CertificateAuthority' },
  hostname: { type: String, required: true },
  configString: { type: String, required: true },
  status: {
    type: String,
    enum: ['online', 'offline', 'unknown'],
    default: 'unknown',
  },
  certificates: {
    caCertThumbprint: String,
    validFrom: Date,
    validTo: Date,
  },
  templates: [TemplateSchema],
  lastSyncedAt: Date,
  syncEnabled: { type: Boolean, default: true },
  syncIntervalMinutes: { type: Number, default: 60 },
}, {
  timestamps: true,
});

export const CertificateAuthority = mongoose.model<ICertificateAuthority>(
  'CertificateAuthority',
  CertificateAuthoritySchema
);
