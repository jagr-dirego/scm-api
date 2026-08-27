import type { VerifiedAccessToken } from '../auth/token.service';

export interface ImportAuthorizationInput {
  identity: VerifiedAccessToken;
  actionPermissionCode: string;
  documentTypeCode: string;
  fileBranchCode: string;
}

export interface AuthorizedImportProfile {
  id: string;
  code: string;
  documentTypeId: string;
  fileBranchId: string;
  fileStructureId: string;
  destinationTable: string;
  parserVersion: string;
}

export interface ImportAuthorizationDecision {
  allowed: boolean;
  profile: AuthorizedImportProfile | null;
}

export interface AuthorizedImportProfileListInput {
  identity: VerifiedAccessToken;
  actionPermissionCode: string;
  documentTypeCode?: string;
  fileBranchCode?: string;
}

export interface ImportProfileSummary {
  code: string;
  name: string;
  documentType: {
    code: string;
    name: string;
  };
  fileBranch: {
    code: string;
    name: string;
  };
}
