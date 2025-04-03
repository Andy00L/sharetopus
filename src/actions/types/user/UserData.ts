export interface UserData {
  id: string;
  email: string;
  name: string;
  premiumStatus: boolean;
  premiumExpiry: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}
