import mongoose, { Schema, Document } from 'mongoose';

export type ServerRole = 'IIS' | 'Exchange' | 'ADFS' | 'RDS' | 'SQL' | 'Other';

export interface IServer extends Document {
  hostname: string;
  fqdn: string;
  ipAddress: string;
  operatingSystem: string;
  roles: ServerRole[];
  domainJoined: boolean;
  domain?: string;
  ou?: string;
  status: 'online' | 'offline' | 'unknown';
  remoteManagement: {
    winRMEnabled: boolean;
    psRemotingEnabled: boolean;
    lastChecked: Date;
  };
  certificates: mongoose.Types.ObjectId[];
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ServerSchema = new Schema<IServer>({
  hostname: { type: String, required: true, index: true },
  fqdn: { type: String, required: true, unique: true, index: true },
  ipAddress: { type: String, required: true },
  operatingSystem: { type: String, default: 'Windows Server' },
  roles: [{
    type: String,
    enum: ['IIS', 'Exchange', 'ADFS', 'RDS', 'SQL', 'Other'],
  }],
  domainJoined: { type: Boolean, default: true },
  domain: String,
  ou: String,
  status: {
    type: String,
    enum: ['online', 'offline', 'unknown'],
    default: 'unknown',
  },
  remoteManagement: {
    winRMEnabled: { type: Boolean, default: false },
    psRemotingEnabled: { type: Boolean, default: false },
    lastChecked: Date,
  },
  certificates: [{ type: Schema.Types.ObjectId, ref: 'Certificate' }],
  lastSyncedAt: Date,
}, {
  timestamps: true,
});

export const Server = mongoose.model<IServer>('Server', ServerSchema);
