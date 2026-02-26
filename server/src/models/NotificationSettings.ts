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
}, {
  timestamps: true,
});

export const NotificationSettings = mongoose.model<INotificationSettings>(
  'NotificationSettings',
  NotificationSettingsSchema
);