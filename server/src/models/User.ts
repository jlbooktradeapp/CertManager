import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface IUser extends Document {
  username: string;
  email: string;
  displayName: string;
  distinguishedName: string;
  roles: UserRole[];
  preferences: {
    emailNotifications: boolean;
    dashboardLayout?: Record<string, unknown>;
  };
  lastLogin: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, index: true },
  displayName: { type: String, required: true },
  distinguishedName: { type: String, required: true },
  roles: [{
    type: String,
    enum: ['admin', 'operator', 'viewer'],
    default: 'viewer',
  }],
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    dashboardLayout: { type: Schema.Types.Mixed },
  },
  lastLogin: Date,
}, {
  timestamps: true,
});

export const User = mongoose.model<IUser>('User', UserSchema);
