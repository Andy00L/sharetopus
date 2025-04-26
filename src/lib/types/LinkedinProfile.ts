// lib/types/LinkedInProfile.ts

export interface LinkedInProfile {
  id: string;
  name: string;
  given_name: string;
  family_name: string;
  email: string;
  picture: string;
  locale: string;
  email_verified: boolean;
}
