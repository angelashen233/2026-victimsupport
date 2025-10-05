export enum MessageAuthor {
  USER = 'user',
  AI = 'ai',
}

export interface Message {
  author: MessageAuthor;
  text: string;
  image?: string;
  quickReplies?: string[];
}

export interface UserProfile {
  location: string;
  gender: string;
}

export interface ReportData {
  date: string;
  location: string;
  involved: string;
  description: string;
  impact: string;
}

export interface Recipient {
  name: string;
  description: string;
}

export interface Resource {
  name: string;
  description: string;
  contact: string;
}