import "server-only";

import { Blob } from "node:buffer";

import { FormData } from "undici";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderToolInput,
  ProviderToolResult,
} from "./types";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import { isJsonObject, toJsonObject } from "@/lib/utils/jsonObject";

import {
  parseJsonBody,
  parseJsonObject,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  fetchStoredMedia,
  STORED_MEDIA_MAX_BYTES,
} from "./_shared/fetchStoredMedia";
import {
  failHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";
import {
  buildOAuth2AuthorizeUrl,
  exchangeOAuth2Code,
  refreshOAuth2Credential,
  type OAuth2Config,
} from "./_shared/oauth2";

const VARIANT_TIMEOUT_MS = 30_000;

// developer.dribbble.com/v2/shots (Create a shot): "Status: 202 Accepted",
// "Location: https://api.dribbble.com/v2/shots/471756".
const DRIBBBLE_SHOT_LOCATION_PATTERN = /\/v2\/shots\/(\d+)\/?$/;

const LINKEDIN_PAGE_OAUTH: OAuth2Config = {
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  clientIdEnv: "LINKEDIN_CLIENT_ID",
  clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
  scope: "w_organization_social rw_organization_admin",
  useBasicAuthForToken: false,
};

type OrganizationSummary = { id: string; name: string | null };

async function listAdministeredOrganizations(
  accessToken: string,
): Promise<
  | { ok: true; organizations: OrganizationSummary[] }
  | { ok: false; message: string }
> {
  const aclResult = await providerFetch(
    "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      timeoutMs: VARIANT_TIMEOUT_MS,
    },
  );
  if (!aclResult.ok) return { ok: false, message: aclResult.message };
  if (aclResult.status !== 200) {
    return {
      ok: false,
      message: `LinkedIn organization lookup failed (${aclResult.status}).`,
    };
  }

  const parsed = parseJsonObject(aclResult.bodyText);
  const elements: unknown[] = Array.isArray(parsed?.elements) ? parsed.elements : [];
  const organizations = elements
    .map((element) => toJsonObject(element)?.organization)
    .filter((urn): urn is string => typeof urn === "string")
    // URN shape: urn:li:organization:12345
    .map((urn) => ({ id: urn.split(":").pop() ?? "", name: null }))
    .filter((organization) => organization.id.length > 0);

  return { ok: true, organizations };
}

async function linkedinPageConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "LinkedIn Page connects through OAuth." };
  }
  const tokens = await exchangeOAuth2Code(LINKEDIN_PAGE_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const organizations = await listAdministeredOrganizations(tokens.accessToken);
  if (!organizations.ok) return { ok: false, message: organizations.message };
  const firstOrganization = organizations.organizations[0];
  if (!firstOrganization) {
    return {
      ok: false,
      message: "This LinkedIn account administers no pages.",
    };
  }

  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: `org-${firstOrganization.id}`,
      displayName: `Page ${firstOrganization.id}`,
      username: null,
      avatarUrl: null,
    },
    config: { organizationId: firstOrganization.id },
  };
}

async function linkedinPagePublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const organizationId =
    typeof input.options.organizationId === "string" && input.options.organizationId
      ? input.options.organizationId
      : typeof input.config.organizationId === "string"
        ? input.config.organizationId
        : null;
  if (!organizationId) {
    return refusePublish("Stored LinkedIn Page has no organization.");
  }

  const commentary = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n");

  let mediaBuffer: Buffer | undefined;
  if (input.postType !== "text") {
    if (!input.mediaUrl) return refusePublish("The post media is missing.");
    const storedMedia = await fetchStoredMedia(input.mediaUrl, STORED_MEDIA_MAX_BYTES);
    if (!storedMedia.ok) return storedMedia;
    mediaBuffer = Buffer.from(await storedMedia.media.arrayBuffer());
  }

  const shareResult = await postToLinkedIn({
    accessToken: input.accessToken,
    memberUrn: `urn:li:organization:${organizationId}`,
    text: commentary,
    postType: input.postType,
    mediaType: input.mediaMimeType,
    buffer: mediaBuffer,
  });
  if (!shareResult.success) {
    return { ok: false, message: shareResult.error, failure: shareResult.failure };
  }
  return { ok: true, postId: shareResult.postId, postUrl: null };
}

async function linkedinPageRunTool(
  input: ProviderToolInput,
): Promise<ProviderToolResult> {
  if (input.methodName !== "listPages") {
    return { ok: false, message: `Unknown tool "${input.methodName}".` };
  }
  const organizations = await listAdministeredOrganizations(input.accessToken);
  if (!organizations.ok) return { ok: false, message: organizations.message };
  return { ok: true, data: { pages: organizations.organizations } };
}

export const linkedinPageBehavior: ProviderBehavior = {
  connect: linkedinPageConnect,
  publish: linkedinPagePublish,
  runTool: linkedinPageRunTool,
  buildAuthorizeUrl: (input) =>
    buildOAuth2AuthorizeUrl(LINKEDIN_PAGE_OAUTH, input),
};

const DRIBBBLE_OAUTH: OAuth2Config = {
  authorizeUrl: "https://dribbble.com/oauth/authorize",
  tokenUrl: "https://dribbble.com/oauth/token",
  clientIdEnv: "DRIBBBLE_CLIENT_ID",
  clientSecretEnv: "DRIBBBLE_CLIENT_SECRET",
  scope: "public upload",
  useBasicAuthForToken: false,
};

async function dribbbleConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Dribbble connects through OAuth." };
  }
  const tokens = await exchangeOAuth2Code(DRIBBBLE_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const userResult = await providerFetch("https://api.dribbble.com/v2/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    timeoutMs: VARIANT_TIMEOUT_MS,
  });
  if (!userResult.ok || userResult.status !== 200) {
    return { ok: false, message: "Dribbble user lookup failed." };
  }
  const user = parseJsonObject(userResult.bodyText);
  const userId =
    user && typeof user.id === "number" ? String(user.id) : null;
  if (!userId) return { ok: false, message: "Dribbble returned no user id." };

  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: userId,
      displayName: readStringField(user, "name"),
      username: readStringField(user, "login"),
      avatarUrl: readStringField(user, "avatar_url"),
    },
    config: {},
  };
}

async function dribbblePublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  if (input.postType !== "image" || !input.mediaUrl) {
    return refusePublish("Dribbble shots require an image.");
  }
  const title = input.title.trim();
  if (!title) return refusePublish("Dribbble shots require a title.");

  const storedImage = await fetchStoredMedia(input.mediaUrl, STORED_MEDIA_MAX_BYTES);
  if (!storedImage.ok) return storedImage;

  const safeFileName = input.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "shot.png";
  const shotForm = new FormData();
  shotForm.append("title", title);
  shotForm.append("description", input.body.trim());
  shotForm.append(
    "image",
    new Blob([storedImage.media], { type: input.mediaMimeType }),
    safeFileName,
  );

  const shotResult = await providerFetch("https://api.dribbble.com/v2/shots", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: shotForm,
    timeoutMs: VARIANT_TIMEOUT_MS,
  });

  if (!shotResult.ok) {
    return failProviderFetch({
      platform: "dribbble",
      stage: "publish",
      fetchFailure: shotResult,
    });
  }
  if (shotResult.status === 403) {
    return failHttpAnswer({
      platform: "dribbble",
      stage: "publish",
      action: "Dribbble upload (the app needs Dribbble's approved upload scope)",
      httpStatus: shotResult.status,
      bodyText: "",
    });
  }
  if (shotResult.status !== 202 && shotResult.status !== 201) {
    return failHttpAnswer({
      platform: "dribbble",
      stage: "publish",
      action: "Dribbble upload",
      httpStatus: shotResult.status,
      bodyText: shotResult.bodyText,
    });
  }

  const shotId = DRIBBBLE_SHOT_LOCATION_PATTERN.exec(shotResult.headers.location ?? "")?.[1];
  if (!shotId) {
    return failUnreadableAnswer({
      message: "Dribbble accepted the shot but returned no shot location.",
      stage: "publish",
    });
  }
  return { ok: true, postId: shotId, postUrl: null };
}

export const dribbbleBehavior: ProviderBehavior = {
  connect: dribbbleConnect,
  publish: dribbblePublish,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(DRIBBBLE_OAUTH, input),
};

const GMB_OAUTH: OAuth2Config = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientIdEnv: "GMB_CLIENT_ID",
  clientSecretEnv: "GMB_CLIENT_SECRET",
  scope: "https://www.googleapis.com/auth/business.manage",
  // offline+consent is what makes Google issue a refresh token at all.
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  useBasicAuthForToken: false,
};

async function gmbConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Google Business connects through OAuth." };
  }
  const tokens = await exchangeOAuth2Code(GMB_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const accountsResult = await providerFetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      timeoutMs: VARIANT_TIMEOUT_MS,
    },
  );
  if (!accountsResult.ok || accountsResult.status !== 200) {
    return {
      ok: false,
      message:
        "Google Business account lookup failed. The Business Profile APIs require Google's approval for the project.",
    };
  }
  const parsed = parseJsonObject(accountsResult.bodyText);
  const accounts: unknown[] = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
  const firstAccount = toJsonObject(accounts[0]);
  const accountName =
    firstAccount && typeof firstAccount.name === "string"
      ? firstAccount.name
      : null;
  if (!accountName) {
    return { ok: false, message: "No Google Business account on this login." };
  }

  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: accountName,
      displayName:
        firstAccount && typeof firstAccount.accountName === "string"
          ? firstAccount.accountName
          : accountName,
      username: null,
      avatarUrl: null,
    },
    config: { accountName },
  };
}

async function gmbPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const locationName =
    typeof input.options.locationName === "string"
      ? input.options.locationName
      : null;
  if (!locationName || !/^locations\/[0-9]+$/.test(locationName)) {
    return refusePublish(
      'A location is required (options.locationName, shaped "locations/<id>"). Use the listLocations tool.',
    );
  }
  const accountName =
    typeof input.config.accountName === "string" ? input.config.accountName : null;
  if (!accountName || !/^accounts\/[0-9]+$/.test(accountName)) {
    return refusePublish("Stored Google Business account is invalid.");
  }

  const summary = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .slice(0, 1500);

  const postPayload: Record<string, unknown> = {
    languageCode: "en",
    topicType: "STANDARD",
    summary,
  };
  if (input.postType === "image" && input.mediaUrl) {
    postPayload.media = [{ mediaFormat: "PHOTO", sourceUrl: input.mediaUrl }];
  }

  const result = await providerFetch(
    `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/localPosts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify(postPayload),
      timeoutMs: VARIANT_TIMEOUT_MS,
    },
  );

  if (!result.ok) {
    return failProviderFetch({ platform: "gmb", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 200) {
    return failHttpAnswer({
      platform: "gmb",
      stage: "publish",
      action: "Google Business post",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  const created = parseJsonBody(result.bodyText);
  const postName = readStringField(created, "name");
  if (!postName) {
    return failUnreadableAnswer({
      message: "Google Business returned no post name.",
      stage: "publish",
    });
  }
  return {
    ok: true,
    postId: postName,
    postUrl: readStringField(created, "searchUrl"),
  };
}

async function gmbRunTool(input: ProviderToolInput): Promise<ProviderToolResult> {
  if (input.methodName !== "listLocations") {
    return { ok: false, message: `Unknown tool "${input.methodName}".` };
  }
  const accountName =
    typeof input.config.accountName === "string" ? input.config.accountName : null;
  if (!accountName) return { ok: false, message: "Account has no anchor." };

  const result = await providerFetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      timeoutMs: VARIANT_TIMEOUT_MS,
    },
  );
  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 200) {
    return { ok: false, message: `Location list failed (${result.status}).` };
  }

  const parsed = parseJsonObject(result.bodyText);
  const locations: unknown[] = Array.isArray(parsed?.locations) ? parsed.locations : [];
  const list = locations
    .filter(isJsonObject)
    .map((location) => ({
      name: typeof location.name === "string" ? location.name : null,
      title: typeof location.title === "string" ? location.title : null,
    }));
  return { ok: true, data: { locations: list } };
}

export const gmbBehavior: ProviderBehavior = {
  connect: gmbConnect,
  publish: gmbPublish,
  refresh: (input) => refreshOAuth2Credential(GMB_OAUTH, input),
  runTool: gmbRunTool,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(GMB_OAUTH, input),
};
