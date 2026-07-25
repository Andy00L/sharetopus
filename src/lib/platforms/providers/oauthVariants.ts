import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderToolInput,
  ProviderToolResult,
} from "./types";
import {
  parseJsonBody,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  buildOAuth2AuthorizeUrl,
  exchangeOAuth2Code,
  refreshOAuth2Token,
  type OAuth2Config,
} from "./_shared/oauth2";

/**
 * OAuth providers that are variants or approval-gated APIs: LinkedIn Page
 * (company pages on the existing LinkedIn app), Dribbble (shot upload
 * needs Dribbble's approved upload scope), Google My Business (API access
 * is approval-gated by Google). The code is complete; each activates when
 * its env pair is set and the platform-side approval exists.
 *
 * sourceRef: learn.microsoft.com/linkedin (organizationAcls, ugcPosts);
 * developer.dribbble.com/v2 (user, shots); developers.google.com/my-business
 * (accounts, locations, localPosts).
 */

const VARIANT_TIMEOUT_MS = 30_000;

// ── LinkedIn Page ─────────────────────────────────────────────────────────

/** Reuses the existing LinkedIn app; only the scopes differ. */
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

  const parsed = parseJsonBody(aclResult.bodyText) as Record<string, unknown> | null;
  const elements = Array.isArray(parsed?.elements) ? parsed.elements : [];
  const organizations = elements
    .map((element) =>
      typeof element === "object" && element !== null
        ? (element as Record<string, unknown>).organization
        : null,
    )
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
    return { ok: false, message: "Stored LinkedIn Page has no organization." };
  }

  const commentary = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n");

  // Text posts, and media as an ARTICLE share pointing at the URL. The
  // registerUpload asset pipeline (native image/video) is a follow-up; a
  // link share is the honest form that works everywhere today.
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text: commentary },
    shareMediaCategory: input.mediaUrl ? "ARTICLE" : "NONE",
  };
  if (input.mediaUrl) {
    shareContent.media = [{ status: "READY", originalUrl: input.mediaUrl }];
  }

  const postResult = await providerFetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
    timeoutMs: VARIANT_TIMEOUT_MS,
  });

  if (!postResult.ok) return { ok: false, message: postResult.message };
  if (postResult.status !== 201) {
    return {
      ok: false,
      message: `LinkedIn Page post failed (${postResult.status}): ${postResult.bodyText.slice(0, 200)}`,
    };
  }

  const postId = readStringField(parseJsonBody(postResult.bodyText), "id");
  if (!postId) return { ok: false, message: "LinkedIn returned no post id." };
  return { ok: true, postId, postUrl: null };
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

// ── Dribbble ──────────────────────────────────────────────────────────────

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
  const user = parseJsonBody(userResult.bodyText) as Record<string, unknown> | null;
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
  if (input.mediaType !== "image" || !input.mediaUrl) {
    return { ok: false, message: "Dribbble shots require an image." };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Dribbble shots require a title." };

  // Fetch our own signed URL for the bytes, then multipart-upload the shot.
  let imageBytes: Uint8Array;
  try {
    const mediaResponse = await fetch(input.mediaUrl);
    if (!mediaResponse.ok) {
      return { ok: false, message: `Could not read the shot image (HTTP ${mediaResponse.status}).` };
    }
    imageBytes = new Uint8Array(await mediaResponse.arrayBuffer());
  } catch (mediaError) {
    return {
      ok: false,
      message: `Could not read the shot image: ${mediaError instanceof Error ? mediaError.message : "unknown"}`,
    };
  }

  const boundary = `----sharetopus${Math.abs(Date.now() | 0).toString(36)}`;
  const safeFileName = input.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "shot.png";
  const parts = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${input.body.trim()}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${safeFileName}"\r\nContent-Type: ${input.mediaMimeType}\r\n\r\n`,
      "utf-8",
    ),
    Buffer.from(imageBytes),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"),
  ]);

  const shotResult = await providerFetch("https://api.dribbble.com/v2/shots", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: new Uint8Array(parts),
    timeoutMs: VARIANT_TIMEOUT_MS,
  });

  if (!shotResult.ok) return { ok: false, message: shotResult.message };
  if (shotResult.status === 403) {
    return {
      ok: false,
      message:
        "Dribbble refused the upload (403). The app needs Dribbble's approved upload scope.",
    };
  }
  if (shotResult.status !== 202 && shotResult.status !== 201) {
    return {
      ok: false,
      message: `Dribbble upload failed (${shotResult.status}): ${shotResult.bodyText.slice(0, 200)}`,
    };
  }

  // 202: processing. Dribbble returns no body; the shot id is not known
  // yet, so record acceptance honestly rather than inventing an id.
  return { ok: true, postId: "accepted", postUrl: null };
}

export const dribbbleBehavior: ProviderBehavior = {
  connect: dribbbleConnect,
  publish: dribbblePublish,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(DRIBBBLE_OAUTH, input),
};

// ── Google My Business ────────────────────────────────────────────────────

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
  const parsed = parseJsonBody(accountsResult.bodyText) as Record<string, unknown> | null;
  const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
  const firstAccount =
    accounts[0] && typeof accounts[0] === "object"
      ? (accounts[0] as Record<string, unknown>)
      : null;
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
    // The posting location is chosen via the listLocations tool and stored
    // in options; the account is the anchor.
    config: { accountName },
  };
}

async function gmbRefresh(refreshToken: string): Promise<ProviderConnectResult> {
  const tokens = await refreshOAuth2Token(GMB_OAUTH, refreshToken);
  if (!tokens.ok) return { ok: false, message: tokens.message };
  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: "unchanged",
      displayName: null,
      username: null,
      avatarUrl: null,
    },
    config: {},
  };
}

async function gmbPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  // localPosts live under a location; the tool supplies valid names.
  const locationName =
    typeof input.options.locationName === "string"
      ? input.options.locationName
      : null;
  if (!locationName || !/^locations\/[0-9]+$/.test(locationName)) {
    return {
      ok: false,
      message:
        'A location is required (options.locationName, shaped "locations/<id>"). Use the listLocations tool.',
    };
  }
  const accountName =
    typeof input.config.accountName === "string" ? input.config.accountName : null;
  if (!accountName || !/^accounts\/[0-9]+$/.test(accountName)) {
    return { ok: false, message: "Stored Google Business account is invalid." };
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
  if (input.mediaType === "image" && input.mediaUrl) {
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

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 200) {
    return {
      ok: false,
      message: `Google Business post failed (${result.status}): ${result.bodyText.slice(0, 200)}`,
    };
  }

  const created = parseJsonBody(result.bodyText);
  const postName = readStringField(created, "name");
  return {
    ok: true,
    postId: postName ?? "created",
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

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const locations = Array.isArray(parsed?.locations) ? parsed.locations : [];
  const list = locations
    .filter(
      (location): location is Record<string, unknown> =>
        typeof location === "object" && location !== null,
    )
    .map((location) => ({
      name: typeof location.name === "string" ? location.name : null,
      title: typeof location.title === "string" ? location.title : null,
    }));
  return { ok: true, data: { locations: list } };
}

export const gmbBehavior: ProviderBehavior = {
  connect: gmbConnect,
  publish: gmbPublish,
  refresh: gmbRefresh,
  runTool: gmbRunTool,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(GMB_OAUTH, input),
};
