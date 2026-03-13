import mongoose, { Schema, Document } from 'mongoose';

export interface IThreshold {
  days: number;
  enabled: boolean;
}

export interface IRecipient {
  type: 'role' | 'user' | 'email';
  value: string;
}

export interface INotificationSettings extends Document {
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
  thresholds: IThreshold[];
  recipients: IRecipient[];
  scheduleHour: number;
  excludedTemplates: string[];
  calendarConfig: {
    enabled: boolean;
    method: 'ics' | 'graph' | 'both';
    icsTargetEmail: string;
    graphTenantId: string;
    graphClientId: string;
    graphClientSecret: string;
    graphCalendarEmail: string;
  };
  cleanupConfig: {
    retentionDays: number;
    digestEnabled: boolean;
    digestFrequency: 'daily' | 'weekly';
    digestDay: number;
    lastDigestSent?: Date;
  };
  discoveryConfig: {
    enabled: boolean;
    probePorts: number[];
    probeTimeoutMs: number;
    concurrency: number;
    f5IpRanges: string[];
    lastRunAt?: Date;
    lastRunStats?: {
      probed: number;
      matched: number;
      mismatched: number;
      errors: number;
      reboundFound: number;
    };
  };
}

const ThresholdSchema = new Schema<IThreshold>({
  days: { type: Number, required: true },
  enabled: { type: Boolean, default: true },
}, { _id: false });

const RecipientSchema = new Schema<IRecipient>({
  type: {
    type: String,
    enum: ['role', 'user', 'email'],
    required: true,
  },
  value: { type: String, required: true },
}, { _id: false });

const NotificationSettingsSchema = new Schema<INotificationSettings>({
  enabled: { type: Boolean, default: true },
  smtpConfig: {
    host: { type: String, required: true },
    port: { type: Number, default: 587 },
    secure: { type: Boolean, default: false },
    auth: {
      user: String,
      encryptedPassword: String,
    },
    from: { type: String, required: true },
  },
  thresholds: {
    type: [ThresholdSchema],
    default: [
      { days: 90, enabled: true },
      { days: 60, enabled: true },
      { days: 30, enabled: true },
      { days: 14, enabled: true },
      { days: 7, enabled: true },
      { days: 1, enabled: true },
    ],
  },
  recipients: [RecipientSchema],
  scheduleHour: { type: Number, default: 8, min: 0, max: 23 },
  excludedTemplates: {
    type: [String],
    default: [
      'Machine',
      'DomainController',
      'DomainControllerAuthentication',
      'KerberosAuthentication',
      'Computer',
      'DirectoryEmailReplication',
      'Workstation',
      'EFS',
      'EFSRecovery',
      'CEPEncryption',
      'CAExchange',
    ],
  },
  calendarConfig: {
    enabled: { type: Boolean, default: false },
    method: { type: String, enum: ['ics', 'graph', 'both'], default: 'ics' },
    icsTargetEmail: { type: String, default: '' },
    graphTenantId: { type: String, default: '' },
    graphClientId: { type: String, default: '' },
    graphClientSecret: { type: String, default: '' },
    graphCalendarEmail: { type: String, default: '' },
  },
  cleanupConfig: {
    retentionDays: { type: Number, default: 90, min: 1 },
    digestEnabled: { type: Boolean, default: false },
    digestFrequency: { type: String, enum: ['daily', 'weekly'], default: 'weekly' },
    digestDay: { type: Number, default: 1, min: 0, max: 6 }, // 0=Sunday, 1=Monday
    lastDigestSent: { type: Date },
  },
  discoveryConfig: {
    enabled:          { type: Boolean, default: false },
    probePorts:       { type: [Number], default: [443, 8443] },
    probeTimeoutMs:   { type: Number, default: 5000, min: 1000, max: 30000 },
    concurrency:      { type: Number, default: 10, min: 1, max: 50 },
    f5IpRanges:       { type: [String], default: [] },
    lastRunAt:        { type: Date },
    lastRunStats: {
      probed:        { type: Number, default: 0 },
      matched:       { type: Number, default: 0 },
      mismatched:    { type: Number, default: 0 },
      errors:        { type: Number, default: 0 },
      reboundFound:  { type: Number, default: 0 },
    },
  },
}, {
  timestamps: true,
});

export const NotificationSettings = mongoose.model<INotificationSettings>(
  'NotificationSettings',
  NotificationSettingsSchema
);